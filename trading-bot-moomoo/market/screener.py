"""
Low-value SGX stock screener for S$1,000-capital scalping.

Filters the watchlist to stocks that:
  - Have a current price ≤ max_price_sgd (default S$3.00)
  - Have daily volume ≥ min_volume (default 1,000,000 shares)
  - Can fit at least one board lot (100 shares) within the capital limit

Then ranks survivors by a liquidity score:
  score = (volume / 1_000_000) / spread_pct
  (high volume relative to spread wins)

Usage:
  candidates = screen(broker, watchlist, cfg)
  # → sorted list of symbols, best first
"""
from __future__ import annotations

import logging

log = logging.getLogger("screener")


def _spread_pct(bid: float, ask: float) -> float:
    mid = (bid + ask) / 2
    if mid <= 0:
        return 999.0
    return (ask - bid) / mid


def screen(
    broker,
    watchlist: list[str],
    cfg: dict,
) -> list[str]:
    """Return watchlist symbols that pass filters, ranked best-first.

    cfg keys used:
      max_price_sgd   — price ceiling (default 3.00)
      min_volume      — minimum daily volume (default 1_000_000)
      max_position_sgd — capital limit used to confirm ≥1 board lot fits
    """
    max_price  = cfg.get("max_price_sgd", 3.00)
    min_vol    = cfg.get("min_volume", 1_000_000)
    capital    = cfg.get("max_position_sgd", 1_000)

    scored: list[tuple[float, str]] = []

    for sym in watchlist:
        raw = broker.get_quote(sym)
        if raw is None:
            log.debug("screener: no quote for %s — skipped", sym)
            continue

        bid  = raw["bid"]
        ask  = raw["ask"]
        last = raw.get("last", (bid + ask) / 2)
        vol  = raw.get("volume", 0)

        if last > max_price:
            log.debug("screener: %s price S$%.4f > max S$%.2f — skipped", sym, last, max_price)
            continue

        if vol < min_vol:
            log.debug("screener: %s volume %d < min %d — skipped", sym, vol, min_vol)
            continue

        # ensure at least one board lot fits within capital
        if ask * 100 > capital:
            log.debug("screener: %s ask S$%.4f × 100 = S$%.2f exceeds capital S$%.2f — skipped",
                      sym, ask, ask * 100, capital)
            continue

        sp = _spread_pct(bid, ask)
        if sp <= 0:
            continue

        score = (vol / 1_000_000) / sp
        scored.append((score, sym))
        log.debug("screener: %s price=%.4f vol=%d spread_pct=%.4f score=%.2f",
                  sym, last, vol, sp, score)

    scored.sort(reverse=True, key=lambda x: x[0])
    result = [sym for _, sym in scored]
    log.info("screener: %d/%d symbols pass filters: %s", len(result), len(watchlist), result)
    return result
