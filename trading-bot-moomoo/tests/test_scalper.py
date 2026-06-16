"""Unit tests for the scalping strategy using the paper broker."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import time
import pytest

from broker.paper_broker import PaperBroker
from risk.manager import RiskManager
from strategy.scalper import Quote, Scalper

DEFAULT_CFG = {
    "min_spread_ticks": 2,
    "target_profit_ticks": 1,
    "stop_loss_ticks": 3,
    "max_hold_seconds": 5,
    "min_volume": 100_000,
    "momentum_period": 3,
    "max_position_sgd": 5000,
    "watchlist": ["Y92.SI"],
}

RISK_CFG = {
    "max_position_sgd": 5000,
    "max_daily_loss_sgd": 300,
    "max_open_positions": 3,
    "max_trades_per_day": 50,
    "commission_rate": 0.0003,
    "min_commission_sgd": 0.99,
}


def make_quote(bid: float, ask: float) -> Quote:
    return Quote(
        symbol="Y92.SI",
        bid=bid,
        ask=ask,
        last=(bid + ask) / 2,
        volume=1_000_000,
    )


def setup():
    broker = PaperBroker(initial_cash=50_000)
    risk = RiskManager(RISK_CFG)
    scalper = Scalper(cfg=DEFAULT_CFG, risk=risk, broker=broker)
    return scalper, broker, risk


def test_no_entry_without_history():
    scalper, _, _ = setup()
    scalper.on_quote(make_quote(1.500, 1.510))
    assert scalper.open_symbols == []


def test_entry_on_up_momentum():
    """Up-trending prices → bot buys."""
    scalper, _, _ = setup()
    # ascending mid prices; spread = 0.01 = 2 ticks at S$1.50 price ✓
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        scalper.on_quote(make_quote(bid, ask))
    assert "Y92.SI" in scalper.open_symbols, "expected entry on clear up-momentum"


def test_no_entry_on_insufficient_spread():
    """Spread < 2 ticks → no entry."""
    scalper, _, _ = setup()
    # spread = 0.001 = 0.2 ticks (below threshold)
    for bid, ask in [(1.490, 1.491), (1.495, 1.496), (1.500, 1.501), (1.505, 1.506)]:
        scalper.on_quote(make_quote(bid, ask))
    assert scalper.open_symbols == [], "should not enter with tiny spread"


def test_exit_on_timeout():
    """Trade force-exits after MaxHoldSeconds."""
    scalper, _, _ = setup()
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        scalper.on_quote(make_quote(bid, ask))

    if not scalper.open_symbols:
        pytest.skip("no trade opened — check entry conditions")

    time.sleep(6)  # max_hold_seconds = 5
    scalper.on_quote(make_quote(1.505, 1.515))
    assert scalper.open_symbols == [], "trade should have timed out"


def test_daily_loss_halts_trading():
    """After hitting daily loss limit, no new positions open."""
    scalper, _, risk = setup()
    risk.record_close("Y92.SI", -301.0)  # exceed S$300 daily loss limit
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        scalper.on_quote(make_quote(bid, ask))
    assert scalper.open_symbols == [], "should not trade after daily loss limit"
