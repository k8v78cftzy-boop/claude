"""Serveur web : API JSON d'analyse financière + interface statique.

Lancement : ``python app.py`` puis ouvrir http://127.0.0.1:5000
"""
from __future__ import annotations

import logging
import os
import re

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

from finance import analysis, data

app = Flask(__name__, static_folder="static", static_url_path="/static")
log = logging.getLogger("finance")

SYMBOL_RE = re.compile(r"^[A-Za-z0-9^.=\-]{1,20}$")
VALID_PERIODS = {"6mo", "1y", "3y", "5y", "10y", "max"}


def _symbol(raw: str) -> str:
    raw = (raw or "").strip()
    if not SYMBOL_RE.match(raw):
        raise ValueError("Symbole invalide.")
    return raw.upper()


def _error(message: str, status: int):
    return jsonify({"error": message}), status


@app.errorhandler(ValueError)
def _bad_request(e):
    return _error(str(e), 400)


@app.errorhandler(LookupError)
def _not_found(e):
    return _error(str(e), 404)


@app.errorhandler(Exception)
def _server_error(e):
    if isinstance(e, HTTPException):
        return _error(e.description or e.name, e.code or 500)
    log.exception("Erreur serveur")
    return _error(f"Erreur lors de la récupération des données : {e}", 502)


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/search")
def api_search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify([])
    return jsonify(data.search(q[:60]))


@app.get("/api/market")
def api_market():
    return jsonify(data.market_overview())


@app.get("/api/quotes")
def api_quotes():
    symbols = [_symbol(s) for s in request.args.get("symbols", "").split(",") if s.strip()][:30]
    return jsonify(data.market_overview([(s, s) for s in symbols]))


@app.get("/api/stock/<symbol>")
def api_stock(symbol):
    return jsonify(analysis.analyze(_symbol(symbol)))


@app.get("/api/risk/<symbol>")
def api_risk(symbol):
    period = request.args.get("period", "1y")
    if period not in VALID_PERIODS:
        raise ValueError("Période invalide.")
    bench = request.args.get("benchmark") or None
    if bench:
        bench = _symbol(bench)
    rf = request.args.get("rf")
    rf_val = float(rf) if rf not in (None, "") else None
    if rf_val is not None and not (-0.05 <= rf_val <= 0.5):
        raise ValueError("Taux sans risque hors bornes (décimal attendu, ex. 0.04).")
    return jsonify(analysis.risk_report(_symbol(symbol), period, bench, rf_val))


@app.get("/api/intraday/<symbol>")
def api_intraday(symbol):
    rng = request.args.get("range", "1d")
    interval = {"1d": "5m", "5d": "15m"}.get(rng)
    if not interval:
        raise ValueError("Plage invalide.")
    df = data.history(_symbol(symbol), rng, interval)
    if df.empty:
        raise LookupError("Pas de données intrajournalières.")
    return jsonify({
        "time": [int(t.timestamp()) for t in df.index],
        "close": [round(float(x), 4) for x in df["Close"]],
        "volume": [int(x) if x == x else 0 for x in df["Volume"]],
    })


@app.get("/api/news/<symbol>")
def api_news(symbol):
    return jsonify(data.news(_symbol(symbol)))


@app.get("/api/compare")
def api_compare():
    symbols = [s for s in request.args.get("symbols", "").split(",") if s.strip()]
    if not symbols:
        raise ValueError("Indiquez au moins un symbole.")
    if len(symbols) > 8:
        raise ValueError("8 symboles maximum.")
    period = request.args.get("period", "1y")
    if period not in VALID_PERIODS:
        raise ValueError("Période invalide.")
    return jsonify(analysis.compare([_symbol(s) for s in symbols], period))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
