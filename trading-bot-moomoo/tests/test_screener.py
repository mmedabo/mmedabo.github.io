"""Tests for market/screener.py — low-value SGX stock selection."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from market.screener import screen, _spread_pct


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_broker(quotes: dict):
    """Stub broker returning pre-canned quotes."""
    class _Broker:
        def get_quote(self, sym):
            return quotes.get(sym)
    return _Broker()


def q(bid, ask, vol=2_000_000, sym="X.SI"):
    """Build a quote dict."""
    return {"symbol": sym, "bid": bid, "ask": ask, "last": (bid + ask) / 2, "volume": vol}


BASE_CFG = {
    "max_price_sgd":    3.00,
    "min_volume":       1_000_000,
    "max_position_sgd": 1_000,
}


# ---------------------------------------------------------------------------
# _spread_pct
# ---------------------------------------------------------------------------

def test_spread_pct_symmetrical():
    sp = _spread_pct(0.995, 1.005)
    assert sp == pytest.approx(0.01, rel=1e-4)


def test_spread_pct_zero_mid_returns_large():
    assert _spread_pct(0.0, 0.0) == 999.0


# ---------------------------------------------------------------------------
# Price filter
# ---------------------------------------------------------------------------

def test_excludes_stocks_above_max_price():
    broker = make_broker({
        "HIGH.SI": q(3.49, 3.51, sym="HIGH.SI"),
        "LOW.SI":  q(0.55, 0.56, sym="LOW.SI"),
    })
    result = screen(broker, ["HIGH.SI", "LOW.SI"], BASE_CFG)
    assert "HIGH.SI" not in result
    assert "LOW.SI" in result


def test_includes_stock_exactly_at_max_price():
    # last = (2.99 + 3.01) / 2 = 3.00 — should pass
    broker = make_broker({"AT.SI": q(2.99, 3.01, sym="AT.SI")})
    result = screen(broker, ["AT.SI"], BASE_CFG)
    assert "AT.SI" in result


def test_excludes_stock_one_cent_above_max():
    # last = (3.00 + 3.02) / 2 = 3.01 > 3.00
    broker = make_broker({"OVER.SI": q(3.00, 3.02, sym="OVER.SI")})
    result = screen(broker, ["OVER.SI"], BASE_CFG)
    assert "OVER.SI" not in result


# ---------------------------------------------------------------------------
# Volume filter
# ---------------------------------------------------------------------------

def test_excludes_low_volume():
    broker = make_broker({
        "ILLIQ.SI": q(0.50, 0.51, vol=500_000, sym="ILLIQ.SI"),
        "LIQ.SI":   q(0.50, 0.51, vol=1_500_000, sym="LIQ.SI"),
    })
    result = screen(broker, ["ILLIQ.SI", "LIQ.SI"], BASE_CFG)
    assert "ILLIQ.SI" not in result
    assert "LIQ.SI" in result


def test_includes_stock_exactly_at_min_volume():
    broker = make_broker({"EX.SI": q(0.50, 0.51, vol=1_000_000, sym="EX.SI")})
    result = screen(broker, ["EX.SI"], BASE_CFG)
    assert "EX.SI" in result


# ---------------------------------------------------------------------------
# Capital / board-lot filter (ask × 100 ≤ capital)
# ---------------------------------------------------------------------------

def test_excludes_when_one_lot_exceeds_capital():
    # ask=10.10, 10.10 × 100 = S$1010 > S$1000
    broker = make_broker({"BIG.SI": q(10.09, 10.10, sym="BIG.SI")})
    result = screen(broker, ["BIG.SI"], BASE_CFG)
    assert "BIG.SI" not in result


def test_includes_when_one_lot_fits_capital():
    # ask=0.99, 0.99 × 100 = S$99 < S$1000
    broker = make_broker({"OK.SI": q(0.98, 0.99, sym="OK.SI")})
    result = screen(broker, ["OK.SI"], BASE_CFG)
    assert "OK.SI" in result


def test_border_lot_exactly_at_capital():
    # ask=10.00, 10.00 × 100 = S$1000 — should pass (≤ capital)
    broker = make_broker({"BORDER.SI": q(9.99, 10.00, sym="BORDER.SI")})
    cfg = dict(BASE_CFG, max_price_sgd=15.0)
    result = screen(broker, ["BORDER.SI"], cfg)
    assert "BORDER.SI" in result


# ---------------------------------------------------------------------------
# Missing / None quote
# ---------------------------------------------------------------------------

def test_skips_symbols_with_no_quote():
    broker = make_broker({"KNOWN.SI": q(0.50, 0.51, sym="KNOWN.SI")})
    result = screen(broker, ["MISSING.SI", "KNOWN.SI"], BASE_CFG)
    assert "MISSING.SI" not in result
    assert "KNOWN.SI" in result


def test_returns_empty_when_none_pass():
    broker = make_broker({
        "A.SI": q(5.00, 5.01, sym="A.SI"),   # too expensive
        "B.SI": q(0.50, 0.51, vol=100, sym="B.SI"),  # too illiquid
    })
    result = screen(broker, ["A.SI", "B.SI"], BASE_CFG)
    assert result == []


# ---------------------------------------------------------------------------
# Ranking: highest (volume / spread_pct) first
# ---------------------------------------------------------------------------

def test_ranks_high_volume_first():
    broker = make_broker({
        "VOL_HIGH.SI": q(0.995, 1.005, vol=5_000_000, sym="VOL_HIGH.SI"),
        "VOL_LOW.SI":  q(0.995, 1.005, vol=1_500_000, sym="VOL_LOW.SI"),
    })
    result = screen(broker, ["VOL_LOW.SI", "VOL_HIGH.SI"], BASE_CFG)
    assert result[0] == "VOL_HIGH.SI"


def test_ranks_tight_spread_first():
    broker = make_broker({
        "TIGHT.SI": q(0.999, 1.001, vol=2_000_000, sym="TIGHT.SI"),   # 0.2% spread
        "WIDE.SI":  q(0.980, 1.020, vol=2_000_000, sym="WIDE.SI"),    # 4.0% spread
    })
    result = screen(broker, ["WIDE.SI", "TIGHT.SI"], BASE_CFG)
    assert result[0] == "TIGHT.SI"


def test_all_failing_symbols_gives_empty_list():
    broker = make_broker({})
    result = screen(broker, ["A.SI", "B.SI", "C.SI"], BASE_CFG)
    assert result == []


# ---------------------------------------------------------------------------
# Integration: realistic S$1,000 scenario
# ---------------------------------------------------------------------------

def test_sgd1000_scenario_realistic_stocks():
    """All these low-value stocks should pass the S$1,000 screener filters."""
    quotes = {
        "Y92.SI":  q(0.56,  0.57,  vol=3_000_000, sym="Y92.SI"),
        "E5H.SI":  q(0.225, 0.230, vol=4_000_000, sym="E5H.SI"),
        "G13.SI":  q(0.915, 0.920, vol=2_500_000, sym="G13.SI"),
        "C52.SI":  q(1.545, 1.550, vol=1_200_000, sym="C52.SI"),
        "T82U.SI": q(1.345, 1.350, vol=1_500_000, sym="T82U.SI"),
    }
    broker = make_broker(quotes)
    watchlist = list(quotes.keys())
    result = screen(broker, watchlist, BASE_CFG)
    assert set(result) == set(watchlist), f"expected all to pass, got {result}"


def test_sgd1000_scenario_expensive_stocks_excluded():
    """Blue-chip stocks at S$14–36 must be screened out."""
    quotes = {
        "D05.SI": q(36.48, 36.50, vol=5_000_000, sym="D05.SI"),
        "O39.SI": q(14.78, 14.80, vol=3_000_000, sym="O39.SI"),
        "Y92.SI": q(0.56,  0.57,  vol=3_000_000, sym="Y92.SI"),
    }
    broker = make_broker(quotes)
    result = screen(broker, list(quotes.keys()), BASE_CFG)
    assert "D05.SI" not in result
    assert "O39.SI" not in result
    assert "Y92.SI" in result


def test_screener_uses_custom_max_price():
    quotes = {
        "MID.SI":  q(4.99, 5.00, vol=2_000_000, sym="MID.SI"),
        "HIGH.SI": q(9.99, 10.00, vol=2_000_000, sym="HIGH.SI"),
    }
    broker = make_broker(quotes)
    cfg = dict(BASE_CFG, max_price_sgd=5.00, max_position_sgd=10_000)
    result = screen(broker, list(quotes.keys()), cfg)
    assert "MID.SI" in result
    assert "HIGH.SI" not in result


def test_screener_custom_min_volume():
    broker = make_broker({
        "LOW.SI": q(0.50, 0.51, vol=300_000, sym="LOW.SI"),
    })
    cfg = dict(BASE_CFG, min_volume=200_000)
    result = screen(broker, ["LOW.SI"], cfg)
    assert "LOW.SI" in result


# ---------------------------------------------------------------------------
# Commission breakeven check (informational — screener does not check this,
# that's scalper's job, but we verify position sizing math is consistent)
# ---------------------------------------------------------------------------

def test_position_sizing_math_at_half_dollar():
    """S$0.57 stock at S$333/slot: floor(333/0.57/100)*100 = 500 shares = 5 lots."""
    entry = 0.57
    capital = 333   # per-position limit (S$1,000 / 3 concurrent positions)
    qty = int((capital / entry) // 100) * 100
    assert qty == 500
    tick = 0.005  # S$0.20–S$1.99 range
    gross_4tick = qty * 4 * tick
    commission = max(entry * qty * 0.0003, 0.99)
    net = gross_4tick - 2 * commission
    assert net > 0, f"S$0.57 stock not profitable after commission: net={net}"


def test_position_sizing_math_at_twenty_cents():
    """S$0.23 stock at S$333/slot: floor(333/0.23/100)*100 = 1400 shares = 14 lots."""
    entry = 0.23
    capital = 333   # per-position limit
    qty = int((capital / entry) // 100) * 100
    assert qty == 1400
    tick = 0.005
    gross_4tick = qty * 4 * tick
    commission = max(entry * qty * 0.0003, 0.99)
    net = gross_4tick - 2 * commission
    assert net > 0


def test_position_sizing_math_at_two_eighty():
    """S$2.80 stock at S$333/slot: floor(333/2.80/100)*100 = 100 shares = 1 lot."""
    entry = 2.80
    capital = 333   # per-position limit
    qty = int((capital / entry) // 100) * 100
    assert qty == 100
    tick = 0.01  # ≥ S$2.00
    gross_4tick = qty * 4 * tick
    commission = max(entry * qty * 0.0003, 0.99)
    net = gross_4tick - 2 * commission
    assert net > 0
