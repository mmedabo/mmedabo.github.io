// Package mock provides a paper-trading broker for testing strategies without real money.
package mock

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"time"

	"github.com/mmedabo/trading-bot/internal/broker"
	"github.com/shopspring/decimal"
)

type Client struct {
	mu        sync.Mutex
	cash      decimal.Decimal
	positions map[string]*broker.Position
	orders    map[string]*broker.Order
	quotes    map[string]*broker.Quote
	nextID    int

	// simulated price state per symbol
	prices map[string]decimal.Decimal
}

func New(initialCash float64) *Client {
	return &Client{
		cash:      decimal.NewFromFloat(initialCash),
		positions: make(map[string]*broker.Position),
		orders:    make(map[string]*broker.Order),
		quotes:    make(map[string]*broker.Quote),
		prices:    defaultPrices(),
	}
}

func defaultPrices() map[string]decimal.Decimal {
	return map[string]decimal.Decimal{
		"D05.SI": decimal.NewFromFloat(36.50),
		"O39.SI": decimal.NewFromFloat(14.80),
		"U11.SI": decimal.NewFromFloat(32.20),
		"Z74.SI": decimal.NewFromFloat(2.35),
		"F34.SI": decimal.NewFromFloat(3.18),
		"BN4.SI": decimal.NewFromFloat(6.75),
		"C6L.SI": decimal.NewFromFloat(6.40),
		"V03.SI": decimal.NewFromFloat(14.10),
	}
}

func (c *Client) Name() string { return "paper" }

func (c *Client) GetQuote(_ context.Context, symbol string) (*broker.Quote, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	base, ok := c.prices[symbol]
	if !ok {
		base = decimal.NewFromFloat(10.0)
		c.prices[symbol] = base
	}

	// random walk: ±0-2 ticks (SGX tick = 0.01 for prices 1-9.99, 0.005 for < 1, etc.)
	tick := tickSize(base)
	drift := decimal.NewFromFloat((rand.Float64()*4 - 2)).Mul(tick)
	newBase := base.Add(drift)
	if newBase.LessThan(decimal.NewFromFloat(0.1)) {
		newBase = decimal.NewFromFloat(0.1)
	}
	c.prices[symbol] = newBase

	spread := tick.Mul(decimal.NewFromFloat(2))
	half := spread.Div(decimal.NewFromFloat(2))

	return &broker.Quote{
		Symbol:    symbol,
		Bid:       newBase.Sub(half).Round(3),
		Ask:       newBase.Add(half).Round(3),
		Last:      newBase.Round(3),
		Volume:    int64(500000 + rand.Intn(2000000)),
		Timestamp: time.Now(),
	}, nil
}

func (c *Client) PlaceOrder(_ context.Context, symbol string, side broker.Side, qty int64, price decimal.Decimal, orderType broker.OrderType) (*broker.Order, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.nextID++
	id := fmt.Sprintf("MOCK-%05d", c.nextID)

	fillPrice := price
	if orderType == broker.Market {
		base := c.prices[symbol]
		tick := tickSize(base)
		if side == broker.Buy {
			fillPrice = base.Add(tick).Round(3)
		} else {
			fillPrice = base.Sub(tick).Round(3)
		}
	}

	cost := fillPrice.Mul(decimal.NewFromInt(qty))
	commission := calcCommission(cost.InexactFloat64(), 10.0, 0.0008)

	if side == broker.Buy {
		total := cost.Add(commission)
		if total.GreaterThan(c.cash) {
			return nil, fmt.Errorf("insufficient funds: need %s, have %s", total, c.cash)
		}
		c.cash = c.cash.Sub(total)

		pos := c.positions[symbol]
		if pos == nil {
			c.positions[symbol] = &broker.Position{
				Symbol:    symbol,
				Qty:       qty,
				AvgCost:   fillPrice,
				EnteredAt: time.Now(),
			}
		} else {
			totalShares := pos.Qty + qty
			pos.AvgCost = pos.AvgCost.Mul(decimal.NewFromInt(pos.Qty)).
				Add(fillPrice.Mul(decimal.NewFromInt(qty))).
				Div(decimal.NewFromInt(totalShares)).Round(3)
			pos.Qty = totalShares
		}
	} else {
		pos := c.positions[symbol]
		if pos == nil || pos.Qty < qty {
			return nil, fmt.Errorf("insufficient position for %s", symbol)
		}
		proceeds := fillPrice.Mul(decimal.NewFromInt(qty)).Sub(commission)
		c.cash = c.cash.Add(proceeds)
		pos.Qty -= qty
		if pos.Qty == 0 {
			delete(c.positions, symbol)
		}
	}

	ord := &broker.Order{
		ID:        id,
		Symbol:    symbol,
		Side:      side,
		Type:      orderType,
		Qty:       qty,
		Price:     price,
		Status:    broker.Filled,
		FillPrice: fillPrice,
		FillQty:   qty,
		CreatedAt: time.Now(),
		FilledAt:  time.Now(),
	}
	c.orders[id] = ord
	return ord, nil
}

func (c *Client) GetOrder(_ context.Context, orderID string) (*broker.Order, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ord, ok := c.orders[orderID]
	if !ok {
		return nil, fmt.Errorf("order %s not found", orderID)
	}
	return ord, nil
}

func (c *Client) CancelOrder(_ context.Context, orderID string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	ord, ok := c.orders[orderID]
	if !ok {
		return fmt.Errorf("order %s not found", orderID)
	}
	ord.Status = broker.Cancelled
	return nil
}

func (c *Client) GetPosition(_ context.Context, symbol string) (*broker.Position, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	pos := c.positions[symbol]
	return pos, nil
}

func (c *Client) AccountBalance(_ context.Context) (decimal.Decimal, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.cash, nil
}

// tickSize returns the SGX minimum price movement for a given price level.
// SGX schedule: <0.20 → 0.001, 0.20-1.99 → 0.005, ≥2.00 → 0.01
func tickSize(price decimal.Decimal) decimal.Decimal {
	if price.LessThan(decimal.NewFromFloat(0.20)) {
		return decimal.NewFromFloat(0.001)
	}
	if price.LessThan(decimal.NewFromFloat(2.00)) {
		return decimal.NewFromFloat(0.005)
	}
	return decimal.NewFromFloat(0.01)
}

func calcCommission(tradeValue, minCommission, rate float64) decimal.Decimal {
	calc := tradeValue * rate
	if calc < minCommission {
		calc = minCommission
	}
	return decimal.NewFromFloat(calc).Round(2)
}
