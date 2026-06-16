package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/mmedabo/trading-bot/config"
	"github.com/mmedabo/trading-bot/internal/broker"
	"github.com/mmedabo/trading-bot/internal/broker/mock"
	"github.com/mmedabo/trading-bot/internal/broker/tiger"
	"github.com/mmedabo/trading-bot/internal/engine"
	"go.uber.org/zap"
)

func main() {
	cfgPath := flag.String("config", "", "path to config.yaml (optional; defaults to built-in defaults)")
	flag.Parse()

	log, err := zap.NewProduction()
	if err != nil {
		fmt.Fprintf(os.Stderr, "logger init: %v\n", err)
		os.Exit(1)
	}
	defer log.Sync()

	var cfg *config.Config
	if *cfgPath != "" {
		cfg, err = config.Load(*cfgPath)
		if err != nil {
			log.Fatal("load config", zap.Error(err))
		}
	} else {
		cfg = config.Default()
		log.Info("using default config (paper trading mode)")
	}

	var b broker.Broker

	switch cfg.Broker.Mode {
	case "live":
		b, err = tiger.New(tiger.Config{
			TigerID:        cfg.Broker.TigerID,
			AccountID:      cfg.Broker.AccountID,
			PrivateKeyPath: cfg.Broker.PrivateKey,
			Sandbox:        false,
		})
		if err != nil {
			log.Fatal("tiger broker init", zap.Error(err))
		}
		log.Warn("LIVE MODE — real money at risk")

	case "sandbox":
		b, err = tiger.New(tiger.Config{
			TigerID:        cfg.Broker.TigerID,
			AccountID:      cfg.Broker.AccountID,
			PrivateKeyPath: cfg.Broker.PrivateKey,
			Sandbox:        true,
		})
		if err != nil {
			log.Fatal("tiger sandbox init", zap.Error(err))
		}
		log.Info("running against Tiger sandbox")

	default:
		b = mock.New(50000.0) // S$50,000 paper account
		log.Info("running in paper trading mode")
	}

	eng := engine.New(cfg, log, b)
	eng.Run(context.Background())
}
