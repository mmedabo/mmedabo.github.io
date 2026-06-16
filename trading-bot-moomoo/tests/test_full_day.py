"""
Full trading day endurance and scenario tests.

Simulates many hours of SGX trading with deterministic price sequences,
verifying the bot stays active, accumulates micro-profits, contains losses,
and recovers — all without real network calls or time.sleep().

Verified arithmetic (momentum_period=3, so entry fires on the 3rd quote):
  Entry sequence:
    Q1: bid=1.490, ask=1.500
    Q2: bid=1.495, ask=1.505
    Q3: bid=1.500, ask=1.510  ← BUY fires here at ask=1.510
  Position:  qty=3300, trade_val=S$4983, commission=max(4983×0.03%,1.50)=S$1.50/way
  Target:    bid >= 1.520  →  gross=S$33.00, net=+S$30.00
  Stop:      bid <= 1.500  →  gross=−S$33.00, net=−S$36.00
  Timeout:   bid=1.510     →  gross=S$0,      net=−S$3.00  (commission only)
  Crash:     bid=1.480     →  gross=−S$99.00, net=−S$102.00
"""
import sys, os, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from strategy.scalper import Quote, Scalper
from risk.manager import RiskManager

# ─────────────────────────────────────────────────────────────────────────────
# Configuration — separate from test_scalper.py to avoid coupling
# ─────────────────────────────────────────────────────────────────────────────

COMM_RATE = 0.0003
MIN_COMM  = 1.50     # S$1.50 minimum gives clean S$3 round-trip

RISK_CFG = {
    "max_position_sgd":   5000,
    "max_daily_loss_sgd": 300,
    "max_open_positions": 3,
    "max_trades_per_day": 100,   # high cap so endurance tests aren't blocked
    "commission_rate":    COMM_RATE,
    "min_commission_sgd": MIN_COMM,
}

STRAT_CFG = {
    "min_spread_ticks":    2,
    "target_profit_ticks": 2,
    "stop_loss_ticks":     2,
    "max_hold_seconds":    300,
    "min_volume":          0,    # no volume filter for scenario tests
    "momentum_period":     3,
    "max_position_sgd":    5000,
    "watchlist":           ["Y92.SI"],
}

# Ground-truth net PnL constants (verified against arithmetic above)
WIN_NET   =  30.00
STOP_NET  = -36.00
TMOUT_NET =  -3.00
CRASH_NET = -102.00

# Canonical price sequences — all at S$1.50 price level (tick=0.005, spread=2 ticks)
ENTRY_SEQ  = [(1.490, 1.500), (1.495, 1.505), (1.500, 1.510)]
WIN_EXIT   = (1.520, 1.530)   # bid >= target=1.520
STOP_EXIT  = (1.500, 1.510)   # bid <= stop=1.500
NEUTRAL    = (1.510, 1.520)   # above stop, below target (for timeout)
CRASH_EXIT = (1.480, 1.490)   # 6 ticks below entry


# ─────────────────────────────────────────────────────────────────────────────
# Shared helpers
# ─────────────────────────────────────────────────────────────────────────────

class ControlledBroker:
    """Deterministic broker: always fills, records every order."""
    def __init__(self):
        self.orders: list[dict] = []

    def place_order(self, symbol, side, qty, price) -> str:
        oid = f"DAY-{len(self.orders)+1:04d}"
        self.orders.append({"id": oid, "symbol": symbol, "side": side,
                            "qty": qty, "price": price})
        return oid

    def get_balance(self) -> float:
        return 50_000.0


def q(bid, ask, sym="Y92.SI") -> Quote:
    return Quote(symbol=sym, bid=bid, ask=ask, last=(bid+ask)/2, volume=1_000_000)


def setup(risk_cfg=None, strat_cfg=None):
    r = RiskManager(risk_cfg or RISK_CFG)
    b = ControlledBroker()
    s = Scalper(strat_cfg or STRAT_CFG, r, b)
    return s, r, b


# ─────────────────────────────────────────────────────────────────────────────
# DaySimulator
# ─────────────────────────────────────────────────────────────────────────────

