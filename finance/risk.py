"""Mesures de rendement, de risque et de performance ajustée du risque (marchés financiers).

Conventions :
- rendements simples quotidiens r_t = P_t / P_{t-1} - 1 sur cours ajustés (dividendes et splits) ;
- annualisation avec 252 séances ;
- rf : taux sans risque annuel (décimal), converti en taux quotidien rf/252.
"""
from __future__ import annotations

import math
from statistics import NormalDist

import numpy as np
import pandas as pd

TRADING_DAYS = 252


def _f(x):
    """Convertit en float Python, None si NaN/inf."""
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def returns(prices: pd.Series) -> pd.Series:
    return prices.pct_change().dropna()


def drawdown_series(prices: pd.Series) -> pd.Series:
    """Drawdown_t = P_t / max(P_0..P_t) - 1."""
    return prices / prices.cummax() - 1


def return_stats(prices: pd.Series, rf: float = 0.0) -> dict:
    """Statistiques sur une série de prix (sans indice de référence)."""
    prices = prices.dropna()
    r = returns(prices)
    n = len(r)
    if n < 2:
        return {}
    days = (prices.index[-1] - prices.index[0]).days
    years = days / 365.25 if days > 0 else None
    total = prices.iloc[-1] / prices.iloc[0] - 1
    cagr = (prices.iloc[-1] / prices.iloc[0]) ** (1 / years) - 1 if years else None
    mean_d = r.mean()
    std_d = r.std(ddof=1)
    vol = std_d * math.sqrt(TRADING_DAYS)
    rf_d = rf / TRADING_DAYS
    ex = r - rf_d
    sharpe = ex.mean() / ex.std(ddof=1) * math.sqrt(TRADING_DAYS) if ex.std(ddof=1) > 0 else None
    downside = np.sqrt(np.mean(np.minimum(ex.to_numpy(), 0.0) ** 2)) * math.sqrt(TRADING_DAYS)
    sortino = ex.mean() * TRADING_DAYS / downside if downside > 0 else None
    dd = drawdown_series(prices)
    mdd = dd.min()
    calmar = cagr / abs(mdd) if (cagr is not None and mdd < 0) else None
    q05 = r.quantile(0.05)
    q01 = r.quantile(0.01)
    z95 = NormalDist().inv_cdf(0.95)
    z99 = NormalDist().inv_cdf(0.99)
    gains = np.maximum(r.to_numpy() - rf_d, 0).sum()
    losses = np.maximum(rf_d - r.to_numpy(), 0).sum()
    ulcer = math.sqrt(float(np.mean((dd.to_numpy() * 100) ** 2)))
    # durée du plus long drawdown (en jours calendaires, du sommet à la récupération)
    longest = 0
    peak_date = prices.index[0]
    for date, value in dd.items():
        if value == 0:
            peak_date = date
        else:
            longest = max(longest, (date - peak_date).days)
    return {
        "observations": n,
        "start": prices.index[0].strftime("%Y-%m-%d"),
        "end": prices.index[-1].strftime("%Y-%m-%d"),
        "total_return": _f(total),
        "cagr": _f(cagr),
        "mean_return_ann": _f(mean_d * TRADING_DAYS),
        "volatility_ann": _f(vol),
        "sharpe": _f(sharpe),
        "sortino": _f(sortino),
        "downside_dev_ann": _f(downside),
        "max_drawdown": _f(mdd),
        "longest_drawdown_days": longest,
        "calmar": _f(calmar),
        "ulcer_index": _f(ulcer),
        "omega": _f(gains / losses) if losses > 0 else None,
        "var95_hist": _f(-q05),
        "var99_hist": _f(-q01),
        "var95_param": _f(-(mean_d - z95 * std_d)),
        "var99_param": _f(-(mean_d - z99 * std_d)),
        "cvar95": _f(-r[r <= q05].mean()),
        "cvar99": _f(-r[r <= q01].mean()),
        "skewness": _f(r.skew()),
        "excess_kurtosis": _f(r.kurt()),
        "best_day": _f(r.max()),
        "worst_day": _f(r.min()),
        "positive_days": _f((r > 0).mean()),
    }


