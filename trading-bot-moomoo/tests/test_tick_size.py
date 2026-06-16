"""Tests for SGX tick size boundaries."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from strategy.scalper import tick_size


@pytest.mark.parametrize("price,expected", [
    (0.001, 0.001),   # penny stock
    (0.10,  0.001),   # below 0.20
    (0.199, 0.001),   # just below 0.20
    (0.20,  0.005),   # exactly at 0.20 boundary
    (0.59,  0.005),   # Thai Bev typical price
    (1.00,  0.005),   # mid-range
    (1.999, 0.005),   # just below 2.00
    (2.00,  0.01),    # exactly at 2.00 boundary
    (2.35,  0.01),    # SingTel
    (6.75,  0.01),    # Keppel
    (14.10, 0.01),    # Venture
    (36.50, 0.01),    # DBS
])
def test_tick_size(price, expected):
    assert tick_size(price) == pytest.approx(expected)