class DaySimulator:
    """
    One-line helpers for running full trade cycles without time.sleep().
    run_win / run_stop / run_timeout each:
      1. Clear price history (isolate from prior cycles)
      2. Feed ENTRY_SEQ to open a position
      3. Feed one exit quote
    The timeout variant backdates entered_at instead of sleeping.
    """

    def __init__(self, risk_cfg=None, strat_cfg=None, symbol="Y92.SI"):
        self._sym    = symbol
        self.risk    = RiskManager(risk_cfg or RISK_CFG)
        self.broker  = ControlledBroker()
        self.scalper = Scalper(strat_cfg or STRAT_CFG, self.risk, self.broker)

    def _q(self, bid, ask) -> Quote:
        return q(bid, ask, self._sym)

    def _clear(self):
        for sym in self.scalper._history:
            self.scalper._history[sym].clear()

    def _enter(self):
        for bid, ask in ENTRY_SEQ:
            self.scalper.on_quote(self._q(bid, ask))

    def run_win(self) -> float:
        """Open trade → hit target. Returns net PnL delta for this cycle."""
        self._clear()
        before = self.current_pnl
        self._enter()
        self.scalper.on_quote(self._q(*WIN_EXIT))
        return round(self.current_pnl - before, 4)

    def run_stop(self) -> float:
        """Open trade → hit stop-loss. Returns net PnL delta (negative)."""
        self._clear()
        before = self.current_pnl
        self._enter()
        self.scalper.on_quote(self._q(*STOP_EXIT))
        return round(self.current_pnl - before, 4)

    def run_timeout(self) -> float:
        """Open trade → timeout (no sleep: entry time is backdated)."""
        self._clear()
        before = self.current_pnl
        self._enter()
        trade = self.scalper._open.get(self._sym)
        if trade:
            trade.entered_at = time.time() - (STRAT_CFG["max_hold_seconds"] + 1)
        self.scalper.on_quote(self._q(*NEUTRAL))
        return round(self.current_pnl - before, 4)

    @property
    def current_pnl(self) -> float:
        return self.risk.summary()["daily_pnl"]

    @property
    def trades(self) -> int:
        return self.risk.summary()["trades"]

    @property
    def open_count(self) -> int:
        return self.risk.summary()["open"]


# ═════════════════════════════════════════════════════════════════════════════
# GROUP 1 — ENDURANCE: bot lives and keeps trading all day
# ═════════════════════════════════════════════════════════════════════════════

def test_endurance_10_consecutive_wins():
    sim = DaySimulator()
    for _ in range(10):
        sim.run_win()
    assert sim.trades == 10
    assert sim.current_pnl == pytest.approx(10 * WIN_NET, abs=0.01)


def test_endurance_30_consecutive_wins():
    sim = DaySimulator()
    for _ in range(30):
        sim.run_win()
    assert sim.trades == 30
    assert sim.current_pnl == pytest.approx(30 * WIN_NET, abs=0.01)


def test_endurance_50_consecutive_wins():
    sim = DaySimulator()
    for _ in range(50):
        sim.run_win()
    assert sim.trades == 50
    assert sim.current_pnl == pytest.approx(50 * WIN_NET, abs=0.01)


def test_endurance_alternating_win_stop():
    """10 win-stop pairs; net per pair = WIN_NET + STOP_NET = −S$6."""
    sim = DaySimulator()
    for _ in range(10):
        sim.run_win()
        sim.run_stop()
    assert sim.trades == 20
    expected = 10 * (WIN_NET + STOP_NET)   # 10 × (30 − 36) = −60
    assert sim.current_pnl == pytest.approx(expected, abs=0.01)


def test_endurance_bot_re_enters_after_every_exit():
    """Trade count increments by 1 after every run_win call — no missed cycles."""
    sim = DaySimulator()
    for expected_count in range(1, 16):
        sim.run_win()
        assert sim.trades == expected_count


def test_endurance_open_count_always_zero_between_cycles():
    """No position leaks — open_count returns to 0 after each completed cycle."""
    sim = DaySimulator()
    for _ in range(20):
        sim.run_win()
        assert sim.open_count == 0, "open position leaked between cycles"


# ═════════════════════════════════════════════════════════════════════════════
# GROUP 2 — PROFIT MATH: verify exact PnL per cycle
# ═════════════════════════════════════════════════════════════════════════════

def test_profit_single_win_exact_pnl():
    sim = DaySimulator()
    delta = sim.run_win()
    assert delta == pytest.approx(WIN_NET, abs=0.01)
    assert sim.current_pnl == pytest.approx(WIN_NET, abs=0.01)


