#!/usr/bin/env python3
"""
SGX Micro-Profit Scalping Bot — Moomoo edition
===============================================
Usage:
  python main.py                     # paper trading (no OpenD needed)
  python main.py --live              # real Moomoo account (OpenD must be running)
  python main.py --config my.yaml    # use custom config file
"""
import argparse
import logging
import signal
import sys
import time

import yaml

from broker.paper_broker import PaperBroker
from market.screener import screen
from market.session import is_market_open, seconds_until_open
from risk.manager import RiskManager
from strategy.scalper import Quote, Scalper

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("main")


def load_config(path: str) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--live", action="store_true", help="use real Moomoo account via OpenD")
    parser.add_argument("--paper", action="store_true", help="force paper trading (default)")
    args = parser.parse_args()

    cfg = load_config(args.config)

    # broker selection
    risk_cfg      = cfg["risk"]
    total_capital = risk_cfg.get("total_capital_sgd", 1_000)   # broker account size
    per_pos_sgd   = risk_cfg.get("max_position_sgd", 333)       # per-position limit

    if args.live:
        from broker.moomoo_broker import MoomooBroker  # requires moomoo-api + OpenD
        opend = cfg["opend"]
        broker = MoomooBroker(
            host=opend["host"],
            port=opend["port"],
            trade_env="REAL",
        )
        broker.connect()
        log.warning("=== LIVE TRADING MODE — REAL MONEY AT RISK ===")
        log.warning("=== Capital: S$%d total / S$%d per position ===", total_capital, per_pos_sgd)
    elif cfg["opend"].get("trade_env", "SIMULATE").upper() == "SIMULATE" and not args.live:
        if cfg["opend"].get("use_opend_simulate", False):
            broker = MoomooBroker(
                host=cfg["opend"]["host"],
                port=cfg["opend"]["port"],
                trade_env="SIMULATE",
            )
            broker.connect()
            log.info("connected to Moomoo SIMULATE environment")
        else:
            broker = PaperBroker(
                initial_cash=float(total_capital),
                commission_rate=risk_cfg["commission_rate"],
                min_commission=risk_cfg["min_commission_sgd"],
            )
            log.info("paper trading | capital=S$%d  per_pos=S$%d", total_capital, per_pos_sgd)
    else:
        broker = PaperBroker(
            initial_cash=float(total_capital),
            commission_rate=risk_cfg["commission_rate"],
            min_commission=risk_cfg["min_commission_sgd"],
        )
        log.info("paper trading | capital=S$%d  per_pos=S$%d", total_capital, per_pos_sgd)

    strategy_cfg = cfg["strategy"]
    # propagate per-position limit so scalper sizes positions correctly
    strategy_cfg["max_position_sgd"] = per_pos_sgd

    raw_watchlist: list[str] = cfg["watchlist"]

    risk = RiskManager(risk_cfg)
    scalper = Scalper(cfg=strategy_cfg, risk=risk, broker=broker)

    poll_interval: float = strategy_cfg.get("poll_interval_sec", 0.5)
    stats_interval: float = 300  # log stats every 5 minutes
    last_stats   = time.time()
    last_screen  = 0.0           # force screen on first open
    screen_every = 1800.0        # re-run screener every 30 min
    watchlist: list[str] = raw_watchlist  # active (screened) list

    # graceful shutdown
    shutdown = False
    def _sig_handler(sig, frame):
        nonlocal shutdown
        log.info("shutdown signal received")
        shutdown = True
    signal.signal(signal.SIGINT,  _sig_handler)
    signal.signal(signal.SIGTERM, _sig_handler)

    log.info("bot started | capital=S$%d  per_pos=S$%d | watchlist=%d symbols | poll=%.1fs",
             total_capital, per_pos_sgd, len(raw_watchlist), poll_interval)

    while not shutdown:
        if not is_market_open():
            wait = seconds_until_open()
            if wait > 60:
                log.info("market closed — sleeping %.0f minutes until next open", wait / 60)
                # sleep in chunks so we can catch shutdown signals
                for _ in range(int(wait / 5)):
                    if shutdown:
                        break
                    time.sleep(5)
                continue
            else:
                time.sleep(poll_interval)
                continue

        # run screener at market open and every 30 min to adapt to changing liquidity
        now = time.time()
        if now - last_screen >= screen_every:
            screener_cfg = {
                "max_price_sgd":    strategy_cfg.get("max_price_sgd", 3.00),
                "min_volume":       strategy_cfg.get("min_volume", 1_000_000),
                "max_position_sgd": per_pos_sgd,
            }
            screened = screen(broker, raw_watchlist, screener_cfg)
            # Cap to best-N so weaker stocks never displace top-ranked ones
            max_cands = strategy_cfg.get("max_candidates", len(raw_watchlist))
            watchlist = (screened or raw_watchlist)[:max_cands]
            strategy_cfg["watchlist"] = watchlist
            # rebuild scalper history for new watchlist symbols
            for sym in watchlist:
                scalper._history.setdefault(sym, __import__("collections").deque(
                    maxlen=strategy_cfg["momentum_period"] + 2))
            last_screen = now
            log.info("screener selected %d symbols: %s", len(watchlist), watchlist)

        # poll all symbols
        for sym in watchlist:
            if shutdown:
                break
            raw = broker.get_quote(sym)
            if raw is None:
                continue
            q = Quote(
                symbol=raw["symbol"],
                bid=raw["bid"],
                ask=raw["ask"],
                last=raw["last"],
                volume=raw["volume"],
            )
            scalper.on_quote(q)

        # periodic stats
        now = time.time()
        if now - last_stats >= stats_interval:
            s = risk.summary()
            bal = broker.get_balance()
            log.info(
                "=== STATS | trades=%d open=%d pnl=%+.2f SGD balance=%.2f SGD ===",
                s["trades"], s["open"], s["daily_pnl"], bal,
            )
            last_stats = now

        time.sleep(poll_interval)

    # cleanup
    s = risk.summary()
    bal = broker.get_balance()
    log.info("=== FINAL | trades=%d pnl=%+.2f SGD balance=%.2f SGD ===",
             s["trades"], s["daily_pnl"], bal)
    if hasattr(broker, "close"):
        broker.close()


if __name__ == "__main__":
    main()