def to_daily_index(s: pd.Series) -> pd.Series:
    """Ramène un index horodaté (avec fuseau) à des dates calendaires sans fuseau."""
    s = s.copy()
    idx = pd.DatetimeIndex(s.index)
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    s.index = idx.normalize()
    return s[~s.index.duplicated(keep="last")]


def relative_stats(prices: pd.Series, bench: pd.Series, rf: float = 0.0) -> dict:
    """Statistiques relatives à un indice : bêta, alpha de Jensen, R², Treynor, TE, IR."""
    p = to_daily_index(prices.dropna())
    b = to_daily_index(bench.dropna())
    df = pd.concat([p.rename("s"), b.rename("m")], axis=1, join="inner").dropna()
    if len(df) < 3:
        return {}
    r = df.pct_change().dropna()
    rs, rm = r["s"], r["m"]
    var_m = rm.var(ddof=1)
    if var_m == 0:
        return {}
    beta = rs.cov(rm, ddof=1) / var_m
    corr = rs.corr(rm)
    rf_d = rf / TRADING_DAYS
    alpha_d = rs.mean() - (rf_d + beta * (rm.mean() - rf_d))
    active = rs - rm
    te = active.std(ddof=1) * math.sqrt(TRADING_DAYS)
    ann_ret = rs.mean() * TRADING_DAYS
    up = rm > 0
    down = rm < 0
    up_cap = rs[up].mean() / rm[up].mean() if up.any() else None
    down_cap = rs[down].mean() / rm[down].mean() if down.any() else None
    return {
        "beta": _f(beta),
        "alpha_jensen_ann": _f(alpha_d * TRADING_DAYS),
        "correlation": _f(corr),
        "r_squared": _f(corr ** 2),
        "treynor": _f((ann_ret - rf) / beta) if beta != 0 else None,
        "tracking_error": _f(te),
        "information_ratio": _f(active.mean() * TRADING_DAYS / te) if te > 0 else None,
        "upside_capture": _f(up_cap),
        "downside_capture": _f(down_cap),
        "benchmark_total_return": _f(df["m"].iloc[-1] / df["m"].iloc[0] - 1),
        "common_observations": len(r),
    }


def monthly_beta(prices: pd.Series, bench: pd.Series) -> float | None:
    """Bêta sur rendements mensuels (fin de mois), méthode usuelle 5 ans mensuel."""
    p = to_daily_index(prices.dropna()).resample("ME").last()
    b = to_daily_index(bench.dropna()).resample("ME").last()
    df = pd.concat([p.rename("s"), b.rename("m")], axis=1, join="inner").dropna()
    r = df.pct_change().dropna()
    if len(r) < 12:
        return None
    var_m = r["m"].var(ddof=1)
    return _f(r["s"].cov(r["m"], ddof=1) / var_m) if var_m > 0 else None


def return_histogram(prices: pd.Series, bins: int = 40) -> dict:
    r = returns(prices.dropna())
    if len(r) < 2:
        return {"edges": [], "counts": []}
    counts, edges = np.histogram(r.to_numpy(), bins=bins)
    return {"edges": [float(e) for e in edges], "counts": [int(c) for c in counts]}


def calendar_returns(prices: pd.Series) -> list[dict]:
    """Rendement de chaque année civile (dernier cours de l'année / dernier cours de l'année précédente - 1)."""
    p = to_daily_index(prices.dropna())
    yearly = p.groupby(p.index.year).last()
    first = p.iloc[0]
    out = []
    prev = None
    for year, last in yearly.items():
        base = prev if prev is not None else first
        # la première année part du premier cours disponible : elle est donc partielle
        out.append({"year": int(year), "return": _f(last / base - 1), "partial": prev is None})
        prev = last
    if out:
        last_date = p.index[-1]
        if not (last_date.month == 12 and last_date.day >= 24):
            out[-1]["partial"] = True
    return out
