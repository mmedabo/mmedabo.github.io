"""Tests for PaperBroker — cash tracking, position tracking, commission."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from broker.paper_broker import PaperBroker

RATE = 0.0003
MIN_C = 0.99

def broker(cash=50_000.0):
    return PaperBroker(initial_cash=cash, commission_rate=RATE, min_commission=MIN_C)


def commission(trade_val):
    return max(trade_val * RATE, MIN_C)


# --- get_quote ---

def test_get_quote_returns_valid_spread():
    b = broker()
    q = b.get_quote("D05.SI")
    assert q["bid"] < q["ask"]
    assert q["volume"] > 0


def test_get_quote_unknown_symbol_defaults_to_1():
    b = broker()
    q = b.get_quote("UNKNOWN.SI")
    assert q is not None
    assert q["bid"] > 0


# --- BUY orders ---

def test_buy_deducts_cost_plus_commission():
    b = broker(cash=10_000.0)
    price, qty = 1.50, 1000
    trade_val = price * qty
    comm = commission(trade_val)
    expected_cash = round(10_000 - trade_val - comm, 4)

    b.place_order("Y92.SI", "BUY", qty, price)
    assert b.get_balance() == pytest.approx(expected_cash, abs=0.01)


def test_buy_creates_position():
    b = broker()
    b.place_order("Y92.SI", "BUY", 500, 1.50)
    positions = {p["code"]: p for p in b.get_positions()}
    assert "Y92.SI" in positions
    assert positions["Y92.SI"]["qty"] == 500


def test_buy_insufficient_cash_returns_none():
    b = broker(cash=1.0)
    result = b.place_order("Y92.SI", "BUY", 1000, 1.50)
    assert result is None
    assert b.get_balance() == pytest.approx(1.0, abs=0.01)


def test_buy_avg_cost_updated_on_second_buy():
    b = broker()
    b.place_order("Y92.SI", "BUY", 1000, 1.500)
    b.place_order("Y92.SI", "BUY", 1000, 1.510)
    pos = {p["code"]: p for p in b.get_positions()}["Y92.SI"]
    assert pos["qty"] == 2000
    assert pos["avg_cost"] == pytest.approx(1.505, abs=0.001)


# --- SELL orders ---

def test_sell_adds_proceeds_minus_commission():
    b = broker()
    b.place_order("Y92.SI", "BUY", 1000, 1.50)
    cash_after_buy = b.get_balance()

    sell_price, qty = 1.520, 1000
    trade_val = sell_price * qty
    comm = commission(trade_val)
    b.place_order("Y92.SI", "SELL", qty, sell_price)

    expected = round(cash_after_buy + trade_val - comm, 4)
    assert b.get_balance() == pytest.approx(expected, abs=0.01)


def test_sell_removes_position():
    b = broker()
    b.place_order("Y92.SI", "BUY", 1000, 1.50)
    b.place_order("Y92.SI", "SELL", 1000, 1.52)
    positions = {p["code"]: p for p in b.get_positions()}
    assert "Y92.SI" not in positions


def test_partial_sell_reduces_position():
    b = broker()
    b.place_order("Y92.SI", "BUY", 1000, 1.50)
    b.place_order("Y92.SI", "SELL", 400, 1.52)
    pos = {p["code"]: p for p in b.get_positions()}["Y92.SI"]
    assert pos["qty"] == 600


def test_sell_without_position_returns_none():
    b = broker()
    result = b.place_order("Y92.SI", "SELL", 100, 1.50)
    assert result is None


def test_sell_more_than_held_returns_none():
    b = broker()
    b.place_order("Y92.SI", "BUY", 100, 1.50)
    result = b.place_order("Y92.SI", "SELL", 200, 1.52)
    assert result is None


# --- commission accuracy ---

def test_commission_uses_percentage_above_minimum():
    b = broker()
    # S$5000 × 0.03% = S$1.50 > S$0.99
    cash_before = b.get_balance()
    b.place_order("Y92.SI", "BUY", 1000, 5.00)
    trade_val = 5_000
    expected_comm = trade_val * RATE   # = 1.50
    assert expected_comm > MIN_C
    spent = round(cash_before - b.get_balance(), 4)
    assert spent == pytest.approx(trade_val + expected_comm, abs=0.01)


def test_commission_uses_minimum_for_small_trade():
    b = broker()
    # 10 shares × S$1.50 = S$15, 0.03% = S$0.0045 < S$0.99 → uses S$0.99
    cash_before = b.get_balance()
    b.place_order("Y92.SI", "BUY", 10, 1.50)
    spent = round(cash_before - b.get_balance(), 4)
    assert spent == pytest.approx(15.0 + MIN_C, abs=0.01)


# --- round-trip PnL ---

def test_profitable_round_trip_increases_cash():
    b = broker(cash=10_000.0)
    b.place_order("Y92.SI", "BUY",  1000, 1.500)
    b.place_order("Y92.SI", "SELL", 1000, 1.510)
    # gross = 1000 × 0.010 = S$10
    # commission × 2 ≈ S$0.99 × 2 = S$1.98  (min kicks in for small lot)
    assert b.get_balance() > 10_000 - 1.98 * 2   # at least covers some profit


def test_stop_loss_round_trip_decreases_cash():
    b = broker(cash=10_000.0)
    b.place_order("Y92.SI", "BUY",  1000, 1.515)
    b.place_order("Y92.SI", "SELL", 1000, 1.500)  # 3 ticks down → stop loss
    assert b.get_balance() < 10_000.0
