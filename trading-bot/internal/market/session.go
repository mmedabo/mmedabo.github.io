package market

import "time"

// SGX trading hours in Singapore time (UTC+8).
// Pre-open: 08:30–09:00, Continuous: 09:00–12:00, Break: 12:00–13:00
// Afternoon: 13:00–17:00, Pre-close: 17:00–17:06, Closing: 17:06

var singaporeTZ = mustLoadLocation("Asia/Singapore")

func mustLoadLocation(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		// fallback to UTC+8 fixed offset if timezone DB unavailable
		return time.FixedZone("SGT", 8*3600)
	}
	return loc
}

// IsMarketOpen returns true if we're in a continuous trading session on SGX.
// We avoid the pre-open, lunch break, and closing auction to trade clean prices.
func IsMarketOpen(t time.Time) bool {
	sgt := t.In(singaporeTZ)
	wd := sgt.Weekday()
	if wd == time.Saturday || wd == time.Sunday {
		return false
	}

	h, m, _ := sgt.Clock()
	totalMin := h*60 + m

	morningOpen := 9*60           // 09:00
	morningClose := 11*60 + 50    // 11:50 (stop 10 min before lunch)
	afternoonOpen := 13*60 + 5    // 13:05 (5 min after afternoon open)
	afternoonClose := 16*60 + 50  // 16:50 (10 min before closing auction)

	return (totalMin >= morningOpen && totalMin < morningClose) ||
		(totalMin >= afternoonOpen && totalMin < afternoonClose)
}

// TimeUntilOpen returns how long until the next SGX trading session opens.
func TimeUntilOpen(now time.Time) time.Duration {
	sgt := now.In(singaporeTZ)
	y, mo, d := sgt.Date()
	nextOpen := time.Date(y, mo, d, 9, 0, 0, 0, singaporeTZ)

	// if we're past today's close (16:50), move to next business day
	h, min, _ := sgt.Clock()
	if h*60+min >= 16*60+50 {
		nextOpen = nextOpen.AddDate(0, 0, 1)
	}

	for nextOpen.Weekday() == time.Saturday || nextOpen.Weekday() == time.Sunday {
		nextOpen = nextOpen.AddDate(0, 0, 1)
	}

	d2 := nextOpen.Sub(now)
	if d2 < 0 {
		return 0
	}
	return d2
}
