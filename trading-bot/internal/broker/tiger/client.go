// Package tiger wraps Tiger Brokers Open API for SGX trading.
// Docs: https://quant.tigerbrokers.com.sg/docs
package tiger

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha1" //nolint:gosec — Tiger API requires SHA1
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/mmedabo/trading-bot/internal/broker"
	"github.com/shopspring/decimal"
)

const (
	baseURLProd    = "https://openapi.tigerbrokers.com"
	baseURLSandbox = "https://openapi-sandbox.tigerbrokers.com"
)

type Client struct {
	tigerID    string
	accountID  string
	privateKey *rsa.PrivateKey
	httpClient *http.Client
	baseURL    string
}

type Config struct {
	TigerID        string
	AccountID      string
	PrivateKeyPath string
	Sandbox        bool
}

func New(cfg Config) (*Client, error) {
	key, err := loadPrivateKey(cfg.PrivateKeyPath)
	if err != nil {
		return nil, fmt.Errorf("tiger: load private key: %w", err)
	}

	base := baseURLProd
	if cfg.Sandbox {
		base = baseURLSandbox
	}

	return &Client{
		tigerID:    cfg.TigerID,
		accountID:  cfg.AccountID,
		privateKey: key,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		baseURL:    base,
	}, nil
}

func (c *Client) Name() string { return "tiger" }

// --- Quote ---

type quoteResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		Items []struct {
			Symbol      string  `json:"symbol"`
			AskPrice    float64 `json:"askPrice"`
			BidPrice    float64 `json:"bidPrice"`
			LatestPrice float64 `json:"latestPrice"`
			Volume      int64   `json:"volume"`
			Timestamp   int64   `json:"latestTime"`
		} `json:"items"`
	} `json:"data"`
}

func (c *Client) GetQuote(ctx context.Context, symbol string) (*broker.Quote, error) {
	params := map[string]string{
		"symbols": symbol,
		"market":  "SG",
	}
	var resp quoteResponse
	if err := c.get(ctx, "/openapi/quote/v2/snapshot", params, &resp); err != nil {
		return nil, err
	}
	if len(resp.Data.Items) == 0 {
		return nil, fmt.Errorf("no quote data for %s", symbol)
	}
	item := resp.Data.Items[0]
	return &broker.Quote{
		Symbol:    symbol,
		Bid:       decimal.NewFromFloat(item.BidPrice),
		Ask:       decimal.NewFromFloat(item.AskPrice),
		Last:      decimal.NewFromFloat(item.LatestPrice),
		Volume:    item.Volume,
		Timestamp: time.UnixMilli(item.Timestamp),
	}, nil
}

// --- Order placement ---

type orderRequest struct {
	Account   string `json:"account"`
	Symbol    string `json:"symbol"`
	Market    string `json:"market"`
	Action    string `json:"action"`
	OrderType string `json:"orderType"`
	TotalQty  int64  `json:"totalQuantity"`
	LimitPrice float64 `json:"limitPrice,omitempty"`
}

type orderResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		OrderID string `json:"orderId"`
	} `json:"data"`
}

func (c *Client) PlaceOrder(ctx context.Context, symbol string, side broker.Side, qty int64, price decimal.Decimal, orderType broker.OrderType) (*broker.Order, error) {
	req := orderRequest{
		Account:   c.accountID,
		Symbol:    symbol,
		Market:    "SG",
		Action:    string(side),
		OrderType: string(orderType),
		TotalQty:  qty,
	}
	if orderType == broker.Limit {
		req.LimitPrice, _ = price.Float64()
	}

	var resp orderResponse
	if err := c.post(ctx, "/openapi/trade/v2/order/place", req, &resp); err != nil {
		return nil, err
	}

	return &broker.Order{
		ID:        resp.Data.OrderID,
		Symbol:    symbol,
		Side:      side,
		Type:      orderType,
		Qty:       qty,
		Price:     price,
		Status:    broker.Pending,
		CreatedAt: time.Now(),
	}, nil
}

// --- Order status ---

type orderStatusResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		Status    string  `json:"status"`
		FilledQty int64   `json:"filledQuantity"`
		AvgPrice  float64 `json:"avgFilledPrice"`
	} `json:"data"`
}

