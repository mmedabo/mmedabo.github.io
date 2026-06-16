package risk

import (
	"fmt"
	"sync"
	"time"

	"github.com/mmedabo/trading-bot/config"
	"github.com/shopspring/decimal"
)

// TradeRecord tracks a completed round-trip.
type TradeRecord struct {
	Symbol    string
	PnL       decimal.Decimal
	Timestamp time.Time
}

// Manager enforces risk limits across the bot's lifecycle.
type Manager struct {
	mu           sync.Mutex
	cfg          *config.RiskConfig
	dailyPnL     decimal.Decimal
	tradesCount  int
	openCount    int
	records      []TradeRecord
	lastResetDay int // day-of-year of last reset
}

func New(cfg *config.RiskConfig) *Manager {
	return &Manager{cfg: cfg, lastResetDay: time.Now().YearDay()}
}

// resetIfNewDay clears daily counters when calendar day changes.
func (m *Manager) resetIfNewDay() {
	today := time.Now().YearDay()
	if today != m.lastResetDay {
		m.dailyPnL = decimal.Zero
		m.tradesCount = 0
		m.lastResetDay = today
	}
}

// CanOpen checks whether a new position may be opened for the given trade value (SGD).
func (m *Manager) CanOpen(tradeSGD decimal.Decimal) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.resetIfNewDay()

	if m.openCount >= m.cfg.MaxOpenPositions {
		return fmt.Errorf("max open positions (%d) reached", m.cfg.MaxOpenPositions)
	}
	if m.tradesCount >= m.cfg.MaxTradesPerDay {
		return fmt.Errorf("max daily trades (%d) reached", m.cfg.MaxTradesPerDay)
	}
	if m.dailyPnL.LessThan(decimal.NewFromFloat(-m.cfg.MaxDailyLossSGD)) {
		return fmt.Errorf("daily loss limit reached (%.2f SGD)", m.cfg.MaxDailyLossSGD)
	}
	maxPos := decimal.NewFromFloat(m.cfg.MaxPositionSGD)
	if tradeSGD.GreaterThan(maxPos) {
		return fmt.Errorf("position size %s exceeds limit %s SGD", tradeSGD, maxPos)
	}
	return nil
}

// ExpectedPnL estimates net PnL after round-trip commissions.
// Returns an error if the trade won't be profitable.
func (m *Manager) ExpectedPnL(entryPrice, targetPrice decimal.Decimal, qty int64) (decimal.Decimal, error) {
	tradeValue := entryPrice.Mul(decimal.NewFromInt(qty))
	commission := commissionFor(tradeValue.InexactFloat64(), m.cfg.MinCommissionSGD, m.cfg.CommissionRate)
	roundTrip := commission.Mul(decimal.NewFromInt(2))

	gross := targetPrice.Sub(entryPrice).Mul(decimal.NewFromInt(qty))
	net := gross.Sub(roundTrip)

	if net.LessThanOrEqual(decimal.Zero) {
		return decimal.Zero, fmt.Errorf("trade not profitable after commission: gross=%.4f commission=%.2f",
			gross.InexactFloat64(), roundTrip.InexactFloat64())
	}
	return net, nil
}

// RecordOpen notes that a position was opened.
func (m *Manager) RecordOpen() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.openCount++
	m.tradesCount++
}

// RecordClose notes that a position closed with given PnL.
func (m *Manager) RecordClose(symbol string, pnl decimal.Decimal) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.openCount--
	if m.openCount < 0 {
		m.openCount = 0
	}
	m.dailyPnL = m.dailyPnL.Add(pnl)
	m.records = append(m.records, TradeRecord{
		Symbol:    symbol,
		PnL:       pnl,
		Timestamp: time.Now(),
	})
}

// DailyPnL returns total P&L for the current trading day.
func (m *Manager) DailyPnL() decimal.Decimal {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.resetIfNewDay()
	return m.dailyPnL
}

// Summary returns a snapshot of today's stats.
func (m *Manager) Summary() (trades int, pnl decimal.Decimal, open int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.resetIfNewDay()
	return m.tradesCount, m.dailyPnL, m.openCount
}

func commissionFor(value, minCommission, rate float64) decimal.Decimal {
	calc := value * rate
	if calc < minCommission {
		calc = minCommission
	}
	return decimal.NewFromFloat(calc).Round(2)
}
