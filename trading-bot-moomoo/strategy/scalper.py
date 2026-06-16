"""
SGX Micro-Profit Scalping Strategy
====================================
Entry:  positive momentum (5-tick window) + spread ≥ 2 ticks + trade is profitable after commission
Exit:   first of — target ticks hit | stop-loss ticks hit | max hold time elapsed
"""
from __future__ import annotations
import logging
import time as _time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime

from risk.manager import RiskManager

log = logging.getLogger("scalper")


# SGX minimum tick sizes by price band
def tick_size(price: float) -> float:
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
        return self.ask - self.bid

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2


@dataclass
class OpenTrade:
    symbol: str
    side: str           # "BUY" or "SELL"
    entry_price: float
    qty: int
    target_price: float
    stop_price: float
    order_id: str
    entered_at: float = field(default_factory=_time.time)


class Scalper:
    def __init__(self, cfg: dict, risk: RiskManager, broker):
        self._cfg = cfg
        self._risk = risk
        self._broker = broker
        self._history: dict[str, deque[Quote]] = {}
        self._open: dict[str, OpenTrade] = {}   # symbol → trade
        window = cfg["momentum_period"] + 2
        for sym in cfg.get("watchlist", []):
            self._history[sym] = deque(maxlen=window)

    # ------------------------------------------------------------------ #

    def on_quote(self, q: Quote):
        """Called each polling cycle for a symbol."""
        hist = self._history.setdefault(q.symbol, deque(maxlen=self._cfg["momentum_period"] + 2))
        hist.append(q)

        if q.symbol in self._open:
            self._manage(q)
        elif len(hist) >= self._cfg["momentum_period"]:
            self._try_enter(q, hist)

    # ------------------------------------------------------------------ #

    def _try_enter(self, q: Quote, hist: deque[Quote]):
        tick = tick_size(q.last)
        min_spread = tick * self._cfg["min_spread_ticks"]

        if q.spread < min_spread:
            return
        if q.volume < self._cfg.get("min_volume", 0):
            return

        momentum = hist[-1].mid - hist[0].mid
        if momentum == 0:
            return

        target_ticks = self._cfg["target_profit_ticks"]
        stop_ticks   = self._cfg["stop_loss_ticks"]

        if momentum > 0:
            side         = "BUY"
            entry        = q.ask
            target_price = entry + tick * target_ticks
            stop_price   = entry - tick * stop_ticks
        else:
            side         = "SELL"
            entry        = q.bid
            target_price = entry - tick * target_ticks
            stop_price   = entry + tick * stop_ticks

        # Position sizing: as many board lots as MaxPositionSGD allows
        max_sgd = self._cfg["max_position_sgd"]
        qty = int((max_sgd / entry) // 100) * 100   # floor to board lot
        if qty < 100:
            log.debug("%s: price too high for board lot at S$%s limit", q.symbol, max_sgd)
            return

        trade_val = entry * qty
        ok, reason = self._risk.can_open(trade_val)
        if not ok:
            log.debug("%s: risk blocked — %s", q.symbol, reason)
            return

        net = self._risk.expected_net_pnl(entry, target_price, qty)
        if net <= 0:
            log.debug("%s: not profitable after commission (net=%.3f)", q.symbol, net)
            return

        order_id = self._broker.place_order(
            symbol=q.symbol, side=side, qty=qty, price=entry,
        )
        if order_id is None:
            log.warning("%s: order placement failed", q.symbol)
            return

        self._risk.record_open()
        self._open[q.symbol] = OpenTrade(
            symbol=q.symbol, side=side, entry_price=entry, qty=qty,
            target_price=target_price, stop_price=stop_price, order_id=order_id,
        )
        log.info(
            "ENTER %s %s | entry=%.4f target=%.4f stop=%.4f qty=%d net_exp=%.2f SGD",
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
                exit_reason, exit_price = "target", q.bid
            elif q.bid <= trade.stop_price:
                exit_reason, exit_price = "stop",   q.bid
        else:  # SELL
            if q.ask <= trade.target_price:
                exit_reason, exit_price = "target", q.ask
            elif q.ask >= trade.stop_price:
                exit_reason, exit_price = "stop",   q.ask

        if exit_reason is None and held >= max_hold:
            exit_reason = "timeout"
            exit_price  = q.bid if trade.side == "BUY" else q.ask

        if exit_reason is None:
            return

        exit_side = "SELL" if trade.side == "BUY" else "BUY"
        self._broker.place_order(
            symbol=trade.symbol, side=exit_side, qty=trade.qty, price=exit_price,
        )

        if trade.side == "BUY":
            pnl = (exit_price - trade.entry_price) * trade.qty
        else:
            pnl = (trade.entry_price - exit_price) * trade.qty

        self._risk.record_close(trade.symbol, pnl)
        del self._open[trade.symbol]

        log.info(
            "EXIT  %s | reason=%-8s entry=%.4f exit=%.4f pnl=%+.2f SGD held=%.1fs",
            trade.symbol, exit_reason, trade.entry_price, exit_price, pnl, held,
        )

    @property
    def open_symbols(self) -> list[str]:
        return list(self._open.keys())
