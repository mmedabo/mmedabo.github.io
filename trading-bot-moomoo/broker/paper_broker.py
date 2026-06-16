"""
Paper trading broker — simulates Moomoo without requiring OpenD.
Prices follow a random walk seeded from realistic SGX starting prices.
"""
from __future__ import annotations
import logging
import random
import threading
import time

log = logging.getLogger("broker.paper")

_BASE_PRICES: dict[str, float] = {
    "D05.SI": 36.50,  "O39.SI": 14.80,  "U11.SI": 32.20,
    "Z74.SI":  2.35,  "F34.SI":  3.18,  "BN4.SI":  6.75,
    "C6L.SI":  6.40,  "V03.SI": 14.10,  "Y92.SI":  0.59,
}

def _tick(price: float) -> float:
    if price < 0.20: return 0.001
    if price < 2.00: return 0.005
    return 0.01


class PaperBroker:
    def __init__(self, initial_cash: float = 50_000.0):
        self._lock = threading.Lock()
        self._cash = initial_cash
        self._prices = {k: v for k, v in _BASE_PRICES.items()}
        self._positions: dict[str, dict] = {}
        self._orders: dict[str, dict] = {}
        self._next_id = 0

    # ------------------------------------------------------------------ #

    def get_quote(self, symbol: str) -> dict | None:
        with self._lock:
            base = self._prices.get(symbol, 1.00)
            tick = _tick(base)
            drift = random.uniform(-2, 2) * tick
            base = max(0.10, round(base + drift, 4))
            self._prices[symbol] = base
            spread = tick * 2
            return {
                "symbol": symbol,
                "bid":    round(base - spread / 2, 4),
                "ask":    round(base + spread / 2, 4),
                "last":   base,
                "volume": random.randint(500_000, 2_000_000),
            }

    def place_order(self, symbol: str, side: str, qty: int, price: float) -> str | None:
        with self._lock:
            self._next_id += 1
            oid = f"PAPER-{self._next_id:05d}"
            fill = round(price, 4)
            trade_val = fill * qty
            commission = max(trade_val * 0.0003, 0.99)

            if side == "BUY":
                cost = trade_val + commission
                if cost > self._cash:
                    log.warning("paper: insufficient cash (need %.2f have %.2f)", cost, self._cash)
                    return None
                self._cash -= cost
                if symbol in self._positions:
                    pos = self._positions[symbol]
                    total = pos["qty"] + qty
                    pos["avg_cost"] = (pos["avg_cost"] * pos["qty"] + fill * qty) / total
                    pos["qty"] = total
                else:
                    self._positions[symbol] = {"qty": qty, "avg_cost": fill}
            else:  # SELL
                pos = self._positions.get(symbol)
                if not pos or pos["qty"] < qty:
                    log.warning("paper: no position to sell for %s", symbol)
                    return None
                self._cash += trade_val - commission
                pos["qty"] -= qty
                if pos["qty"] == 0:
                    del self._positions[symbol]

            self._orders[oid] = {"symbol": symbol, "side": side, "qty": qty, "fill": fill}
            log.info("paper order %s: %s %s×%d@%.4f | cash=%.2f", oid, side, symbol, qty, fill, self._cash)
            return oid

    def cancel_order(self, order_id: str) -> bool:
        return True

    def get_positions(self) -> list[dict]:
        with self._lock:
            return [{"code": k, **v} for k, v in self._positions.items()]

    def get_balance(self) -> float:
        with self._lock:
            return self._cash
