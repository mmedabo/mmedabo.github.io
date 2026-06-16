"""Risk manager: enforces position limits, daily loss cap, and commission breakeven."""
from __future__ import annotations
import logging
import threading
from collections import deque
from datetime import date
from dataclasses import dataclass

log = logging.getLogger("risk")


@dataclass
class TradeRecord:
    symbol: str
    pnl: float
    timestamp: date


class RiskManager:
    def __init__(self, cfg: dict):
        self._cfg = cfg
        self._lock = threading.Lock()
        self._reset()

    def _reset(self):
        self._day = date.today()
        self._daily_pnl: float = 0.0
        self._trade_count: int = 0
        self._open_count: int = 0
        self._records: deque[TradeRecord] = deque(maxlen=500)
        # adaptive features — reset each calendar day
        self._symbol_stops: dict[str, int] = {}     # losses per symbol today
        self._symbol_blacklist: set[str] = set()    # symbols barred for rest of day
        self._consecutive_losses: int = 0           # back-to-back losses (any symbol)

    def _check_day(self):
        if date.today() != self._day:
            self._reset()

    # ── public API ────────────────────────────────────────────────────────

    def commission_for(self, trade_value: float) -> float:
        """One-way commission for a trade of the given SGD value."""
        return max(trade_value * self._cfg["commission_rate"],
                   self._cfg["min_commission_sgd"])

    def can_open(self, trade_value_sgd: float) -> tuple[bool, str]:
        """Returns (allowed, reason). Call before placing an entry order."""
        with self._lock:
            self._check_day()
            max_pos    = self._cfg["max_position_sgd"]
            max_loss   = self._cfg["max_daily_loss_sgd"]
            max_open   = self._cfg["max_open_positions"]
            max_trades = self._cfg["max_trades_per_day"]

            if self._open_count >= max_open:
                return False, f"max open positions ({max_open}) reached"
            if self._trade_count >= max_trades:
                return False, f"max daily trades ({max_trades}) reached"
            if self._daily_pnl <= -(max_loss - 0.01):
                return False, f"daily loss limit reached (${max_loss:.2f} SGD)"
            if trade_value_sgd > max_pos:
                return False, f"position ${trade_value_sgd:.0f} > limit ${max_pos:.0f} SGD"
            return True, ""

    def expected_net_pnl(self, expected_gross: float, trade_value: float) -> float:
        """Net PnL after round-trip commission.
        expected_gross must already reflect direction (always positive for a profitable trade).
        """
        return expected_gross - 2 * self.commission_for(trade_value)

    def is_symbol_blacklisted(self, symbol: str) -> bool:
        """True if this symbol has hit its per-day stop limit and is barred."""
        with self._lock:
            self._check_day()
            return symbol in self._symbol_blacklist

    def position_size_factor(self) -> float:
        """Returns 1.0 normally; steps down to stepdown_factor after N consecutive losses."""
        with self._lock:
            stepdown_after = self._cfg.get("stepdown_after_losses", 0)
            if stepdown_after > 0 and self._consecutive_losses >= stepdown_after:
                return self._cfg.get("stepdown_factor", 0.5)
            return 1.0

    def record_open(self):
        with self._lock:
            self._check_day()
            self._open_count += 1
            self._trade_count += 1

    def record_close(self, symbol: str, pnl: float):
        with self._lock:
            self._check_day()
            self._open_count = max(0, self._open_count - 1)
            self._daily_pnl = round(self._daily_pnl + pnl, 4)
            self._records.append(TradeRecord(symbol, pnl, date.today()))

            if pnl < 0:
                # per-symbol blacklist: too many losses on the same stock today
                self._symbol_stops[symbol] = self._symbol_stops.get(symbol, 0) + 1
                max_stops = self._cfg.get("max_stops_per_symbol", 0)
                if max_stops > 0 and self._symbol_stops[symbol] >= max_stops:
                    if symbol not in self._symbol_blacklist:
                        self._symbol_blacklist.add(symbol)
                        log.warning(
                            "symbol %s blacklisted for rest of day (%d losses today)",
                            symbol, self._symbol_stops[symbol],
                        )

                # consecutive loss stepdown
                self._consecutive_losses += 1
                stepdown_after = self._cfg.get("stepdown_after_losses", 0)
                if stepdown_after > 0 and self._consecutive_losses == stepdown_after:
                    factor = self._cfg.get("stepdown_factor", 0.5)
                    log.warning(
                        "%d consecutive losses — position size stepped down to %.0f%%",
                        self._consecutive_losses, factor * 100,
                    )
            else:
                # any non-loss resets the streak
                if self._consecutive_losses > 0:
                    log.info("win after %d losses — position size restored to 100%%",
                             self._consecutive_losses)
                    self._consecutive_losses = 0

    def summary(self) -> dict:
        with self._lock:
            self._check_day()
            stepdown_after = self._cfg.get("stepdown_after_losses", 0)
            factor = (self._cfg.get("stepdown_factor", 0.5)
                      if stepdown_after > 0 and self._consecutive_losses >= stepdown_after
                      else 1.0)
            return {
                "trades":        self._trade_count,
                "open":          self._open_count,
                "daily_pnl":     round(self._daily_pnl, 2),
                "consec_losses": self._consecutive_losses,
                "blacklisted":   sorted(self._symbol_blacklist),
                "size_factor":   factor,
            }
