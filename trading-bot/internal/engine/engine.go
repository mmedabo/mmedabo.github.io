// Package engine drives the main trading loop: poll quotes → feed strategy → report.
package engine

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mmedabo/trading-bot/config"
	"github.com/mmedabo/trading-bot/internal/broker"
	"github.com/mmedabo/trading-bot/internal/market"
	"github.com/mmedabo/trading-bot/internal/risk"
	"github.com/mmedabo/trading-bot/internal/strategy/scalper"
	"go.uber.org/zap"
)

type Engine struct {
	cfg      *config.Config
	log      *zap.Logger
	brok     broker.Broker
	risk     *risk.Manager
	strategy *scalper.Scalper
}

// Broker re-exports the interface so callers don't need to import both packages.
type Broker = broker.Broker

func New(cfg *config.Config, log *zap.Logger, b Broker) *Engine {
	riskMgr := risk.New(&cfg.Risk)
	strat := scalper.New(cfg, log, riskMgr, b)
	return &Engine{cfg: cfg, log: log, brok: b, risk: riskMgr, strategy: strat}
}

// Run starts the continuous trading loop and blocks until SIGINT/SIGTERM.
func (e *Engine) Run(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)

	interval := time.Duration(e.cfg.Strategy.TickIntervalMs) * time.Millisecond
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	statsTicker := time.NewTicker(5 * time.Minute)
	defer statsTicker.Stop()

	e.log.Info("engine started",
		zap.String("broker", e.brok.Name()),
		zap.Int("watchlist", len(e.cfg.Watchlist)),
		zap.Duration("interval", interval),
	)

	for {
		select {
		case <-sigs:
			e.log.Info("shutdown signal received")
			e.logStats()
			return

		case <-ctx.Done():
			e.logStats()
			return

		case <-statsTicker.C:
			e.logStats()

		case <-ticker.C:
			if !market.IsMarketOpen(time.Now()) {
				wait := market.TimeUntilOpen(time.Now())
				if wait > time.Minute {
					e.log.Info("market closed, sleeping", zap.Duration("until_open", wait))
					// coarse sleep — ticker will fire again; for long waits we could
					// also reset the ticker but this is safe enough for polling.
					time.Sleep(wait - 30*time.Second)
				}
				continue
			}

			e.pollAll(ctx)
		}
	}
}

func (e *Engine) pollAll(ctx context.Context) {
	for _, symbol := range e.cfg.Watchlist {
		q, err := e.brok.GetQuote(ctx, symbol)
		if err != nil {
			e.log.Warn("quote error", zap.String("symbol", symbol), zap.Error(err))
			continue
		}

		tick := market.Tick{
			Symbol:    q.Symbol,
			Bid:       q.Bid,
			Ask:       q.Ask,
			Last:      q.Last,
			Volume:    q.Volume,
			Timestamp: q.Timestamp,
		}

		if err := e.strategy.OnTick(ctx, tick); err != nil {
			e.log.Error("strategy error", zap.String("symbol", symbol), zap.Error(err))
		}
	}
}

func (e *Engine) logStats() {
	trades, pnl, open := e.risk.Summary()
	balance, _ := e.brok.AccountBalance(context.Background())
	e.log.Info("=== daily stats ===",
		zap.Int("trades", trades),
		zap.String("pnl_sgd", pnl.StringFixed(2)),
		zap.Int("open_positions", open),
		zap.String("balance_sgd", balance.StringFixed(2)),
	)
}