func (c *Client) GetOrder(ctx context.Context, orderID string) (*broker.Order, error) {
	params := map[string]string{
		"account": c.accountID,
		"orderId": orderID,
	}
	var resp orderStatusResponse
	if err := c.get(ctx, "/openapi/trade/v2/order", params, &resp); err != nil {
		return nil, err
	}
	return &broker.Order{
		ID:        orderID,
		Status:    mapStatus(resp.Data.Status),
		FillQty:   resp.Data.FilledQty,
		FillPrice: decimal.NewFromFloat(resp.Data.AvgPrice),
	}, nil
}

func mapStatus(s string) broker.OrderStatus {
	switch strings.ToUpper(s) {
	case "FILLED":
		return broker.Filled
	case "CANCELLED", "CANCELED":
		return broker.Cancelled
	case "REJECTED":
		return broker.Rejected
	default:
		return broker.Pending
	}
}

// --- Cancel order ---

func (c *Client) CancelOrder(ctx context.Context, orderID string) error {
	body := map[string]string{"account": c.accountID, "orderId": orderID}
	var resp struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	return c.post(ctx, "/openapi/trade/v2/order/cancel", body, &resp)
}

// --- Position ---

type positionResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		Items []struct {
			Symbol   string  `json:"symbol"`
			Position int64   `json:"position"`
			AvgCost  float64 `json:"averageCost"`
		} `json:"items"`
	} `json:"data"`
}

func (c *Client) GetPosition(ctx context.Context, symbol string) (*broker.Position, error) {
	params := map[string]string{"account": c.accountID, "market": "SG"}
	var resp positionResponse
	if err := c.get(ctx, "/openapi/trade/v2/positions", params, &resp); err != nil {
		return nil, err
	}
	for _, item := range resp.Data.Items {
		if item.Symbol == symbol && item.Position > 0 {
			return &broker.Position{
				Symbol:  symbol,
				Qty:     item.Position,
				AvgCost: decimal.NewFromFloat(item.AvgCost),
			}, nil
		}
	}
	return nil, nil
}

// --- Account balance ---

type balanceResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		Cash float64 `json:"cashBalance"`
	} `json:"data"`
}

func (c *Client) AccountBalance(ctx context.Context) (decimal.Decimal, error) {
	params := map[string]string{"account": c.accountID}
	var resp balanceResponse
	if err := c.get(ctx, "/openapi/trade/v2/account/balance", params, &resp); err != nil {
		return decimal.Zero, err
	}
	return decimal.NewFromFloat(resp.Data.Cash), nil
}

// --- HTTP helpers ---

func (c *Client) get(ctx context.Context, path string, params map[string]string, out any) error {
	// build canonical query string for signing
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+params[k])
	}
	query := strings.Join(parts, "&")

	ts := fmt.Sprintf("%d", time.Now().UnixMilli())
	signStr := fmt.Sprintf("%s\n%s\n%s\n%s", c.tigerID, ts, path, query)
	sig, err := sign(c.privateKey, signStr)
	if err != nil {
		return fmt.Errorf("sign: %w", err)
	}

	url := c.baseURL + path + "?" + query
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Tiger-Sign", sig)
	req.Header.Set("X-Tiger-Timestamp", ts)
	req.Header.Set("X-Tiger-Id", c.tigerID)

	return c.do(req, out)
}

func (c *Client) post(ctx context.Context, path string, body any, out any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}

	ts := fmt.Sprintf("%d", time.Now().UnixMilli())
	signStr := fmt.Sprintf("%s\n%s\n%s\n%s", c.tigerID, ts, path, string(data))
	sig, err := sign(c.privateKey, signStr)
	if err != nil {
		return fmt.Errorf("sign: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, strings.NewReader(string(data)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tiger-Sign", sig)
	req.Header.Set("X-Tiger-Timestamp", ts)
	req.Header.Set("X-Tiger-Id", c.tigerID)

	return c.do(req, out)
}

func (c *Client) do(req *http.Request, out any) error {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("tiger api %d: %s", resp.StatusCode, raw)
	}
	return json.Unmarshal(raw, out)
}

// --- RSA signing ---

func loadPrivateKey(path string) (*rsa.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("invalid PEM")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("not an RSA key")
	}
	return rsaKey, nil
}

func sign(key *rsa.PrivateKey, msg string) (string, error) {
	//nolint:gosec — Tiger API mandates SHA1 for request signing
	h := sha1.New()
	h.Write([]byte(msg))
	digest := h.Sum(nil)

	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA1, digest)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(sig), nil
}
