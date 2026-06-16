"""SGX trading session helpers."""
from datetime import datetime, time
import pytz

SGT = pytz.timezone("Asia/Singapore")

# Continuous trading windows (SGX, excluding auctions and lunch break)
_MORNING_OPEN  = time(9,  0)
_MORNING_CLOSE = time(11, 50)   # stop 10 min before lunch
_AFTERNOON_OPEN  = time(13, 5)  # 5 min after afternoon open
_AFTERNOON_CLOSE = time(16, 50) # 10 min before closing auction


def is_market_open(now: datetime | None = None) -> bool:
    sgt = (now or datetime.now(SGT)).astimezone(SGT)
    if sgt.weekday() >= 5:  # Saturday=5, Sunday=6
        return False
    t = sgt.time()
    return (
        (_MORNING_OPEN <= t < _MORNING_CLOSE) or
        (_AFTERNOON_OPEN <= t < _AFTERNOON_CLOSE)
    )


def seconds_until_open(now: datetime | None = None) -> float:
    """Return seconds until next SGX continuous session opens (0 if currently open)."""
    if is_market_open(now):
        return 0.0
    from datetime import timedelta
    sgt = (now or datetime.now(SGT)).astimezone(SGT)
    candidate = sgt.replace(hour=9, minute=0, second=0, microsecond=0)
    if sgt.time() >= _AFTERNOON_CLOSE:
        candidate += timedelta(days=1)
    while candidate.weekday() >= 5:
        candidate += timedelta(days=1)
    return max(0.0, (candidate - sgt).total_seconds())