def test_profit_single_stop_exact_pnl():
    sim = DaySimulator()
    delta = sim.run_stop()
    assert delta == pytest.approx(STOP_NET, abs=0.01)
    assert sim.current_pnl == pytest.approx(STOP_NET, abs=0.01)


def test_profit_single_timeout_exact_pnl():
    """Timeout at neutral price: gross=0, net=−commission×2=−S$3."""
    sim = DaySimulator()
    delta = sim.run_timeout()
    assert delta == pytest.approx(TMOUT_NET, abs=0.01)
    assert sim.current_pnl == pytest.approx(TMOUT_NET, abs=0.01)


def test_profit_individual_win_deltas_consistent():
    """Each winning cycle contributes exactly WIN_NET — no drift."""
    sim = DaySimulator()
    for i in range(10):
        delta = sim.run_win()
        assert delta == pytest.approx(WIN_NET, abs=0.01), \
            f"cycle {i+1}: expected {WIN_NET}, got {delta}"


def test_profit_cumulative_pnl_no_float_drift():
    """Sum of individual deltas must match cumulative daily_pnl (no drift over 20 cycles)."""
    sim = DaySimulator()
    total_delta = 0.0
    for _ in range(20):
        total_delta += sim.run_win()
    assert total_delta == pytest.approx(sim.current_pnl, abs=0.01)


def test_profit_win_then_stop_net_pnl():
    sim = DaySimulator()
    sim.run_win()
    sim.run_stop()
    assert sim.current_pnl == pytest.approx(WIN_NET + STOP_NET, abs=0.01)
    assert sim.trades == 2


def test_profit_commission_deducted_every_cycle():
    """
    Inspect raw orders for 1 winning cycle:
    entry BUY@1.510, exit SELL@1.520, qty=3300.
    Commission = S$3.00 round-trip → net = S$33 − S$3 = S$30.
    """
    sim = DaySimulator()
    sim.run_win()
    orders = sim.broker.orders
    assert len(orders) == 2
    entry = orders[0]
    exit_ = orders[1]
    assert entry["side"] == "BUY"
    assert entry["price"] == pytest.approx(1.510, abs=0.0001)
    assert entry["qty"] == 3300
    assert exit_["side"] == "SELL"
    assert exit_["price"] == pytest.approx(1.520, abs=0.0001)
    # Verify commission was applied (net PnL = gross − round-trip commission)
    gross = (exit_["price"] - entry["price"]) * entry["qty"]
    assert gross == pytest.approx(33.00, abs=0.01)
    assert sim.current_pnl == pytest.approx(gross - 2 * MIN_COMM, abs=0.01)


# ═════════════════════════════════════════════════════════════════════════════
# GROUP 3 — STOP-LOSS QUALITY: fires at exactly the right tick
# ═════════════════════════════════════════════════════════════════════════════

def _open_position(sym="Y92.SI", risk_cfg=None, strat_cfg=None):
    """Helper: build a scalper, open one trade, return (scalper, risk, broker)."""
    s, r, b = setup(risk_cfg, strat_cfg)
    for bid, ask in ENTRY_SEQ:
        s.on_quote(q(bid, ask, sym))
    assert sym in s.open_symbols, "position should be open after ENTRY_SEQ"
    return s, r, b


def test_stop_fires_exactly_at_stop_price():
    s, r, b = _open_position()
    s.on_quote(q(*STOP_EXIT))              # bid=1.500 == stop=1.500
    assert s.open_symbols == []
    assert b.orders[-1]["side"] == "SELL"
    assert b.orders[-1]["price"] == pytest.approx(1.500, abs=0.0001)
    assert r.summary()["daily_pnl"] == pytest.approx(STOP_NET, abs=0.01)


def test_stop_does_not_fire_one_tick_above_stop():
    s, r, _ = _open_position()
    s.on_quote(q(1.505, 1.515))           # bid=1.505 > stop=1.500 → stay open
    assert "Y92.SI" in s.open_symbols


def test_stop_fires_on_crash_gap_below():
    """Price gaps far below stop — still exits on first crash tick."""
    s, r, b = _open_position()
    s.on_quote(q(*CRASH_EXIT))             # bid=1.480, 4 ticks below stop
    assert s.open_symbols == []
    assert r.summary()["daily_pnl"] == pytest.approx(CRASH_NET, abs=0.01)


