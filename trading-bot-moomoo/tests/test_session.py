"""Tests for SGX market session logic."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime
import pytz
import pytest
from market.session import is_market_open, seconds_until_open

SGT = pytz.timezone("Asia/Singapore")


def sgt(weekday_mon0, hour, minute) -> datetime:
    """Build a SGT datetime on a specific weekday (0=Mon) for a recent Monday anchor."""
    # Use 2026-06-15 (Monday) as base
    from datetime import timedelta
    base = datetime(2026, 6, 15, tzinfo=SGT)   # Monday
    return base + timedelta(days=weekday_mon0, hours=hour, minutes=minute)


# --- is_market_open ---

def test_open_during_morning_session():
    assert is_market_open(sgt(0, 9, 30))   # Monday 09:30 SGT


def test_open_during_afternoon_session():
    assert is_market_open(sgt(0, 14, 0))   # Monday 14:00 SGT


def test_closed_before_market_open():
    assert not is_market_open(sgt(0, 8, 59))   # 1 minute before open


def test_closed_during_lunch_break():
    assert not is_market_open(sgt(0, 12, 0))   # exactly at morning close buffer
    assert not is_market_open(sgt(0, 12, 30))
    assert not is_market_open(sgt(0, 13, 4))   # just before afternoon open buffer


def test_closed_near_morning_end():
    assert not is_market_open(sgt(0, 11, 50))  # 11:50 → stop 10 min before lunch


def test_closed_after_market():
    assert not is_market_open(sgt(0, 16, 50))  # 16:50 → stop 10 min before closing auction
    assert not is_market_open(sgt(0, 17, 30))


def test_closed_on_saturday():
    assert not is_market_open(sgt(5, 10, 0))   # Saturday 10:00


def test_closed_on_sunday():
    assert not is_market_open(sgt(6, 10, 0))   # Sunday 10:00


def test_open_friday_morning():
    assert is_market_open(sgt(4, 9, 30))   # Friday 09:30


# --- seconds_until_open ---

def test_seconds_until_open_is_zero_when_open():
    t = sgt(0, 10, 0)   # Monday 10:00
    assert seconds_until_open(t) == 0.0


def test_seconds_until_open_returns_positive_when_closed():
    t = sgt(0, 8, 0)    # Monday 08:00 — 60 minutes before open
    wait = seconds_until_open(t)
    assert wait == pytest.approx(3600, abs=60)   # ~1 hour


def test_seconds_until_open_skips_to_next_day_after_close():
    t = sgt(0, 17, 0)   # Monday after close → next open is Tuesday 09:00
    wait = seconds_until_open(t)
    assert wait > 0
    assert wait < 86_400 * 2   # within 2 days


def test_seconds_until_open_skips_weekend():
    t = sgt(4, 17, 30)  # Friday after close → skip weekend → Monday 09:00
    wait = seconds_until_open(t)
    # Friday 17:30 to Monday 09:00 ≈ 63.5 hours = 228,600 seconds
    assert wait > 60 * 60 * 60
    assert wait < 86_400 * 3
