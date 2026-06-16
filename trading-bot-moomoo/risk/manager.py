"""Risk manager: enforces position limits, daily loss cap, and commission breakeven."""
from __future__ import annotations
import threading
from datetime import date
from dataclasses import dataclass


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
        self._records: list[TradeRecord] = []

    def _check_day(self):
        if date.today() != self._day:
            self._reset()

    # --- public API ---

    def commission_for(self, trade_value: float) -> float:
        """One-way commission for a trade of the given SGD value."""
        rate = self._cfg["commission_rate"]
        min_c = self._cfg["min_commission_sgd"]
        return max(trade_value * rate, min_c)

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
            # use a small buffer (0.01 SGD) so we catch the limit even with rounding
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

    def record_open(self):
        with self._lock:
            self._check_day()
            self._open_count += 1
            self._trade_count += 1

    def record_close(self, symbol: str, pnl: float):
        with self._lock:
            self._check_day()
            self._open_count = max(0, self._open_count - 1)
            # round each trade to avoid floating-point drift over many cycles
            self._daily_pnl = round(self._daily_pnl + pnl, 4)
            self._records.append(TradeRecord(symbol, pnl, date.today()))

    def summary(self) -> dict:
        with self._lock:
            self._check_day()
            return {
                "trades":    self._trade_count,
                "open":      self._open_count,
                "daily_pnl": round(self._daily_pnl, 2),
            }