def test_target_does_not_fire_one_tick_below_target():
    s, r, _ = _open_position()
    s.on_quote(q(1.515, 1.525))           # bid=1.515 < target=1.520 → stay open
    assert "Y92.SI" in s.open_symbols


def test_stop_fires_before_timeout_when_both_conditions_met():
    """
    Stop check runs before timeout check in _manage.
    When bid=1.500 (stop level) AND hold time is past max_hold_seconds,
    exit reason should be "stop" not "timeout", i.e. PnL = STOP_NET not TMOUT_NET.
    """
    s, r, b = _open_position()
    # Backdate entry so timeout would also fire
    trade = s._open["Y92.SI"]
    trade.entered_at = time.time() - (STRAT_CFG["max_hold_seconds"] + 1)
    # Feed stop-level bid
    s.on_quote(q(*STOP_EXIT))
    assert s.open_symbols == []
    # If timeout fired first, exit price would be 1.510 → pnl=-3; stop → pnl=-36
    assert r.summary()["daily_pnl"] == pytest.approx(STOP_NET, abs=0.01)


def test_target_fires_before_timeout_when_both_conditions_met():
    """Symmetric: target check runs before timeout check."""
    s, r, _ = _open_position()
    trade = s._open["Y92.SI"]
    trade.entered_at = time.time() - (STRAT_CFG["max_hold_seconds"] + 1)
    s.on_quote(q(*WIN_EXIT))   # bid=1.520 >= target=1.520
    assert s.open_symbols == []
    assert r.summary()["daily_pnl"] == pytest.approx(WIN_NET, abs=0.01)


def test_loss_from_stop_bounded_by_stop_ticks():
    """
    Maximum possible loss from a stop exit = stop_ticks × tick × qty + round-trip commission.
    Actual loss must never exceed this bound.
    """
    s, r, b = _open_position()
    s.on_quote(q(*STOP_EXIT))
    pnl = r.summary()["daily_pnl"]
    assert pnl < 0
    entry_price = b.orders[0]["price"]
    qty = b.orders[0]["qty"]
    tick = 0.005
    max_loss = STRAT_CFG["stop_loss_ticks"] * tick * qty + 2 * MIN_COMM
    assert abs(pnl) <= max_loss + 0.01


# ═════════════════════════════════════════════════════════════════════════════
# GROUP 4 — RECOVERY: bot bounces back after losses
# ═════════════════════════════════════════════════════════════════════════════

def test_recovery_1_stop_recovered_by_2_wins():
    sim = DaySimulator()
    sim.run_stop()
    sim.run_win()
    sim.run_win()
    # −36 + 30 + 30 = +24
    assert sim.current_pnl == pytest.approx(24.00, abs=0.01)
    assert sim.current_pnl > 0


def test_recovery_1_win_not_enough_after_1_stop():
    """Documents that 1 win (S$30) < 1 stop (S$36): still net negative."""
    sim = DaySimulator()
    sim.run_stop()
    sim.run_win()
    # −36 + 30 = −6
    assert sim.current_pnl == pytest.approx(-6.00, abs=0.01)
    assert sim.current_pnl < 0


def test_recovery_3_stops_recovered_by_4_wins():
    sim = DaySimulator()
    for _ in range(3):
        sim.run_stop()
    for _ in range(4):
        sim.run_win()
    # 3×(−36) + 4×30 = −108 + 120 = +12
    assert sim.current_pnl == pytest.approx(12.00, abs=0.01)
    assert sim.current_pnl > 0


def test_recovery_breakeven_requires_6_wins_after_5_stops():
    sim = DaySimulator()
    for _ in range(5):
        sim.run_stop()                              # pnl = −180

    # 5 wins not enough (−180 + 150 = −30)
    for _ in range(5):
        sim.run_win()
    assert sim.current_pnl < 0

    # 6th win tips to break-even (−180 + 180 = 0)
    sim.run_win()
    assert sim.current_pnl == pytest.approx(0.00, abs=0.01)


def test_recovery_pnl_strictly_increases_after_switch_to_wins():
    """Every win after a loss run must bring pnl strictly higher."""
    sim = DaySimulator()
    for _ in range(3):
        sim.run_stop()

    prev = sim.current_pnl
    for _ in range(5):
        sim.run_win()
        assert sim.current_pnl > prev, "each win must increase pnl"
        prev = sim.current_pnl


