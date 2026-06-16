package market

import (
	"time"

	"github.com/shopspring/decimal"
)

// Tick holds a single price update for a symbol.
type Tick struct {
	Symbol    string
	Bid       decimal.Decimal
	Ask       decimal.Decimal
	Last      decimal.Decimal
	Volume    int64
	Timestamp time.Time
}

// Spread returns the bid-ask spread.
func (t *Tick) Spread() decimal.Decimal {
	return t.Ask.Sub(t.Bid)
}

// MidPrice returns the midpoint of bid and ask.
func (t *Tick) MidPrice() decimal.Decimal {
	return t.Bid.Add(t.Ask).Div(decimal.NewFromInt(2))
}

// TickHistory stores a rolling window of ticks for a symbol.
type TickHistory struct {
	ticks []Tick
	maxN  int
}

func NewTickHistory(windowSize int) *TickHistory {
	return &TickHistory{maxN: windowSize}
}

func (h *TickHistory) Add(t Tick) {
	h.ticks = append(h.ticks, t)
	if len(h.ticks) > h.maxN {
		h.ticks = h.ticks[1:]
	}
}

func (h *TickHistory) Len() int { return len(h.ticks) }

func (h *TickHistory) Latest() *Tick {
	if len(h.ticks) == 0 {
		return nil
	}
	t := h.ticks[len(h.ticks)-1]
	return &t
}

// Momentum returns the price change (last - oldest mid) over the window.
// Positive = upward, negative = downward.
func (h *TickHistory) Momentum() decimal.Decimal {
	if len(h.ticks) < 2 {
		return decimal.Zero
	}
	oldest := h.ticks[0].MidPrice()
	newest := h.ticks[len(h.ticks)-1].MidPrice()
	return newest.Sub(oldest)
}

// AvgVolume returns mean volume across the window ticks.
func (h *TickHistory) AvgVolume() int64 {
	if len(h.ticks) == 0 {
		return 0
	}
	var total int64
	for _, t := range h.ticks {
		total += t.Volume
	}
	return total / int64(len(h.ticks))
}
