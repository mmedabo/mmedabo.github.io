"""Tests for RiskManager — limits, commission calculation, PnL tracking."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from risk.manager import RiskManager

CFG = {
    "max_position_sgd":   10_000,
    "max_daily_loss_sgd": 200,
    "max_open_positions": 3,
    "max_trades_per_day": 5,
    "commission_rate":    0.0003,
    "min_commission_sgd": 0.99,
}


def rm():
    return RiskManager(CFG)


# --- commission_for ---

def test_commission_uses_percentage_above_minimum():
    r = rm()
    # S$10,000 × 0.03% = S$3.00 > S$0.99 min
    assert r.commission_for(10_000) == pytest.approx(3.00, abs=0.001)


def test_commission_uses_minimum_for_small_trades():
    r = rm()
    # S$100 × 0.03% = S$0.03 < S$0.99 min → uses S$0.99
    assert r.commission_for(100) == pytest.approx(0.99, abs=0.001)


# --- expected_net_pnl ---

def test_profitable_trade_positive_net():
    r = rm()
    # 3200 shares × S$1.50, 1 tick profit = 3200 × 0.005 = S$16 gross
    # commission one-way = max(4800 × 0.0003, 0.99) = S$1.44
    # net = 16 - 2×1.44 = S$13.12
    gross = 3200 * 0.005
    net = r.expected_net_pnl(gross, 3200 * 1.50)
    assert net > 0


def test_unprofitable_trade_negative_net():
    r = rm()
    # 100 shares × S$1.50 = S$150, 1 tick = S$0.50 gross, commission = S$0.99 × 2 = S$1.98
    gross = 100 * 0.005
    net = r.expected_net_pnl(gross, 100 * 1.50)
    assert net < 0


# --- can_open ---

def test_can_open_allows_valid_trade():
    r = rm()
    ok, reason = r.can_open(5_000)
    assert ok and reason == ""


def test_can_open_blocks_when_max_positions_reached():
    r = rm()
    for _ in range(CFG["max_open_positions"]):
        r.record_open()
    ok, reason = r.can_open(5_000)
    assert not ok
    assert "max open positions" in reason


def test_can_open_blocks_when_max_trades_reached():
    r = rm()
    for _ in range(CFG["max_trades_per_day"]):
        r.record_open()
        r.record_close("X", 1.0)
    ok, reason = r.can_open(5_000)
    assert not ok
    assert "max daily trades" in reason


def test_can_open_blocks_when_daily_loss_exceeded():
    r = rm()
    r.record_close("X", -200.00)   # hit S$200 limit
    ok, reason = r.can_open(5_000)
    assert not ok
    assert "daily loss limit" in reason


def test_can_open_blocks_oversized_position():
    r = rm()
    ok, reason = r.can_open(CFG["max_position_sgd"] + 1)
    assert not ok
    assert "limit" in reason


# --- record_open / record_close ---

def test_open_count_increments_on_open():
    r = rm()
    r.record_open()
    assert r.summary()["open"] == 1


def test_open_count_decrements_on_close():
    r = rm()
    r.record_open()
    r.record_close("X", 5.0)
    assert r.summary()["open"] == 0


def test_open_count_never_below_zero():
    r = rm()
    r.record_close("X", 0.0)   # close without a prior open
    assert r.summary()["open"] == 0


def test_daily_pnl_accumulates_wins_and_losses():
    r = rm()
    r.record_close("A", +10.50)
    r.record_close("B", -3.20)
    r.record_close("C", +5.75)
    assert r.summary()["daily_pnl"] == pytest.approx(13.05, abs=0.01)


def test_daily_pnl_many_cycles_no_drift():
    """Summing many small floats should not drift beyond 1 cent."""
    r = rm()
    for _ in range(1000):
        r.record_close("X", 0.123)
    expected = round(0.123 * 1000, 2)
    assert abs(r.summary()["daily_pnl"] - expected) < 0.01


# --- summary ---

def test_summary_trade_count():
    r = rm()
    r.record_open()
    r.record_open()
    assert r.summary()["trades"] == 2


def test_summary_returns_rounded_pnl():
    r = rm()
    r.record_close("X", 1.123456789)
    pnl = r.summary()["daily_pnl"]
    assert pnl == round(pnl, 2)
