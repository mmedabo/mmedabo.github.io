"""
Monitoring dashboard — runs as a daemon thread inside the bot process.
A crash or slow request here can never block or kill the trading loop.

Safety design:
- Daemon thread: dies automatically when main process exits; never joins.
- Atomic state: _state is replaced as a whole dict (CPython GIL guarantees
  dict reference assignment is atomic — no lock needed for single-writer).
- All routes wrapped in try/except: web errors return HTTP 500, not exceptions.
- start() wrapped in try/except: port conflict or import error logs a warning
  and returns — trading continues without a dashboard.
"""
from __future__ import annotations
import logging
import os
import threading

from flask import Flask, jsonify, send_from_directory

log = logging.getLogger("web")

_STATIC = os.path.join(os.path.dirname(__file__), "static")
app = Flask(__name__, static_folder=_STATIC)

# ── shared state ──────────────────────────────────────────────────────────────
# Written by the main trading loop via update_state(); read by web routes.
# Never mutated in place — always replaced atomically.
_state: dict = {
    "running":        False,
    "mode":           "paper",
    "updated_at":     "--:--:--",
    "balance":        0.0,
    "daily_pnl":      0.0,
    "trades":         0,
    "open":           0,
    "consec_losses":  0,
    "size_factor":    1.0,
    "blacklisted":    [],
    "watchlist":      [],
    "open_positions": [],
    "recent_trades":  [],
}


def update_state(snapshot: dict) -> None:
    """Publish a new state snapshot from the trading loop (called every poll cycle)."""
    global _state
    _state = snapshot   # atomic reference replacement under CPython GIL


# ── routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    try:
        return send_from_directory(_STATIC, "index.html")
    except Exception as exc:
        log.error("dashboard serve error: %s", exc)
        return "Dashboard unavailable", 500


@app.route("/api/status")
def api_status():
    try:
        return jsonify(_state)
    except Exception as exc:
        log.error("status endpoint error: %s", exc)
        return jsonify({"error": "internal error"}), 500


@app.route("/api/health")
def api_health():
    return jsonify({"ok": True, "trading": _state.get("running", False)})


# ── startup ───────────────────────────────────────────────────────────────────

def start(host: str = "127.0.0.1", port: int = 5000) -> None:
    """Start the Flask server in a daemon thread. Never raises — trading is unaffected."""
    def _run() -> None:
        try:
            import logging as _l
            _l.getLogger("werkzeug").setLevel(_l.ERROR)   # suppress per-request log noise
            app.run(host=host, port=port, use_reloader=False, threaded=True)
        except Exception as exc:
            log.error("web server crashed: %s — trading continues unaffected", exc)

    try:
        t = threading.Thread(target=_run, name="web-monitor", daemon=True)
        t.start()
        log.info("monitoring dashboard → http://%s:%d", host, port)
    except Exception as exc:
        log.warning("could not start web dashboard: %s — trading unaffected", exc)
