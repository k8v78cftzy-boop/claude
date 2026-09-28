"""Récupération des données de marché via yfinance (Yahoo Finance), avec cache mémoire."""
from __future__ import annotations

import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from functools import wraps

import pandas as pd
import yfinance as yf

# ---------------------------------------------------------------------------
# Cache mémoire avec durée de vie
# ---------------------------------------------------------------------------

_cache: dict = {}
_lock = threading.Lock()


def cached(ttl: int):
    def deco(fn):
        @wraps(fn)
        def wrapper(*args):
            key = (fn.__name__, args)
            now = time.time()
            with _lock:
                hit = _cache.get(key)
                if hit and now - hit[0] < ttl:
                    return hit[1]
            value = fn(*args)
            with _lock:
                _cache[key] = (now, value)
            return value
        return wrapper
    return deco


def clear_cache():
    with _lock:
        _cache.clear()


# ---------------------------------------------------------------------------
# Devises : sous-unités cotées (pence, agorot, cents sud-africains)
# ---------------------------------------------------------------------------

SUBUNITS = {"GBp": ("GBP", 100), "GBX": ("GBP", 100), "ILA": ("ILS", 100), "ZAc": ("ZAR", 100),
            "ZAC": ("ZAR", 100)}


def major_currency(code: str | None) -> tuple[str | None, float]:
    """Renvoie (devise principale, diviseur) : 'GBp' -> ('GBP', 100)."""
    if not code:
        return None, 1.0
    if code in SUBUNITS:
        return SUBUNITS[code]
    return code.upper(), 1.0


# Indice de référence par défaut selon la place de cotation (suffixe Yahoo)
BENCHMARKS = {
    ".PA": "^FCHI", ".DE": "^GDAXI", ".F": "^GDAXI", ".L": "^FTSE", ".AS": "^AEX", ".BR": "^BFX",
    ".MI": "FTSEMIB.MI", ".MC": "^IBEX", ".SW": "^SSMI", ".T": "^N225", ".HK": "^HSI", ".TO": "^GSPTSE",
    ".AX": "^AXJO", ".KS": "^KS11", ".SS": "000001.SS", ".SZ": "399001.SZ", ".NS": "^NSEI", ".BO": "^BSESN",
    ".SA": "^BVSP", ".ST": "^OMX", ".OL": "OBX.OL", ".CO": "^OMXC25", ".HE": "^OMXH25", ".LS": "PSI20.LS",
    ".VI": "^ATX", ".IR": "^ISEQ", ".MX": "^MXX", ".TW": "^TWII", ".SI": "^STI", ".JK": "^JKSE",
}

MARKET_OVERVIEW = [
    ("^GSPC", "S&P 500"), ("^IXIC", "Nasdaq"), ("^DJI", "Dow Jones"), ("^FCHI", "CAC 40"),
    ("^STOXX50E", "Euro Stoxx 50"), ("^GDAXI", "DAX"), ("^FTSE", "FTSE 100"), ("^N225", "Nikkei 225"),
    ("^HSI", "Hang Seng"), ("^VIX", "VIX"), ("^TNX", "Taux US 10 ans"), ("EURUSD=X", "EUR/USD"),
    ("GC=F", "Or"), ("CL=F", "Pétrole WTI"), ("BTC-USD", "Bitcoin"),
]


def default_benchmark(symbol: str) -> str:
    s = symbol.upper()
    for suffix, bench in BENCHMARKS.items():
        if s.endswith(suffix):
            return bench
    return "^GSPC"


def _clean(v):
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


# ---------------------------------------------------------------------------
# Accès Yahoo Finance
# ---------------------------------------------------------------------------


@cached(3600)
def search(query: str) -> list[dict]:
    res = yf.Search(query, max_results=10, news_count=0, lists_count=0, include_cb=False, recommended=0,
                    raise_errors=False)
    out = []
    for q in res.quotes:
        out.append({
            "symbol": q.get("symbol"),
            "name": q.get("longname") or q.get("shortname") or q.get("symbol"),
            "exchange": q.get("exchDisp") or q.get("exchange"),
            "type": q.get("typeDisp") or q.get("quoteType"),
        })
    return out


@cached(300)
def info(symbol: str) -> dict:
    try:
        data = yf.Ticker(symbol).get_info() or {}
    except Exception:  # Yahoo renvoie parfois une erreur pour les indices/devises
        data = {}
    return {k: _clean(v) for k, v in data.items()}