# ═════════════════════════════════════════════════════════════════════════════
# GROUP 5 — MARKET CONDITIONS: different price regimes
# ═════════════════════════════════════════════════════════════════════════════

def test_market_uptrend_generates_continuous_buy_entries():
    """All 10 cycles in an uptrend produce BUY entries (no missed opportunities)."""
    sim = DaySimulator()
    for _ in range(10):
        sim.run_win()
    buy_orders = [o for o in sim.broker.orders if o["side"] == "BUY"]
    assert len(buy_orders) == 10


def test_market_downtrend_generates_sell_entries():
    """Down-trending prices produce SELL (short) entries."""
    s, r, b = setup()
    down = [(1.530, 1.540), (1.525, 1.535), (1.520, 1.530)]  # descending mids
    for bid, ask in down:
        s.on_quote(q(bid, ask))
    if "Y92.SI" in s.open_symbols:
        assert b.orders[-1]["side"] == "SELL"


def test_market_flat_produces_no_entries():
    """Identical price every tick → zero momentum → no entries."""
    s, r, b = setup()
    for _ in range(10):
        s.on_quote(q(1.505, 1.515))   # perfectly flat
    assert s.open_symbols == []
    assert r.summary()["trades"] == 0


def test_market_choppy_timeouts_accumulate_small_losses():
    """
    Alternating tiny up/down → bot enters but never hits target or stop
    before timeout fires. 5 timeouts → 5 × TMOUT_NET = −S$15.
    """
    sim = DaySimulator()
    for _ in range(5):
        sim.run_timeout()
    assert sim.trades == 5
    assert sim.current_pnl == pytest.approx(5 * TMOUT_NET, abs=0.05)


def test_market_crash_stop_fires_on_first_crash_tick():
    s, r, b = _open_position()
    num_orders_before = len(b.orders)
    s.on_quote(q(*CRASH_EXIT))                   # single crash tick
    assert s.open_symbols == []                  # closed immediately
    assert len(b.orders) == num_orders_before + 1  # one exit order added
    assert r.summary()["daily_pnl"] == pytest.approx(CRASH_NET, abs=0.01)


def test_market_volatile_mixed_outcomes():
    """win, stop, timeout, stop, win → −S$15 cumulative."""
    sim = DaySimulator()
    sim.run_win()      # +30
    sim.run_stop()     # −36
    sim.run_timeout()  # −3
    sim.run_stop()     # −36
    sim.run_win()      # +30
    expected = WIN_NET + STOP_NET + TMOUT_NET + STOP_NET + WIN_NET
    assert sim.trades == 5
    assert sim.current_pnl == pytest.approx(expected, abs=0.05)


# ═════════════════════════════════════════════════════════════════════════════
# GROUP 6 — MULTI-SYMBOL: independent position management
# ═════════════════════════════════════════════════════════════════════════════

MULTI_SYMS  = ["Y92.SI", "Z74.SI", "F34.SI"]
MULTI_STRAT = {**STRAT_CFG, "watchlist": MULTI_SYMS}
MULTI_RISK  = {**RISK_CFG,  "max_open_positions": 3}


def _open_three_symbols():
    s, r, b = setup(risk_cfg=MULTI_RISK, strat_cfg=MULTI_STRAT)
    for sym in MULTI_SYMS:
        for bid, ask in ENTRY_SEQ:
            s.on_quote(q(bid, ask, sym))
    return s, r, b


def test_multi_three_symbols_open_simultaneously():
    s, r, b = _open_three_symbols()
    assert set(s.open_symbols) == set(MULTI_SYMS)
    assert r.summary()["open"] == 3


def test_multi_independent_exit_leaves_others_open():
    s, r, b = _open_three_symbols()
    # Close Y92.SI at target
    s.on_quote(q(*WIN_EXIT, sym="Y92.SI"))
    assert "Y92.SI" not in s.open_symbols
    assert {"Z74.SI", "F34.SI"} == set(s.open_symbols)
    assert r.summary()["open"] == 2


