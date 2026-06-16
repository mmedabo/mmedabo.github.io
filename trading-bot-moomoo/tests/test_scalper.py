"""
Comprehensive scalper strategy tests.

Uses a ControlledBroker that accepts injected quote sequences so every
test is fully deterministic — no random prices, no real network.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import time
import pytest

from strategy.scalper import Quote, Scalper, tick_size
from risk.manager import RiskManager

# ----------------------------------------------------------------------- #
# helpers
# ----------------------------------------------------------------------- #

COMM_RATE = 0.0003
MIN_COMM  = 0.99

BASE_RISK_CFG = {
    "max_position_sgd":   5000,
    "max_daily_loss_sgd": 300,
    "max_open_positions": 3,
    "max_trades_per_day": 50,
    "commission_rate":    COMM_RATE,
    "min_commission_sgd": MIN_COMM,
}

BASE_STRAT_CFG = {
    "min_spread_ticks":    2,
    "target_profit_ticks": 1,
    "stop_loss_ticks":     3,
    "max_hold_seconds":    5,
    "min_volume":          100_000,
    "momentum_period":     3,
    "max_position_sgd":    5000,
    "watchlist":           ["Y92.SI"],
}


class ControlledBroker:
    """Deterministic broker: records every order, never fails unless told to."""

    def __init__(self, should_fail: bool = False):
        self.orders: list[dict] = []
        self.should_fail = should_fail

    def place_order(self, symbol, side, qty, price) -> str | None:
        if self.should_fail:
            return None
        oid = f"TEST-{len(self.orders)+1:04d}"
        self.orders.append({"id": oid, "symbol": symbol, "side": side, "qty": qty, "price": price})
        return oid

    def get_balance(self) -> float:
        return 50_000.0


def make_scalper(risk_cfg=None, strat_cfg=None, broker=None):
    r = RiskManager(risk_cfg or BASE_RISK_CFG)
    b = broker or ControlledBroker()
    s = Scalper(cfg=strat_cfg or BASE_STRAT_CFG, risk=r, broker=b)
    return s, r, b


# S$1.50 stock: tick = 0.005, spread = 0.010 = 2 ticks ✓
def q(bid, ask, vol=1_000_000, sym="Y92.SI"):
    return Quote(symbol=sym, bid=bid, ask=ask, last=(bid+ask)/2, volume=vol)


# ----------------------------------------------------------------------- #
# 1. ENTRY — should enter
# ----------------------------------------------------------------------- #

def test_entry_on_up_momentum():
    """Bot buys when prices trend upward with adequate spread."""
    s, r, b = make_scalper()
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        s.on_quote(q(bid, ask))
    assert "Y92.SI" in s.open_symbols
    assert b.orders[-1]["side"] == "BUY"


def test_entry_on_down_momentum():
    """Bot sells/shorts when prices trend downward."""
    s, r, b = make_scalper()
    for bid, ask in [(1.515, 1.525), (1.510, 1.520), (1.505, 1.515), (1.500, 1.510)]:
        s.on_quote(q(bid, ask))
    assert "Y92.SI" in s.open_symbols
    assert b.orders[-1]["side"] == "SELL"


# ----------------------------------------------------------------------- #
# 2. ENTRY — should NOT enter
# ----------------------------------------------------------------------- #

def test_no_entry_without_enough_history():
    """Need momentum_period quotes before entering."""
    s, _, _ = make_scalper()
    s.on_quote(q(1.500, 1.510))   # only 1 tick
    assert s.open_symbols == []


def test_no_entry_tight_spread():
    """Spread < 2 ticks → skip."""
    s, _, _ = make_scalper()
    # spread = 0.004 = 0.8 ticks at S$1.50 (tick=0.005)
    for bid, ask in [(1.490, 1.494), (1.495, 1.499), (1.500, 1.504), (1.505, 1.509)]:
        s.on_quote(q(bid, ask))
    assert s.open_symbols == []


def test_no_entry_low_volume():
    """Volume below threshold → skip."""
    cfg = {**BASE_STRAT_CFG, "min_volume": 1_000_000}
    s, _, _ = make_scalper(strat_cfg=cfg)
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        s.on_quote(q(bid, ask, vol=50_000))   # too low
    assert s.open_symbols == []


def test_no_entry_price_too_high_for_lot():
    """S$200 stock → 5000 / 200 = 25 shares → 0 board lots → skip."""
    s, _, _ = make_scalper()
    # use spread 0.40 (2 ticks at S$200 level) and up-trend
    for bid, ask in [(199.80, 200.20), (199.90, 200.30), (200.00, 200.40), (200.10, 200.50)]:
        s.on_quote(q(bid, ask, sym="Y92.SI"))
    assert s.open_symbols == []


def test_no_entry_not_profitable_after_commission():
    """Trade with 1-tick target on tiny position → commission > gross → skip."""
    # 100 shares @ S$1.50 = S$150, 1 tick profit = S$0.50, min commission 2×S$0.99 = S$1.98 → net = -S$1.48
    cfg = {
        **BASE_STRAT_CFG,
        "max_position_sgd": 150,  # only one board lot
        "target_profit_ticks": 1,
    }
    risk_cfg = {**BASE_RISK_CFG, "min_commission_sgd": 10.0}  # high minimum
    s, _, _ = make_scalper(risk_cfg=risk_cfg, strat_cfg=cfg)
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        s.on_quote(q(bid, ask))
    assert s.open_symbols == []


def test_no_entry_order_fails():
    """If broker rejects the order, position is not tracked."""
    s, _, b = make_scalper(broker=ControlledBroker(should_fail=True))
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        s.on_quote(q(bid, ask))
    assert s.open_symbols == []


# ----------------------------------------------------------------------- #
# 3. EXIT — target hit
# ----------------------------------------------------------------------- #

def test_exit_at_target_buy():
    """BUY trade closes profitably when bid reaches target."""
    s, r, b = make_scalper()
    # build up-momentum → enter BUY at ask=1.515, target = 1.515 + 0.005 = 1.520
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        s.on_quote(q(bid, ask))
    assert "Y92.SI" in s.open_symbols

    entry_order = b.orders[-1]
    assert entry_order["side"] == "BUY"
    entry_price = entry_order["price"]  # 1.515
    target = round(entry_price + 0.005, 4)   # 1.520

    # tick where bid >= target → should exit
    s.on_quote(q(target, round(target + 0.010, 4)))

    assert s.open_symbols == [], "trade should be closed at target"
    assert b.orders[-1]["side"] == "SELL"
    assert b.orders[-1]["price"] >= target


def test_exit_at_target_sell():
    """SELL (short) trade closes profitably when ask reaches target."""
    s, r, b = make_scalper()
    # down-momentum → enter SELL at bid=1.500, target = 1.500 - 0.005 = 1.495
    for bid, ask in [(1.515, 1.525), (1.510, 1.520), (1.505, 1.515), (1.500, 1.510)]:
        s.on_quote(q(bid, ask))
    assert "Y92.SI" in s.open_symbols

    entry_order = b.orders[-1]
    assert entry_order["side"] == "SELL"
    entry_price = entry_order["price"]  # 1.500
    target = round(entry_price - 0.005, 4)  # 1.495

    # tick where ask <= target → should exit
    s.on_quote(q(round(target - 0.010, 4), target))

    assert s.open_symbols == [], "short should close at target"
    assert b.orders[-1]["side"] == "BUY"   # cover the short


def test_target_hit_pnl_is_positive():
    """Net PnL (after commission) is positive when target is reached."""
    s, r, b = make_scalper()
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        s.on_quote(q(bid, ask))

    entry_price = b.orders[-1]["price"]
    target = round(entry_price + 0.005, 4)
    s.on_quote(q(target, round(target + 0.010, 4)))

    assert r.summary()["daily_pnl"] > 0, "should be net-profitable after commission"


# ----------------------------------------------------------------------- #
# 4. EXIT — stop-loss (fires ASAP)
# ----------------------------------------------------------------------- #

def test_stop_loss_buy_fires_immediately():
    """Stop fires on the very first tick that crosses the stop level."""
    s, r, b = make_scalper()
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        s.on_quote(q(bid, ask))
    assert "Y92.SI" in s.open_symbols

    entry_price = b.orders[-1]["price"]         # e.g. 1.515
    stop = round(entry_price - 3 * 0.005, 4)   # 1.500

    # Feed one tick EXACTLY at stop level
    s.on_quote(q(stop, round(stop + 0.010, 4)))

    assert s.open_symbols == [], "stop-loss must fire on the very first tick at/below stop"
    assert b.orders[-1]["side"] == "SELL"
    assert r.summary()["daily_pnl"] < 0, "stop-loss should produce a negative PnL"


def test_stop_loss_buy_limits_loss():
    """Loss from stop-loss is bounded at stop_ticks × position — not unlimited."""
    s, r, b = make_scalper()
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        s.on_quote(q(bid, ask))

    entry_price = b.orders[-1]["price"]
    stop = round(entry_price - 3 * 0.005, 4)
    qty  = b.orders[-1]["qty"]

    s.on_quote(q(stop, round(stop + 0.010, 4)))

    gross_loss = (entry_price - stop) * qty          # 3 ticks × qty
    # net loss = gross_loss + round-trip commission
    pnl = r.summary()["daily_pnl"]
    assert pnl < 0
    assert abs(pnl) <= gross_loss + 2 * max(entry_price * qty * COMM_RATE, MIN_COMM) + 0.01


def test_stop_loss_sell_fires_immediately():
    """Short stop fires on the first tick at or above stop price."""
    s, r, b = make_scalper()
    for bid, ask in [(1.515, 1.525), (1.510, 1.520), (1.505, 1.515), (1.500, 1.510)]:
        s.on_quote(q(bid, ask))
    assert "Y92.SI" in s.open_symbols

    entry_price = b.orders[-1]["price"]          # bid = 1.500
    stop = round(entry_price + 3 * 0.005, 4)    # 1.515

    s.on_quote(q(round(stop - 0.010, 4), stop))

    assert s.open_symbols == [], "short stop must fire on first tick at/above stop"
    assert b.orders[-1]["side"] == "BUY"
    assert r.summary()["daily_pnl"] < 0


def test_no_premature_stop_before_level():
    """Position stays open when price is between entry and stop."""
    s, r, b = make_scalper()
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        s.on_quote(q(bid, ask))
    assert "Y92.SI" in s.open_symbols

    entry_price = b.orders[-1]["price"]
    mid_price = round(entry_price - 0.005, 4)   # 1 tick below entry, still above stop

    s.on_quote(q(mid_price, round(mid_price + 0.010, 4)))

    assert "Y92.SI" in s.open_symbols, "should stay open — stop not reached"


# ----------------------------------------------------------------------- #
# 5. EXIT — timeout
# ----------------------------------------------------------------------- #

def test_exit_on_timeout():
    """Trade force-closes after max_hold_seconds regardless of price."""
    s, r, b = make_scalper()
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        s.on_quote(q(bid, ask))

    if not s.open_symbols:
        pytest.skip("no trade opened")

    time.sleep(6)  # max_hold_seconds = 5 in BASE_STRAT_CFG
    s.on_quote(q(1.505, 1.515))   # mid-range tick triggers timeout check

    assert s.open_symbols == [], "trade must close on timeout"


def test_timeout_recorded_in_risk():
    """After timeout exit the risk manager shows one completed trade."""
    s, r, b = make_scalper()
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        s.on_quote(q(bid, ask))

    if not s.open_symbols:
        pytest.skip("no trade opened")

    time.sleep(6)
    s.on_quote(q(1.505, 1.515))

    stats = r.summary()
    assert stats["trades"] >= 1
    assert stats["open"] == 0


# ----------------------------------------------------------------------- #
# 6. RISK LIMITS
# ----------------------------------------------------------------------- #

def test_daily_loss_halts_new_entries():
    """After daily loss limit is hit no new positions open."""
    s, r, b = make_scalper()
    r.record_close("Y92.SI", -301.0)   # exceed S$300 limit
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        s.on_quote(q(bid, ask))
    assert s.open_symbols == []


def test_max_open_positions_halts_entry():
    """When max open positions is 0, no new entries allowed."""
    risk_cfg = {**BASE_RISK_CFG, "max_open_positions": 0}
    s, r, b = make_scalper(risk_cfg=risk_cfg)
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        s.on_quote(q(bid, ask))
    assert s.open_symbols == []


def test_max_trades_per_day_halts_entry():
    """After hitting max trades for the day, no new entries."""
    risk_cfg = {**BASE_RISK_CFG, "max_trades_per_day": 0}
    s, r, b = make_scalper(risk_cfg=risk_cfg)
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        s.on_quote(q(bid, ask))
    assert s.open_symbols == []


# ----------------------------------------------------------------------- #
# 7. MULTIPLE CYCLES — profit accumulation
# ----------------------------------------------------------------------- #

def _run_winning_cycle(s, r, b):
    """Execute one full winning cycle: build momentum → entry → hit target → exit.

    Clears price history before each cycle so prior prices don't create a
    false down-momentum and prevent re-entry — mirrors a bot restarting
    or a natural pause between opportunities.
    """
    initial_trade_count = r.summary()["trades"]

    # reset history so prior target-level prices don't pollute the new window
    for sym in list(s._history.keys()):
        s._history[sym].clear()

    # build up-momentum: spread=0.010=2 ticks, clear uptrend
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        s.on_quote(q(bid, ask))

    if not s.open_symbols:
        return False  # no trade opened (risk limit or profitability check failed)

    entry_price = b.orders[-1]["price"]
    target = round(entry_price + 0.005, 4)

    # push bid up to target level → exit at profit
    s.on_quote(q(target, round(target + 0.010, 4)))

    return r.summary()["trades"] > initial_trade_count


def test_multiple_winning_cycles_accumulate_profit():
    """Three back-to-back winning cycles should show positive cumulative PnL."""
    s, r, b = make_scalper()
    completed = 0
    for _ in range(3):
        ok = _run_winning_cycle(s, r, b)
        if ok:
            completed += 1

    assert completed >= 2, f"expected ≥2 completed cycles, got {completed}"
    assert r.summary()["daily_pnl"] > 0, "cumulative net PnL must be positive"


def test_profit_per_cycle_exceeds_zero():
    """Each individual winning cycle produces positive net PnL."""
    s, r, b = make_scalper()
    pnls = []

    for _ in range(3):
        pnl_before = r.summary()["daily_pnl"]
        ok = _run_winning_cycle(s, r, b)
        if ok:
            pnl_after = r.summary()["daily_pnl"]
            pnls.append(round(pnl_after - pnl_before, 4))

    assert all(p > 0 for p in pnls), f"all winning trades must be net-positive, got: {pnls}"


def test_stop_loss_caps_total_loss():
    """After one stop-loss, daily PnL loss is small and bounded."""
    s, r, b = make_scalper()
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        s.on_quote(q(bid, ask))

    if not s.open_symbols:
        pytest.skip("no trade opened")

    entry_price = b.orders[-1]["price"]
    stop = round(entry_price - 3 * 0.005, 4)
    s.on_quote(q(stop, round(stop + 0.010, 4)))

    daily_loss = r.summary()["daily_pnl"]
    assert daily_loss < 0
    # max possible loss: 3 ticks × qty + round-trip commission
    qty = b.orders[0]["qty"]
    max_loss = 3 * 0.005 * qty + 2 * max(entry_price * qty * COMM_RATE, MIN_COMM)
    assert abs(daily_loss) <= max_loss + 0.01, \
        f"loss {abs(daily_loss):.4f} exceeds cap {max_loss:.4f}"


# ----------------------------------------------------------------------- #
# 8. MULTI-SYMBOL independence
# ----------------------------------------------------------------------- #

def test_two_symbols_trade_independently():
    """Positions in two symbols are tracked separately."""
    risk_cfg = {**BASE_RISK_CFG, "max_open_positions": 2}
    strat_cfg = {**BASE_STRAT_CFG, "watchlist": ["Y92.SI", "Z74.SI"]}
    s, r, b = make_scalper(risk_cfg=risk_cfg, strat_cfg=strat_cfg)

    # Y92: up-trend
    for bid, ask in [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510), (1.505, 1.515)]:
        s.on_quote(q(bid, ask, sym="Y92.SI"))

    # Z74 (S$2.35 stock, tick=0.01, spread=0.02): separate up-trend
    for bid, ask in [(2.330, 2.350), (2.340, 2.360), (2.350, 2.370), (2.360, 2.380)]:
        s.on_quote(q(bid, ask, sym="Z74.SI"))

    open_syms = s.open_symbols
    assert len(open_syms) == 2, f"expected 2 open positions, got {open_syms}"
    assert "Y92.SI" in open_syms
    assert "Z74.SI" in open_syms
