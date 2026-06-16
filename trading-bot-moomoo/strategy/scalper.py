"""
SGX Micro-Profit Scalping Strategy
====================================
Entry:  momentum over rolling window + spread ≥ N ticks + net PnL > 0 after commission
Exit:   first of — target ticks hit | stop-loss ticks hit | max hold time elapsed

Design notes:
- All price comparisons use rounded values (4 d.p.) to avoid float equality misses.
- PnL reported to risk manager is NET (after round-trip commission).
- Stop-loss fires on the very first tick where price crosses the stop level.
"""
from __future__ import annotations
import logging
import time as _time
from collections import deque
from dataclasses import dataclass, field

from market.session import is_warmup_period
from risk.manager import RiskManager

log = logging.getLogger("scalper")


def tick_size(price: float) -> float:
    """SGX minimum price movement for a given price level."""
    if price < 0.20:
        return 0.001
    if price < 2.00:
        return 0.005
    return 0.01


@dataclass
class Quote:
    symbol: str
    bid: float
    ask: float
    last: float
    volume: int
    ts: float = field(default_factory=_time.time)

    @property
    def spread(self) -> float:
        return round(self.ask - self.bid, 4)

    @property
    def mid(self) -> float:
        return round((self.bid + self.ask) / 2, 4)


@dataclass
class OpenTrade:
    symbol: str
    side: str            # "BUY" or "SELL"
    entry_price: float
    qty: int
    target_price: float  # rounded to 4 d.p.
    stop_price: float    # rounded to 4 d.p.
    order_id: str
    entered_at: float = field(default_factory=_time.time)