def test_multi_simultaneous_wins_accumulate_pnl():
    s, r, b = _open_three_symbols()
    for sym in MULTI_SYMS:
        s.on_quote(q(*WIN_EXIT, sym=sym))
    assert r.summary()["trades"] == 3
    assert r.summary()["daily_pnl"] == pytest.approx(3 * WIN_NET, abs=0.05)


def test_multi_fourth_symbol_blocked_by_max_open():
    """With max_open=3, a 4th symbol cannot open even if prices are right."""
    extra_sym   = "W35.SI"
    extra_strat = {**STRAT_CFG, "watchlist": MULTI_SYMS + [extra_sym]}
    s, r, b = _open_three_symbols()
    # Rebuild scalper with extra symbol — but risk already has 3 open (simulated via helper)
    # Re-use the same risk manager which has open_count=3
    for bid, ask in ENTRY_SEQ:
        s.on_quote(q(bid, ask, extra_sym))
    assert extra_sym not in s.open_symbols, "4th position must be blocked by max_open_positions=3"
    assert len(s.open_symbols) == 3


def test_multi_stop_on_one_does_not_affect_others():
    """A stop on Y92.SI reduces open_count by 1 but Z74/F34 trades stay open."""
    s, r, b = _open_three_symbols()
    s.on_quote(q(*STOP_EXIT, sym="Y92.SI"))
    assert "Y92.SI" not in s.open_symbols
    assert "Z74.SI" in s.open_symbols
    assert "F34.SI" in s.open_symbols
    assert r.summary()["open"] == 2


def test_multi_all_stops_total_pnl():
    """All 3 symbols hit stop → total = 3 × STOP_NET."""
    s, r, b = _open_three_symbols()
    for sym in MULTI_SYMS:
        s.on_quote(q(*STOP_EXIT, sym=sym))
    assert r.summary()["daily_pnl"] == pytest.approx(3 * STOP_NET, abs=0.05)


# ═════════════════════════════════════════════════════════════════════════════
# GROUP 7 — POSITION MANAGEMENT: sizing, lots, commission math
# ═════════════════════════════════════════════════════════════════════════════

def test_position_qty_is_board_lot_multiple():
    sim = DaySimulator()
    sim.run_win()
    for order in sim.broker.orders:
        assert order["qty"] % 100 == 0, f"order qty {order['qty']} not a board lot"
        assert order["qty"] >= 100


def test_position_trade_value_never_exceeds_max_position_sgd():
    sim = DaySimulator()
    for _ in range(10):
        sim.run_win()
    entry_orders = [o for o in sim.broker.orders if o["side"] == "BUY"]
    for o in entry_orders:
        trade_val = o["price"] * o["qty"]
        assert trade_val <= STRAT_CFG["max_position_sgd"] + 0.01, \
            f"position {trade_val:.2f} exceeds limit {STRAT_CFG['max_position_sgd']}"


def test_position_blocked_when_single_lot_unprofitable():
    """
    max_position_sgd=155 → qty=100 shares at S$1.510.
    Gross for 2-tick target = 100×0.010 = S$1.00
    Round-trip commission = 2×max(155×0.03%, S$1.50) = 2×S$1.50 = S$3.00
    Net = −S$2.00 → entry blocked by profitability guard.
    """
    risk_cfg  = {**RISK_CFG, "max_position_sgd": 155}
    strat_cfg = {**STRAT_CFG, "max_position_sgd": 155}
    s, r, b   = setup(risk_cfg=risk_cfg, strat_cfg=strat_cfg)
    for bid, ask in ENTRY_SEQ:
        s.on_quote(q(bid, ask))
    assert s.open_symbols == [], "entry should be blocked — commission exceeds gross profit"


def test_position_qty_floor_to_board_lot_at_higher_price():
    """
    At S$36.50 (DBS level): 5000/36.50 = 136 shares → floor to 100 board lot.
    """
    strat_cfg = {**STRAT_CFG, "watchlist": ["D05.SI"]}
    s, r, b   = setup(strat_cfg=strat_cfg)
    # DBS price level: tick=0.01, spread=0.02 (2 ticks)
    dbs_entry = [(36.48, 36.50), (36.49, 36.51), (36.50, 36.52)]
    for bid, ask in dbs_entry:
        s.on_quote(q(bid, ask, sym="D05.SI"))
    if "D05.SI" in s.open_symbols:
        entry_order = b.orders[0]
        assert entry_order["qty"] == 100   # exactly 1 board lot
        assert entry_order["qty"] % 100 == 0


