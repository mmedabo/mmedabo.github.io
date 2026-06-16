// Package scalper implements a micro-profit scalping strategy for SGX equities.
//
// Entry logic:
//   - Spread must be at least MinSpreadTicks wide (we're paying it, so we need room)
//   - Momentum must align with intended direction (buy on up-momentum, sell on down)
//   - Volume must exceed MinVolume threshold
//
// Exit logic (first of):
//   - Price reaches TargetProfitTicks away from entry
//   - Price moves StopLossTicks against entry
//   - MaxHoldSeconds elapsed (time-based stop)
package scalper

import (
	"context"
	"fmt"
	"time"

	"github.com/mmedabo/trading-bot/config"
	"github.com/mmedabo/trading-bot/internal/broker"
	"github.com/mmedabo/trading-bot/internal/market"
	"github.com/mmedabo/trading-bot/internal/risk"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// Trade tracks an open scalp position.
type Trade struct {
	Symbol      string
	OrderID     string
	Side        broker.Side
	EntryPrice  decimal.Decimal
	Qty         int64
	EnteredAt   time.Time
	TargetPrice decimal.Decimal
	StopPrice   decimal.Decimal
}

type Scalper struct {
	cfg     *config.Config
	log     *zap.Logger
	risk    *risk.Manager
	brok    broker.Broker
	history map[string]*market.TickHistory
	open    map[string]*Trade // symbol → open trade
}

func New(cfg *config.Config, log *zap.Logger, riskMgr *risk.Manager, b broker.Broker) *Scalper {
	h := make(map[string]*market.TickHistory, len(cfg.Watchlist))
	for _, sym := range cfg.Watchlist {
		h[sym] = market.NewTickHistory(cfg.Strategy.MomentumPeriod + 2)
	}
	return &Scalper{
		cfg:     cfg,
		log:     log,
		risk:    riskMgr,
		brok:    b,
		history: h,
		open:    make(map[string]*Trade),
	}
}

// OnTick is called on each new price update for a symbol.
// It updates the history and decides whether to enter or manage an open trade.
func (s *Scalper) OnTick(ctx context.Context, tick market.Tick) error {
	hist := s.history[tick.Symbol]
	if hist == nil {
		return nil
	}
	hist.Add(tick)

	if trade, ok := s.open[tick.Symbol]; ok {
		return s.manageTrade(ctx, trade, tick)
	}

	if hist.Len() < s.cfg.Strategy.MomentumPeriod {
		return nil // not enough history yet
	}

	return s.tryEnter(ctx, tick, hist)
}

func (s *Scalper) tryEnter(ctx context.Context, tick market.Tick, hist *market.TickHistory) error {
	tickSize := sgxTickSize(tick.Last)
	minSpread := tickSize.Mul(decimal.NewFromInt(int64(s.cfg.Strategy.MinSpreadTicks)))

	if tick.Spread().LessThan(minSpread) {
		return nil // spread too tight to capture profit after slippage
	}
	if tick.Volume < s.cfg.Strategy.MinVolume {
		return nil // insufficient liquidity
	}

	momentum := hist.Momentum()
	if momentum.IsZero() {
		return nil // no clear direction
	}

	var side broker.Side
	var entryPrice decimal.Decimal
	var targetPrice decimal.Decimal
	var stopPrice decimal.Decimal

	target := tickSize.Mul(decimal.NewFromInt(int64(s.cfg.Strategy.TargetProfitTicks)))
	stop := tickSize.Mul(decimal.NewFromInt(int64(s.cfg.Strategy.StopLossTicks)))

	if momentum.GreaterThan(decimal.Zero) {
		// bullish momentum: buy at ask, sell at ask + target
		side = broker.Buy
		entryPrice = tick.Ask
		targetPrice = entryPrice.Add(target)
		stopPrice = entryPrice.Sub(stop)
	} else {
		// bearish momentum: sell at bid, cover at bid - target
		// Note: short selling on SGX requires a securities borrowing arrangement;
		// in paper mode this is simulated freely.
		side = broker.Sell
		entryPrice = tick.Bid
		targetPrice = entryPrice.Sub(target)
		stopPrice = entryPrice.Add(stop)
	}

	// Position sizing: use up to MaxPositionSGD, round down to board lot (100 shares).
	// We deliberately use the full cap (not a fraction) because SGX minimum commission
	// is S$10/trade — small positions make round-trip costs uneconomical.
	qty := decimal.NewFromFloat(s.cfg.Risk.MaxPositionSGD).Div(entryPrice).IntPart()
	qty = (qty / 100) * 100 // floor to nearest board lot
	if qty < 100 {
		return nil // position too small for board lot at current price
	}

	tradeValue := entryPrice.Mul(decimal.NewFromInt(qty))
	if err := s.risk.CanOpen(tradeValue); err != nil {
		s.log.Debug("risk check failed", zap.String("symbol", tick.Symbol), zap.Error(err))
		return nil
	}

	if _, err := s.risk.ExpectedPnL(entryPrice, targetPrice, qty); err != nil {
		s.log.Debug("pnl check failed", zap.String("symbol", tick.Symbol), zap.Error(err))
		return nil
	}

	ord, err := s.brok.PlaceOrder(ctx, tick.Symbol, side, qty, entryPrice, broker.Limit)
	if err != nil {
		return fmt.Errorf("place order %s: %w", tick.Symbol, err)
	}

	s.risk.RecordOpen()
	s.open[tick.Symbol] = &Trade{
		Symbol:      tick.Symbol,
		OrderID:     ord.ID,
		Side:        side,
		EntryPrice:  entryPrice,
		Qty:         qty,
		EnteredAt:   time.Now(),
		TargetPrice: targetPrice,
		StopPrice:   stopPrice,
	}

	s.log.Info("entered trade",
		zap.String("symbol", tick.Symbol),
		zap.String("side", string(side)),
		zap.String("entry", entryPrice.String()),
		zap.String("target", targetPrice.String()),
		zap.String("stop", stopPrice.String()),
		zap.Int64("qty", qty),
	)
	return nil
}

func (s *Scalper) manageTrade(ctx context.Context, trade *Trade, tick market.Tick) error {
	heldFor := time.Since(trade.EnteredAt)
	maxHold := time.Duration(s.cfg.Strategy.MaxHoldSeconds) * time.Second

	var exitReason string
	var exitPrice decimal.Decimal

	switch trade.Side {
	case broker.Buy:
		if tick.Bid.GreaterThanOrEqual(trade.TargetPrice) {
			exitReason = "target"
			exitPrice = tick.Bid
		} else if tick.Bid.LessThanOrEqual(trade.StopPrice) {
			exitReason = "stop"
			exitPrice = tick.Bid
		}
	case broker.Sell:
		if tick.Ask.LessThanOrEqual(trade.TargetPrice) {
			exitReason = "target"
			exitPrice = tick.Ask
		} else if tick.Ask.GreaterThanOrEqual(trade.StopPrice) {
			exitReason = "stop"
			exitPrice = tick.Ask
		}
	}

	if exitReason == "" && heldFor >= maxHold {
		exitReason = "timeout"
		if trade.Side == broker.Buy {
			exitPrice = tick.Bid
		} else {
			exitPrice = tick.Ask
		}
	}

	if exitReason == "" {
		return nil // still holding
	}

	exitSide := broker.Sell
	if trade.Side == broker.Sell {
		exitSide = broker.Buy
	}

	ord, err := s.brok.PlaceOrder(ctx, trade.Symbol, exitSide, trade.Qty, exitPrice, broker.Limit)
	if err != nil {
		return fmt.Errorf("exit order %s: %w", trade.Symbol, err)
	}

	var pnl decimal.Decimal
	if trade.Side == broker.Buy {
		pnl = exitPrice.Sub(trade.EntryPrice).Mul(decimal.NewFromInt(trade.Qty))
	} else {
		pnl = trade.EntryPrice.Sub(exitPrice).Mul(decimal.NewFromInt(trade.Qty))
	}

	s.risk.RecordClose(trade.Symbol, pnl)
	delete(s.open, trade.Symbol)

	s.log.Info("exited trade",
		zap.String("symbol", trade.Symbol),
		zap.String("reason", exitReason),
		zap.String("entry", trade.EntryPrice.String()),
		zap.String("exit", exitPrice.String()),
		zap.String("pnl", pnl.String()),
		zap.String("order_id", ord.ID),
		zap.Duration("held", heldFor),
	)
	return nil
}

// OpenTrades returns a snapshot of currently open trade symbols.
func (s *Scalper) OpenTrades() []string {
	syms := make([]string, 0, len(s.open))
	for sym := range s.open {
		syms = append(syms, sym)
	}
	return syms
}

// sgxTickSize returns the minimum price movement for an SGX stock.
func sgxTickSize(price decimal.Decimal) decimal.Decimal {
	if price.LessThan(decimal.NewFromFloat(0.20)) {
		return decimal.NewFromFloat(0.001)
	}
	if price.LessThan(decimal.NewFromFloat(2.00)) {
		return decimal.NewFromFloat(0.005)
	}
	return decimal.NewFromFloat(0.01)
}