class Scalper:
    def __init__(self, cfg: dict, risk: RiskManager, broker):
        self._cfg = cfg
        self._risk = risk
        self._broker = broker
        self._history: dict[str, deque[Quote]] = {}
        self._open: dict[str, OpenTrade] = {}
        self._cooldown_until: dict[str, float] = {}   # symbol → epoch when cooldown expires
        window = cfg["momentum_period"] + 2
        for sym in cfg.get("watchlist", []):
            self._history[sym] = deque(maxlen=window)

    # ------------------------------------------------------------------ #

    def on_quote(self, q: Quote):
        """Called each polling cycle for a symbol."""
        hist = self._history.setdefault(
            q.symbol, deque(maxlen=self._cfg["momentum_period"] + 2)
        )
        hist.append(q)

        if q.symbol in self._open:
            self._manage(q)
        elif len(hist) >= self._cfg["momentum_period"]:
            self._try_enter(q, hist)

    # ------------------------------------------------------------------ #

    def _try_enter(self, q: Quote, hist: deque[Quote]):
        # --- guard 1: open-session warmup (wide spreads at session start) ---
        if self._cfg.get("warmup_minutes", 0) > 0 and is_warmup_period():
            log.debug("%s: session warmup — skipping entry", q.symbol)
            return

        # --- guard 2: per-symbol cooldown after recent exit ---
        if _time.time() < self._cooldown_until.get(q.symbol, 0):
            log.debug("%s: cooldown active — skipping entry", q.symbol)
            return

        tick = tick_size(q.last)
        min_spread = round(tick * self._cfg["min_spread_ticks"], 4)

        if q.spread < min_spread:
            return
        if q.volume < self._cfg.get("min_volume", 0):
            return

        momentum = round(hist[-1].mid - hist[0].mid, 6)
        # use tolerance instead of exact zero — float mid arithmetic can produce tiny residuals
        if abs(momentum) < 1e-9:
            return

        # --- guard 3: ATR / volatility filter ---
        min_atr_ticks = self._cfg.get("min_atr_ticks", 0)
        max_atr_ticks = self._cfg.get("max_atr_ticks", 0)
        if min_atr_ticks > 0 or max_atr_ticks > 0:
            bids = [h.bid for h in hist]
            atr = round(max(bids) - min(bids), 6)
            if min_atr_ticks > 0 and atr < tick * min_atr_ticks:
                log.debug("%s: ATR %.4f < min %.4f — too flat", q.symbol, atr, tick * min_atr_ticks)
                return
            if max_atr_ticks > 0 and atr > tick * max_atr_ticks:
                log.debug("%s: ATR %.4f > max %.4f — too volatile", q.symbol, atr, tick * max_atr_ticks)
                return

        target_ticks = self._cfg["target_profit_ticks"]
        stop_ticks   = self._cfg["stop_loss_ticks"]

        if momentum > 0:
            side         = "BUY"
            entry        = q.ask
            # round prices to 4 d.p. so comparison with incoming quotes is exact
            target_price = round(entry + tick * target_ticks, 4)
            stop_price   = round(entry - tick * stop_ticks,   4)
            expected_gross = round((target_price - entry) * 1, 6)  # per share
        else:
            side         = "SELL"
            entry        = q.bid
            target_price = round(entry - tick * target_ticks, 4)
            stop_price   = round(entry + tick * stop_ticks,   4)
            expected_gross = round((entry - target_price) * 1, 6)  # per share, profit = price falls

        # Position sizing: as many board lots (100 shares) as MaxPositionSGD allows
        max_sgd = self._cfg["max_position_sgd"]
        qty = int((max_sgd / entry) // 100) * 100
        if qty < 100:
            log.debug("%s: price S$%.4f too high for board lot at S$%s limit", q.symbol, entry, max_sgd)
            return

        trade_val = entry * qty
        ok, reason = self._risk.can_open(trade_val)
        if not ok:
            log.debug("%s: risk blocked — %s", q.symbol, reason)
            return

        # expected_gross for the whole position
        gross_total = expected_gross * qty
        net = self._risk.expected_net_pnl(gross_total, trade_val)
        if net <= 0:
            log.debug(
                "%s: not profitable after commission (gross=%.3f net=%.3f)",
                q.symbol, gross_total, net,
            )
            return

        order_id = self._broker.place_order(symbol=q.symbol, side=side, qty=qty, price=entry)
        if order_id is None:
            log.warning("%s: order placement failed", q.symbol)
            return

        self._risk.record_open()
        self._open[q.symbol] = OpenTrade(
            symbol=q.symbol, side=side, entry_price=entry, qty=qty,
            target_price=target_price, stop_price=stop_price, order_id=order_id,
        )
        log.info(
            "ENTER %s %s | entry=%.4f target=%.4f stop=%.4f qty=%d net_exp=%.3f SGD",
            side, q.symbol, entry, target_price, stop_price, qty, net,
        )

    def _manage(self, q: Quote):
        trade = self._open[q.symbol]
        max_hold = self._cfg["max_hold_seconds"]
        held = _time.time() - trade.entered_at

        exit_reason = None
        exit_price  = None

        if trade.side == "BUY":
            if q.bid >= trade.target_price:
                exit_reason, exit_price = "target",  q.bid
            elif q.bid <= trade.stop_price:
                exit_reason, exit_price = "stop",    q.bid
        else:  # SELL (short)
            if q.ask <= trade.target_price:
                exit_reason, exit_price = "target",  q.ask
            elif q.ask >= trade.stop_price:
                exit_reason, exit_price = "stop",    q.ask

        if exit_reason is None and held >= max_hold:
            exit_reason = "timeout"
            exit_price  = q.bid if trade.side == "BUY" else q.ask

        if exit_reason is None:
            return

        exit_side = "SELL" if trade.side == "BUY" else "BUY"
        self._broker.place_order(symbol=trade.symbol, side=exit_side, qty=trade.qty, price=exit_price)

        # gross PnL (direction-corrected)
        if trade.side == "BUY":
            gross = (exit_price - trade.entry_price) * trade.qty
        else:
            gross = (trade.entry_price - exit_price) * trade.qty

        # deduct round-trip commission so daily_pnl reflects actual cash impact
        trade_val  = trade.entry_price * trade.qty
        commission = self._risk.commission_for(trade_val)
        net_pnl    = round(gross - 2 * commission, 4)

        self._risk.record_close(trade.symbol, net_pnl)
        del self._open[trade.symbol]

        cooldown = self._cfg.get("cooldown_seconds", 0)
        if cooldown > 0:
            self._cooldown_until[trade.symbol] = _time.time() + cooldown
            log.debug("%s: cooldown set for %.0fs", trade.symbol, cooldown)

        log.info(
            "EXIT  %s | reason=%-8s entry=%.4f exit=%.4f gross=%+.3f comm=%.2f net=%+.3f SGD held=%.1fs",
            trade.symbol, exit_reason,
            trade.entry_price, exit_price,
            gross, commission * 2, net_pnl, held,
        )

    @property
    def open_symbols(self) -> list[str]:
        return list(self._open.keys())
