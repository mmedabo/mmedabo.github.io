package scalper_test

import (
	"context"
	"testing"
	"time"

	"github.com/mmedabo/trading-bot/config"
	"github.com/mmedabo/trading-bot/internal/broker/mock"
	"github.com/mmedabo/trading-bot/internal/market"
	"github.com/mmedabo/trading-bot/internal/risk"
	"github.com/mmedabo/trading-bot/internal/strategy/scalper"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// Use a stock priced at S$1.50 (tick = S$0.005).
// At S$5000 max position: 3200 shares, 1-tick gross = S$16 > S$5.83 round-trip commission.
const testSymbol = "Y92.SI" // Thai Bev — ~S$0.59 in real life; we use S$1.50 for test clarity

func setup() (*scalper.Scalper, *mock.Client) {
	cfg := config.Default()
	cfg.Watchlist = []string{testSymbol}
	cfg.Risk.MaxPositionSGD = 5000
	cfg.Strategy.MomentumPeriod = 3
	cfg.Strategy.MinSpreadTicks = 2
	cfg.Strategy.TargetProfitTicks = 1
	cfg.Strategy.StopLossTicks = 3
	cfg.Strategy.MaxHoldSeconds = 5

	log := zap.NewNop()
	b := mock.New(50000)
	riskMgr := risk.New(&cfg.Risk)
	s := scalper.New(cfg, log, riskMgr, b)
	return s, b
}

// makeTick uses S$1.50 price range — tick = 0.005, 3200 shares fits in S$5k limit.
func makeTick(bid, ask float64) market.Tick {
	return market.Tick{
		Symbol:    testSymbol,
		Bid:       decimal.NewFromFloat(bid),
		Ask:       decimal.NewFromFloat(ask),
		Last:      decimal.NewFromFloat((bid + ask) / 2),
		Volume:    1000000,
		Timestamp: time.Now(),
	}
}

func TestNoEntryWithoutHistory(t *testing.T) {
	s, _ := setup()
	if err := s.OnTick(context.Background(), makeTick(1.500, 1.510)); err != nil {
		t.Fatal(err)
	}
	if len(s.OpenTrades()) != 0 {
		t.Error("expected no open trades after first tick")
	}
}

func TestEntryOnUpMomentum(t *testing.T) {
	s, _ := setup()
	ctx := context.Background()

	// ascending mid prices → positive momentum; spread = 0.01 = 2 ticks ✓
	ticks := []market.Tick{
		makeTick(1.490, 1.500),
		makeTick(1.495, 1.505),
		makeTick(1.500, 1.510),
		makeTick(1.505, 1.515), // triggers entry
	}
	for _, tick := range ticks {
		if err := s.OnTick(ctx, tick); err != nil {
			t.Fatal(err)
		}
	}
	if len(s.OpenTrades()) == 0 {
		t.Error("expected a trade to open on clear up-momentum")
	}
}

func TestExitOnTimeout(t *testing.T) {
	s, _ := setup()
	ctx := context.Background()

	ticks := []market.Tick{
		makeTick(1.490, 1.500),
		makeTick(1.495, 1.505),
		makeTick(1.500, 1.510),
		makeTick(1.505, 1.515),
	}
	for _, tick := range ticks {
		_ = s.OnTick(ctx, tick)
	}

	if len(s.OpenTrades()) == 0 {
		t.Skip("no trade opened, skipping timeout test")
	}

	time.Sleep(6 * time.Second) // MaxHoldSeconds = 5 in setup
	_ = s.OnTick(ctx, makeTick(1.505, 1.515))

	if len(s.OpenTrades()) != 0 {
		t.Error("expected trade to close after timeout")
	}
}
