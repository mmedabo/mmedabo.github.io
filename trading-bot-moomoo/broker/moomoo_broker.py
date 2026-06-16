"""
Moomoo (Futu) broker adapter using the official moomoo-api SDK.

Requires MoomooOpenD running locally. Download from:
https://www.moomoo.com/download/OpenAPI

Supported trade environments:
  TrdEnv.SIMULATE  — paper trading (no real money)
  TrdEnv.REAL      — live trading
"""
from __future__ import annotations
import logging
import time

import moomoo as ft

log = logging.getLogger("broker.moomoo")


class MoomooBroker:
    """Wraps Futu OpenAPI quote + trade contexts for SGX equity scalping."""

    def __init__(self, host: str, port: int, trade_env: str = "SIMULATE"):
        self._host = host
        self._port = port
        self._env = ft.TrdEnv.SIMULATE if trade_env.upper() == "SIMULATE" else ft.TrdEnv.REAL
        self._quote_ctx: ft.OpenQuoteContext | None = None
        self._trade_ctx: ft.OpenSecTradeContext | None = None

    # ------------------------------------------------------------------ #
    # lifecycle

    def connect(self):
        log.info("connecting to MoomooOpenD at %s:%d (env=%s)", self._host, self._port,
                 "SIMULATE" if self._env == ft.TrdEnv.SIMULATE else "REAL")
        self._quote_ctx = ft.OpenQuoteContext(host=self._host, port=self._port)
        self._trade_ctx = ft.OpenSecTradeContext(
            filter_trdmarket=ft.TrdMarket.SG,
            host=self._host,
            port=self._port,
            security_firm=ft.SecurityFirm.FUTUSECURITIES,
        )

    def close(self):
        if self._quote_ctx:
            self._quote_ctx.close()
        if self._trade_ctx:
            self._trade_ctx.close()

    # ------------------------------------------------------------------ #
    # quotes

    def get_quote(self, symbol: str) -> dict | None:
        """Returns dict with keys: bid, ask, last, volume. None on error."""
        ret, data = self._quote_ctx.get_stock_quote([symbol])
        if ret != ft.RET_OK or data.empty:
            log.warning("get_quote failed for %s: %s", symbol, data)
            return None
        row = data.iloc[0]
        return {
            "symbol": symbol,
            "bid":    float(row["bid_price"]),
            "ask":    float(row["ask_price"]),
            "last":   float(row["last_done"]),
            "volume": int(row["volume"]),
        }

    # ------------------------------------------------------------------ #
    # orders

    def place_order(self, symbol: str, side: str, qty: int, price: float) -> str | None:
        """Place a limit order. Returns order_id string, or None on failure."""
        trd_side = ft.TrdSide.BUY if side == "BUY" else ft.TrdSide.SELL
        ret, data = self._trade_ctx.place_order(
            price=round(price, 4),
            qty=qty,
            code=symbol,
            trd_side=trd_side,
            order_type=ft.OrderType.NORMAL,
            trd_env=self._env,
            time_in_force=ft.TimeInForce.DAY,   # auto-cancel at session end
        )
        if ret != ft.RET_OK:
            log.error("place_order failed for %s %s×%d@%.4f: %s", side, symbol, qty, price, data)
            return None
        order_id = str(data["order_id"].iloc[0])
        log.info("order placed: %s %s×%d@%.4f → id=%s", side, symbol, qty, price, order_id)
        return order_id

    def cancel_order(self, order_id: str) -> bool:
        ret, data = self._trade_ctx.modify_order(
            modify_order_op=ft.ModifyOrderOp.CANCEL,
            order_id=order_id,
            qty=0,
            price=0,
            trd_env=self._env,
        )
        return ret == ft.RET_OK

    # ------------------------------------------------------------------ #
    # account

    def get_positions(self) -> list[dict]:
        ret, data = self._trade_ctx.position_list_query(trd_env=self._env)
        if ret != ft.RET_OK:
            return []
        return data.to_dict("records")

    def get_balance(self) -> float:
        ret, data = self._trade_ctx.accinfo_query(trd_env=self._env)
        if ret != ft.RET_OK or data.empty:
            return 0.0
        return float(data.iloc[0]["cash"])