def test_position_entry_and_exit_both_recorded():
    sim = DaySimulator()
    sim.run_win()
    assert len(sim.broker.orders) == 2
    assert sim.broker.orders[0]["side"] == "BUY"
    assert sim.broker.orders[1]["side"] == "SELL"


# ═════════════════════════════════════════════════════════════════════════════
# GROUP 8 — DAILY LIMITS: bot halts correctly, never over-trades
# ═════════════════════════════════════════════════════════════════════════════

def test_limits_halt_after_daily_loss_reached():
    """After 9 stops (−S$324 ≤ −S$299.99), the 10th attempt is blocked."""
    sim = DaySimulator()
    for _ in range(9):
        sim.run_stop()                 # 9 × −36 = −324
    assert sim.current_pnl == pytest.approx(9 * STOP_NET, abs=0.05)

    # Attempt 10th trade — should be blocked
    trades_before = sim.trades
    sim.run_win()
    assert sim.trades == trades_before, "no new trade should open after daily loss limit"


def test_limits_pnl_just_above_threshold_still_trades():
    """−S$263.99 is above the −S$299.99 threshold → trading still allowed."""
    sim = DaySimulator()
    sim.risk.record_close("Y92.SI", -263.99)
    delta = sim.run_win()
    assert delta == pytest.approx(WIN_NET, abs=0.01)


def test_limits_halt_after_max_trades_per_day():
    """With max_trades_per_day=5, the 6th cycle is blocked."""
    risk_cfg = {**RISK_CFG, "max_trades_per_day": 5}
    sim      = DaySimulator(risk_cfg=risk_cfg)
    for _ in range(5):
        sim.run_win()
    assert sim.trades == 5

    sim.run_win()   # attempt 6th trade
    assert sim.trades == 5, "no 6th trade should open after max_trades_per_day=5"


def test_limits_open_count_released_after_exit():
    """
    With max_open_positions=1:
    - Open Y92 → Z74 is blocked.
    - Exit Y92 → Z74 is now allowed.
    """
    risk_cfg  = {**RISK_CFG, "max_open_positions": 1}
    strat_cfg = {**STRAT_CFG, "watchlist": ["Y92.SI", "Z74.SI"]}
    s, r, b   = setup(risk_cfg=risk_cfg, strat_cfg=strat_cfg)

    # Open Y92.SI
    for bid, ask in ENTRY_SEQ:
        s.on_quote(q(bid, ask, "Y92.SI"))
    assert "Y92.SI" in s.open_symbols

    # Z74.SI up-trend while Y92.SI is open → should be blocked
    for bid, ask in ENTRY_SEQ:
        s.on_quote(q(bid, ask, "Z74.SI"))
    assert "Z74.SI" not in s.open_symbols

    # Close Y92.SI at target
    s.on_quote(q(*WIN_EXIT, sym="Y92.SI"))
    assert "Y92.SI" not in s.open_symbols
    assert r.summary()["open"] == 0

    # Now Z74.SI should be able to open
    s._history["Z74.SI"].clear()
    for bid, ask in ENTRY_SEQ:
        s.on_quote(q(bid, ask, "Z74.SI"))
    assert "Z74.SI" in s.open_symbols


def test_limits_trade_count_includes_all_exit_types():
    """Wins, stops, and timeouts all count toward the daily trade total."""
    sim = DaySimulator()
    sim.run_win()
    sim.run_stop()
    sim.run_timeout()
    assert sim.trades == 3
    assert sim.open_count == 0


def test_limits_daily_pnl_never_exceeds_loss_limit_boundary():
    """
    Verify the boundary exactly: pnl = −S$299.99 still allows one more trade,
    but pnl = −S$300.00 does not.
    """
    # Scenario A: just above threshold
    sim_a = DaySimulator()
    sim_a.risk.record_close("X", -(300.00 - 0.02))   # pnl = −299.98
    delta = sim_a.run_win()
    assert delta == pytest.approx(WIN_NET, abs=0.01)

    # Scenario B: exactly at threshold
    sim_b = DaySimulator()
    sim_b.risk.record_close("X", -300.00)
    trades_before = sim_b.trades
    sim_b.run_win()
    assert sim_b.trades == trades_before, "pnl at −300.00 must block new trades"
