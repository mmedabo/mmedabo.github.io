package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Broker   BrokerConfig   `yaml:"broker"`
	Strategy StrategyConfig `yaml:"strategy"`
	Risk     RiskConfig     `yaml:"risk"`
	Watchlist []string      `yaml:"watchlist"`
}

type BrokerConfig struct {
	Mode        string `yaml:"mode"` // "paper" or "live"
	TigerID     string `yaml:"tiger_id"`
	AccountID   string `yaml:"account_id"`
	PrivateKey  string `yaml:"private_key_path"`
	Region      string `yaml:"region"` // "SG"
}

type StrategyConfig struct {
	MinSpreadTicks    int     `yaml:"min_spread_ticks"`    // minimum bid-ask spread in ticks to enter
	TargetProfitTicks int     `yaml:"target_profit_ticks"` // ticks of profit per trade
	StopLossTicks     int     `yaml:"stop_loss_ticks"`     // ticks to stop loss
	MaxHoldSeconds    int     `yaml:"max_hold_seconds"`    // force exit after N seconds
	MinVolume         int64   `yaml:"min_volume"`          // minimum daily volume to consider trading
	MomentumPeriod    int     `yaml:"momentum_period"`     // ticks to compute momentum
	TickIntervalMs    int     `yaml:"tick_interval_ms"`    // polling interval in ms
}

type RiskConfig struct {
	MaxPositionSGD     float64 `yaml:"max_position_sgd"`    // max single position in SGD
	MaxDailyLossSGD    float64 `yaml:"max_daily_loss_sgd"`  // max daily loss in SGD
	MaxOpenPositions   int     `yaml:"max_open_positions"`  // concurrent positions
	MinCommissionSGD   float64 `yaml:"min_commission_sgd"`  // broker min commission (e.g. 10.0)
	CommissionRate     float64 `yaml:"commission_rate"`     // e.g. 0.0008 (0.08%)
	MaxTradesPerDay    int     `yaml:"max_trades_per_day"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	return &cfg, nil
}

func Default() *Config {
	return &Config{
		Broker: BrokerConfig{
			Mode:   "paper",
			Region: "SG",
		},
		Strategy: StrategyConfig{
			MinSpreadTicks:    2,
			TargetProfitTicks: 4, // 4 ticks to clear round-trip commission on S$10k position
			StopLossTicks:     3,
			MaxHoldSeconds:    120,
			MinVolume:         500000,
			MomentumPeriod:    5,
			TickIntervalMs:    500,
		},
		Risk: RiskConfig{
			MaxPositionSGD:   10000,   // S$10k per position → ~270 DBS shares at S$36
			MaxDailyLossSGD:  300,
			MaxOpenPositions: 3,
			MinCommissionSGD: 1.99,    // Tiger Brokers SGX rate (S$1.99 min)
			CommissionRate:   0.0006,  // 0.06%
			MaxTradesPerDay:  50,
		},
		Watchlist: []string{
			"D05.SI",  // DBS Group
			"O39.SI",  // OCBC Bank
			"U11.SI",  // UOB
			"Z74.SI",  // SingTel
			"F34.SI",  // Wilmar
			"BN4.SI",  // Keppel Corp
			"C6L.SI",  // Singapore Airlines
			"V03.SI",  // Venture Corp
		},
	}
}
