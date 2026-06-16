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
import time
from collections import deque

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
    try:
        with open(path) as f:
            cfg = yaml.safe_load(f)
    except FileNotFoundError:
        raise SystemExit(f"Config file not found: {path}")
    except yaml.YAMLError as e:
        raise SystemExit(f"Invalid YAML in config: {e}")
    if not isinstance(cfg, dict):
        raise SystemExit(f"Config must be a YAML mapping: {path}")
    return cfg


def _validate_config(cfg: dict) -> None:
    """Fail fast if required config values are missing or out of range."""
    def _pos(section: str, key: str, val) -> None:
        if not isinstance(val, (int, float)) or val <= 0:
            raise SystemExit(
                f"config[{section}][{key}] must be a positive number, got {val!r}"
            )

    risk  = cfg.get("risk", {})
    strat = cfg.get("strategy", {})
    opend = cfg.get("opend", {})

    for k in ("total_capital_sgd", "max_position_sgd", "max_daily_loss_sgd",
              "max_open_positions", "commission_rate", "min_commission_sgd"):
        _pos("risk", k, risk.get(k))

    for k in ("momentum_period", "min_spread_ticks", "target_profit_ticks",
              "stop_loss_ticks", "max_hold_seconds"):
        _pos("strategy", k, strat.get(k))

    port = opend.get("port", 11111)
    if not isinstance(port, int) or not (1 <= port <= 65535):
        raise SystemExit(
            f"config[opend][port] must be an integer 1–65535, got {port!r}"
        )

    host = opend.get("host", "127.0.0.1")
    if host not in ("127.0.0.1", "localhost"):
        log.warning(
            "config[opend][host]=%r — OpenD is typically local-only; "
            "connecting to a remote host is not recommended", host
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--live",  action="store_true", help="use real Moomoo account via OpenD")
    parser.add_argument("--paper", action="store_true", help="force paper trading (default)")
    args = parser.parse_args()

    cfg = load_config(args.config)
    _validate_config(cfg)

    # ── broker selection ──────────────────────────────────────────────────
    risk_cfg      = cfg["risk"]
    total_capital = risk_cfg.get("total_capital_sgd", 1_000)  # broker account size
    per_pos_sgd   = risk_cfg.get("max_position_sgd", 333)      # per-position limit
    min_capital   = risk_cfg.get("min_capital_sgd", 0)         # capital floor (0 = disabled)

    if args.live:
        from broker.moomoo_broker import MoomooBroker  # requires moomoo-api + OpenD
        opend = cfg["opend"]
        try:
            broker = MoomooBroker(host=opend["host"], port=opend["port"], trade_env="REAL")
            broker.connect()
        except Exception as e:
            raise SystemExit(f"Failed to connect to Moomoo OpenD (REAL): {e}")
        log.warning("=== LIVE TRADING MODE — REAL MONEY AT RISK ===")
        log.warning("=== Capital: S$%d total / S$%d per position ===", total_capital, per_pos_sgd)
    elif cfg["opend"].get("use_opend_simulate", False):
        from broker.moomoo_broker import MoomooBroker
        try:
            broker = MoomooBroker(
                host=cfg["opend"]["host"], port=cfg["opend"]["port"], trade_env="SIMULATE"
            )
            broker.connect()
        except Exception as e:
            raise SystemExit(f"Failed to connect to Moomoo OpenD (SIMULATE): {e}")
        log.info("connected to Moomoo SIMULATE environment")
    else:
        broker = PaperBroker(
            initial_cash=float(total_capital),
            commission_rate=risk_cfg["commission_rate"],
            min_commission=risk_cfg["min_commission_sgd"],
        )
        log.info("paper trading | capital=S$%d  per_pos=S$%d  floor=S$%d",
                 total_capital, per_pos_sgd, min_capital)

    # ── strategy / risk ───────────────────────────────────────────────────
    strategy_cfg = cfg["strategy"]
    strategy_cfg["max_position_sgd"] = per_pos_sgd  # position sizing uses per-slot limit

    raw_watchlist: list[str] = cfg["watchlist"]
    risk   = RiskManager(risk_cfg)
    scalper = Scalper(cfg=strategy_cfg, risk=risk, broker=broker)

    poll_interval: float = strategy_cfg.get("poll_interval_sec", 0.5)
    stats_interval        = 300.0   # log stats every 5 minutes
    screen_every          = 1800.0  # re-run screener every 30 minutes
    last_stats   = time.time()
    last_screen  = 0.0              # force screen on first market open
    watchlist: list[str] = raw_watchlist

    # ── graceful shutdown ─────────────────────────────────────────────────
    shutdown = False

    def _sig_handler(sig, frame):
        nonlocal shutdown
        log.info("shutdown signal received")
        shutdown = True

    signal.signal(signal.SIGINT,  _sig_handler)
    signal.signal(signal.SIGTERM, _sig_handler)

    log.info("bot started | capital=S$%d  per_pos=S$%d  floor=S$%d | "
             "watchlist=%d symbols | poll=%.1fs",
             total_capital, per_pos_sgd, min_capital, len(raw_watchlist), poll_interval)

    # ── main loop ─────────────────────────────────────────────────────────
    while not shutdown:
        # ── wait for market open ──────────────────────────────────────────
        if not is_market_open():
            wait = seconds_until_open()
            if wait > 60:
                log.info("market closed — sleeping %.0f minutes until next open", wait / 60)
                for _ in range(int(wait / 5)):
                    if shutdown:
                        break
                    time.sleep(5)
            else:
                time.sleep(poll_interval)
            continue

        # ── capital floor check (protects against multi-day drawdown) ─────
        if min_capital > 0:
            balance = broker.get_balance()
            if balance < min_capital:
                log.critical(
                    "CAPITAL FLOOR BREACHED: balance S$%.2f < floor S$%.2f — "
                    "halting permanently. Restart manually after reviewing strategy.",
                    balance, min_capital,
                )
                break

        # ── screener: refresh every 30 min to adapt to liquidity changes ──
        now = time.time()
        if now - last_screen >= screen_every:
            screener_cfg = {
                "max_price_sgd":    strategy_cfg.get("max_price_sgd", 3.00),
                "min_volume":       strategy_cfg.get("min_volume", 1_000_000),
                "max_position_sgd": per_pos_sgd,
            }
            screened  = screen(broker, raw_watchlist, screener_cfg)
            max_cands = strategy_cfg.get("max_candidates", len(raw_watchlist))
            watchlist = (screened or raw_watchlist)[:max_cands]
            strategy_cfg["watchlist"] = watchlist
            window = strategy_cfg["momentum_period"] + 2
            for sym in watchlist:
                scalper._history.setdefault(sym, deque(maxlen=window))
            last_screen = now
            log.info("screener selected %d symbols: %s", len(watchlist), watchlist)

        # ── poll all symbols (snapshot avoids mutation during iteration) ──
        for sym in list(watchlist):
            if shutdown:
                break
            raw = broker.get_quote(sym)
            if raw is None:
                continue
            scalper.on_quote(Quote(
                symbol=raw["symbol"],
                bid=raw["bid"],
                ask=raw["ask"],
                last=raw["last"],
                volume=raw["volume"],
            ))

        # ── periodic stats ────────────────────────────────────────────────
        now = time.time()
        if now - last_stats >= stats_interval:
            s = risk.summary()
            log.info(
                "=== STATS | trades=%d open=%d daily_pnl=%+.2f SGD balance=%.2f SGD ===",
                s["trades"], s["open"], s["daily_pnl"], broker.get_balance(),
            )
            last_stats = now

        time.sleep(poll_interval)

    # ── final summary ─────────────────────────────────────────────────────
    s = risk.summary()
    log.info("=== FINAL | trades=%d pnl=%+.2f SGD balance=%.2f SGD ===",
             s["trades"], s["daily_pnl"], broker.get_balance())
    if hasattr(broker, "close"):
        broker.close()


if __name__ == "__main__":
    main()