@cached(300)
def history(symbol: str, period: str = "max", interval: str = "1d") -> pd.DataFrame:
    df = yf.Ticker(symbol).history(period=period, interval=interval, auto_adjust=False, actions=True)
    if df is None or df.empty:
        return pd.DataFrame()
    df = df.dropna(subset=["Close"])
    if "Adj Close" not in df.columns:
        df["Adj Close"] = df["Close"]
    return df


@cached(3600)
def statements(symbol: str) -> dict:
    t = yf.Ticker(symbol)

    def safe(fn, **kw):
        try:
            df = fn(pretty=False, **kw)
            return df if isinstance(df, pd.DataFrame) else pd.DataFrame()
        except Exception:
            return pd.DataFrame()

    return {
        "income": safe(t.get_income_stmt, freq="yearly"),
        "balance": safe(t.get_balance_sheet, freq="yearly"),
        "cashflow": safe(t.get_cash_flow, freq="yearly"),
        "income_q": safe(t.get_income_stmt, freq="quarterly"),
        "balance_q": safe(t.get_balance_sheet, freq="quarterly"),
        "cashflow_q": safe(t.get_cash_flow, freq="quarterly"),
        "income_ttm": safe(t.get_income_stmt, freq="trailing"),
        "cashflow_ttm": safe(t.get_cash_flow, freq="trailing"),
    }


@cached(3600)
def dividends(symbol: str) -> pd.Series:
    try:
        s = yf.Ticker(symbol).get_dividends(period="max")
        return s if isinstance(s, pd.Series) else pd.Series(dtype=float)
    except Exception:
        return pd.Series(dtype=float)


@cached(900)
def news(symbol: str) -> list[dict]:
    try:
        items = yf.Ticker(symbol).get_news(count=15) or []
    except Exception:
        return []
    out = []
    for it in items:
        c = it.get("content") if isinstance(it.get("content"), dict) else None
        if c:  # format Yahoo depuis 2025
            url = (c.get("clickThroughUrl") or {}).get("url") or (c.get("canonicalUrl") or {}).get("url")
            out.append({"title": c.get("title"), "publisher": (c.get("provider") or {}).get("displayName"),
                        "link": url, "date": c.get("pubDate"), "summary": c.get("summary")})
        else:  # ancien format
            ts = it.get("providerPublishTime")
            out.append({"title": it.get("title"), "publisher": it.get("publisher"), "link": it.get("link"),
                        "date": pd.Timestamp(ts, unit="s").isoformat() if ts else None, "summary": None})
    return [n for n in out if n["title"] and n["link"]]


def last_close(symbol: str) -> float | None:
    df = history(symbol, "5d", "1d")
    if df.empty:
        return None
    v = float(df["Close"].iloc[-1])
    return v if math.isfinite(v) else None


@cached(3600)
def fx_rate(src: str | None, dst: str | None) -> float | None:
    """Taux de change src -> dst (1 src = x dst) via la paire Yahoo SRCDST=X."""
    if not src or not dst:
        return None
    if src.upper() == dst.upper():
        return 1.0
    rate = last_close(f"{src.upper()}{dst.upper()}=X")
    if rate:
        return rate
    inv = last_close(f"{dst.upper()}{src.upper()}=X")
    return 1 / inv if inv else None


@cached(3600)
def risk_free_rate() -> dict:
    """Rendement du T-Note 10 ans US (^TNX, coté en pourcentage)."""
    v = last_close("^TNX")
    if v is None:
        return {"value": None, "source": "^TNX indisponible"}
    rate = v / 100 if v < 20 else v / 1000  # garde-fou si la cotation était en dixièmes de %
    return {"value": rate, "source": "Rendement T-Note 10 ans US (^TNX)"}


def market_overview(items=None) -> list[dict]:
    items = items or MARKET_OVERVIEW

    def one(item):
        sym, name = item
        try:
            df = history(sym, "5d", "1d")
        except Exception:
            df = pd.DataFrame()
        if df.empty or len(df) < 2:
            return {"symbol": sym, "name": name, "price": None, "change": None, "change_pct": None}
        last, prev = float(df["Close"].iloc[-1]), float(df["Close"].iloc[-2])
        return {"symbol": sym, "name": name, "price": last, "change": last - prev,
                "change_pct": last / prev - 1 if prev else None}

    with ThreadPoolExecutor(max_workers=8) as ex:
        return list(ex.map(one, items))
