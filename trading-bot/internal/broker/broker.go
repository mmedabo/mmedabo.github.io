package broker

import (
	"context"
	"time"

	"github.com/shopspring/decimal"
)

type Side string

const (
	Buy  Side = "BUY"
	Sell Side = "SELL"
)

type OrderType string

const (
	Limit  OrderType = "LIMIT"
	Market OrderType = "MARKET"
)

type OrderStatus string

const (
	Pending   OrderStatus = "PENDING"
	Filled    OrderStatus = "FILLED"
	Cancelled OrderStatus = "CANCELLED"
	Rejected  OrderStatus = "REJECTED"
)

type Quote struct {
	Symbol    string
	Bid       decimal.Decimal
	Ask       decimal.Decimal
	Last      decimal.Decimal
	Volume    int64
	Timestamp time.Time
}

type Order struct {
	ID        string
	Symbol    string
	Side      Side
	Type      OrderType
	Qty       int64
	Price     decimal.Decimal
	Status    OrderStatus
	FillPrice decimal.Decimal
	FillQty   int64
	CreatedAt time.Time
	FilledAt  time.Time
}

type Position struct {
	Symbol    string
	Qty       int64
	AvgCost   decimal.Decimal
	EnteredAt time.Time
}

// Broker abstracts the exchange/broker connection.
type Broker interface {
	// GetQuote fetches the latest L1 quote for a symbol.
	GetQuote(ctx context.Context, symbol string) (*Quote, error)

	// PlaceOrder submits an order and returns its ID.
	PlaceOrder(ctx context.Context, symbol string, side Side, qty int64, price decimal.Decimal, orderType OrderType) (*Order, error)

	// GetOrder fetches order status by ID.
	GetOrder(ctx context.Context, orderID string) (*Order, error)

	// CancelOrder cancels a pending order.
	CancelOrder(ctx context.Context, orderID string) error

	// GetPosition returns the current position for a symbol (nil if flat).
	GetPosition(ctx context.Context, symbol string) (*Position, error)

	// AccountBalance returns available cash in SGD.
	AccountBalance(ctx context.Context) (decimal.Decimal, error)

	// Name returns the broker identifier for logging.
	Name() string
}
