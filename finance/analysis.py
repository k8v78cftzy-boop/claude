"""Assemble l'analyse complète d'une action à partir des données Yahoo Finance."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from . import data, fundamentals as fu, risk, technical as ta

PERIODS = {"6mo": 182, "1y": 365, "3y": 3 * 365, "5y": 5 * 365, "10y": 10 * 365}


def _f(x, nd=None):
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x):
        return None
    return round(x, nd) if nd is not None else x


def _series_list(s: pd.Series, nd=4):
    return [None if (v is None or not np.isfinite(v)) else round(float(v), nd) for v in s.to_numpy(dtype=float)]


def _times(index) -> list:
    idx = pd.DatetimeIndex(index)
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    return [d.strftime("%Y-%m-%d") for d in idx]


def slice_period(df: pd.DataFrame | pd.Series, period: str):
    if period == "max" or period not in PERIODS:
        return df
    end = df.index[-1]
    return df[df.index >= end - pd.Timedelta(days=PERIODS[period])]


# ---------------------------------------------------------------------------
# Cotation et unités
# ---------------------------------------------------------------------------


def quote_block(symbol: str, inf: dict, hist: pd.DataFrame) -> dict:
    raw_ccy = inf.get("currency")
    ccy, factor = data.major_currency(raw_ccy)
    price_raw = inf.get("currentPrice") or inf.get("regularMarketPrice")
    if price_raw is None and not hist.empty:
        price_raw = float(hist["Close"].iloc[-1])
    prev = inf.get("regularMarketPreviousClose") or inf.get("previousClose")
    if prev is None and len(hist) >= 2:
        prev = float(hist["Close"].iloc[-2])
    year = hist[hist.index >= hist.index[-1] - pd.Timedelta(days=365)] if not hist.empty else hist
    shares_out = inf.get("sharesOutstanding") or inf.get("impliedSharesOutstanding")
    mcap = inf.get("marketCap")
    # capitalisation dans la devise principale (et non en pence) : contrôle de cohérence avec cours × actions
    if mcap and factor > 1 and price_raw and shares_out:
        if mcap / (price_raw * shares_out) > 0.1:
            mcap = mcap / factor
    if not mcap and price_raw and shares_out:
        mcap = price_raw * shares_out / factor
    price = price_raw / factor if price_raw is not None else None
    return {
        "symbol": symbol,
        "name": inf.get("longName") or inf.get("shortName") or symbol,
        "exchange": inf.get("fullExchangeName") or inf.get("exchange"),
        "quote_type": inf.get("quoteType"),
        "currency": ccy,
        "currency_raw": raw_ccy,
        "subunit_factor": factor,
        "financial_currency": inf.get("financialCurrency") or ccy,
        "price_raw": _f(price_raw),
        "price": _f(price),
        "previous_close_raw": _f(prev),
        "change_raw": _f(price_raw - prev) if (price_raw is not None and prev) else None,
        "change_pct": _f(price_raw / prev - 1) if (price_raw is not None and prev) else None,
        "open_raw": _f(inf.get("regularMarketOpen") or inf.get("open")),
        "day_high_raw": _f(inf.get("regularMarketDayHigh") or inf.get("dayHigh")),
        "day_low_raw": _f(inf.get("regularMarketDayLow") or inf.get("dayLow")),
        "high_52w_raw": _f(year["High"].max()) if not year.empty else None,
        "low_52w_raw": _f(year["Low"].min()) if not year.empty else None,
        "volume": _f(inf.get("regularMarketVolume") or inf.get("volume")),
        "avg_volume_3m": _f(inf.get("averageVolume")),
        "market_cap": _f(mcap),
        "shares_outstanding": _f(shares_out),
        "sector": inf.get("sector"),
        "industry": inf.get("industry"),
        "country": inf.get("country"),
        "website": inf.get("website"),
        "employees": inf.get("fullTimeEmployees"),
        "summary": inf.get("longBusinessSummary"),
        "yahoo": {
            "beta": _f(inf.get("beta")),
            "forward_pe": _f(inf.get("forwardPE")),
            "target_mean_raw": _f(inf.get("targetMeanPrice")),
            "target_high_raw": _f(inf.get("targetHighPrice")),
            "target_low_raw": _f(inf.get("targetLowPrice")),
            "recommendation": inf.get("recommendationKey"),
            "analysts": inf.get("numberOfAnalystOpinions"),
        },
    }


# ---------------------------------------------------------------------------
# Graphique et indicateurs techniques
# ---------------------------------------------------------------------------


def chart_block(hist: pd.DataFrame) -> dict:
    h, l, c, v = hist["High"], hist["Low"], hist["Close"], hist["Volume"].fillna(0)
    m_line, m_sig, m_hist = ta.macd(c)
    bb_u, bb_m, bb_l, bb_pb, bb_bw = ta.bollinger(c)
    st_k, st_d = ta.stochastic(h, l, c)
    adx, pdi, mdi = ta.adx(h, l, c)
    return {
        "time": _times(hist.index),
        "open": _series_list(hist["Open"]), "high": _series_list(h), "low": _series_list(l),
        "close": _series_list(c), "adj_close": _series_list(hist["Adj Close"]), "volume": _series_list(v, 0),
        "ind": {
            "sma20": _series_list(ta.sma(c, 20)), "sma50": _series_list(ta.sma(c, 50)),
            "sma200": _series_list(ta.sma(c, 200)), "ema12": _series_list(ta.ema(c, 12)),
            "ema26": _series_list(ta.ema(c, 26)),
            "bb_upper": _series_list(bb_u), "bb_mid": _series_list(bb_m), "bb_lower": _series_list(bb_l),
            "vwap20": _series_list(ta.rolling_vwap(h, l, c, v)),
            "rsi": _series_list(ta.rsi(c), 2), "macd": _series_list(m_line), "macd_signal": _series_list(m_sig),
            "macd_hist": _series_list(m_hist), "stoch_k": _series_list(st_k, 2), "stoch_d": _series_list(st_d, 2),
            "atr": _series_list(ta.atr(h, l, c)), "obv": _series_list(ta.obv(c, v), 0),
            "adx": _series_list(adx, 2), "plus_di": _series_list(pdi, 2), "minus_di": _series_list(mdi, 2),
            "cci": _series_list(ta.cci(h, l, c), 2), "williams_r": _series_list(ta.williams_r(h, l, c), 2),
            "mfi": _series_list(ta.mfi(h, l, c, v), 2), "roc": _series_list(ta.roc(c), 2),
        },
    }


def technical_summary(hist: pd.DataFrame) -> dict:
    """Dernières valeurs des indicateurs et signaux simples."""
    h, l, c, v = hist["High"], hist["Low"], hist["Close"], hist["Volume"].fillna(0)
    last = float(c.iloc[-1])

    def lv(s):
        s = s.dropna()
        return _f(s.iloc[-1]) if len(s) else None

    sma50, sma200 = ta.sma(c, 50), ta.sma(c, 200)
    cross = None
    both = pd.concat([sma50, sma200], axis=1).dropna()
    if len(both) >= 2:
        diff = np.sign(both.iloc[:, 0] - both.iloc[:, 1])
        changes = diff[diff.diff().fillna(0) != 0]
        if len(changes):
            d = changes.index[-1]
            cross = {"type": "golden cross" if changes.iloc[-1] > 0 else "death cross",
                     "date": _times([d])[0]}
    m_line, m_sig, m_hist = ta.macd(c)
    bb_u, bb_m, bb_l, bb_pb, bb_bw = ta.bollinger(c)
    st_k, st_d = ta.stochastic(h, l, c)
    adx, pdi, mdi = ta.adx(h, l, c)
    year = hist[hist.index >= hist.index[-1] - pd.Timedelta(days=365)]
    rsi_v = lv(ta.rsi(c))
    return {
        "last": last,
        "sma20": lv(ta.sma(c, 20)), "sma50": lv(sma50), "sma200": lv(sma200),
        "ema12": lv(ta.ema(c, 12)), "ema26": lv(ta.ema(c, 26)),
        "price_vs_sma50": _f(last / lv(sma50) - 1) if lv(sma50) else None,
        "price_vs_sma200": _f(last / lv(sma200) - 1) if lv(sma200) else None,
        "last_cross": cross,
        "rsi": rsi_v,
        "rsi_signal": None if rsi_v is None else ("surachat" if rsi_v > 70 else "survente" if rsi_v < 30 else "neutre"),
        "macd": lv(m_line), "macd_signal": lv(m_sig), "macd_hist": lv(m_hist),
        "bb_upper": lv(bb_u), "bb_lower": lv(bb_l), "bb_percent_b": lv(bb_pb), "bb_bandwidth": lv(bb_bw),
        "stoch_k": lv(st_k), "stoch_d": lv(st_d), "williams_r": lv(ta.williams_r(h, l, c)),
        "cci": lv(ta.cci(h, l, c)), "atr": lv(ta.atr(h, l, c)),
        "atr_pct": _f(lv(ta.atr(h, l, c)) / last) if lv(ta.atr(h, l, c)) else None,
        "adx": lv(adx), "plus_di": lv(pdi), "minus_di": lv(mdi), "mfi": lv(ta.mfi(h, l, c, v)),
        "roc12": lv(ta.roc(c)), "obv": lv(ta.obv(c, v)), "vwap20": lv(ta.rolling_vwap(h, l, c, v)),
        "pivots": {k: _f(x) for k, x in ta.pivot_points(float(h.iloc[-1]), float(l.iloc[-1]), last).items()},
        "fibonacci_52w": {k: _f(x) for k, x in ta.fibonacci_levels(float(year["High"].max()),
                                                                   float(year["Low"].min())).items()},
    }


# ---------------------------------------------------------------------------
# Valorisation de marché
# ---------------------------------------------------------------------------


def valuation_block(q: dict, ttm: dict | None, basis: str, fy: dict, cagr: dict, fx: float | None,
                    div_ps_raw: float | None) -> dict:
    """Multiples de valorisation. ``ttm`` : postes des 12 derniers mois (ou dernier exercice)."""
    mcap = q["market_cap"]
    price = q["price"]
    v = ttm or {}
    out = {"basis": basis, "fx": fx, "available": bool(mcap and fx and v)}
    if not out["available"]:
        return out

    def m(x):  # montant converti dans la devise de cotation (devise principale)
        x = fu._num(x)
        return None if x is None else x * fx

    debt = v.get("debt")
    if debt is None and v.get("total_assets") is not None:
        debt = 0.0
    cash = v.get("cash_sti") or 0.0
    ev = fu.add(mcap, m(debt), -(m(cash) or 0.0), m(v.get("minority") or 0.0), m(v.get("preferred") or 0.0))
    shares_eq = mcap / price if price else None  # nombre d'actions « équivalent cotation » (ADR inclus)

    def pos(x):
        x = fu._num(x)
        return x if (x is not None and x > 0) else None

    ni = m(v.get("ni_common"))
    eps = fu.div(ni, shares_eq)
    bvps = fu.div(m(v.get("equity")), shares_eq)
    pe = fu.div(mcap, pos(ni))
    eps_cagr = cagr.get("eps")
    graham = math.sqrt(22.5 * eps * bvps) if (eps and bvps and eps > 0 and bvps > 0) else None
    dy = fu.div(div_ps_raw, q["price_raw"]) if div_ps_raw else (0.0 if div_ps_raw == 0 else None)
    out.update({
        "market_cap": mcap,
        "enterprise_value": ev,
        "shares_equivalent": shares_eq,
        "eps": eps,
        "bvps": bvps,
        "fcf_per_share": fu.div(m(v.get("fcf")), shares_eq),
        "sales_per_share": fu.div(m(v.get("revenue")), shares_eq),
        "pe": pe,
        "earnings_yield": fu.div(ni, mcap),
        "forward_pe_yahoo": q["yahoo"]["forward_pe"],
        "peg": fu.div(pe, eps_cagr * 100) if (pe and eps_cagr and eps_cagr > 0) else None,
        "pb": fu.div(mcap, pos(m(v.get("equity")))),
        "ptbv": fu.div(mcap, pos(m(v.get("tangible_bv")))),
        "ps": fu.div(mcap, pos(m(v.get("revenue")))),
        "pfcf": fu.div(mcap, pos(m(v.get("fcf")))),
        "pocf": fu.div(mcap, pos(m(v.get("ocf")))),
        "ev_ebitda": fu.div(ev, pos(m(v.get("ebitda")))),
        "ev_ebit": fu.div(ev, pos(m(v.get("ebit")))),
        "ev_sales": fu.div(ev, pos(m(v.get("revenue")))),
        "ev_fcf": fu.div(ev, pos(m(v.get("fcf")))),
        "fcf_yield": fu.div(m(v.get("fcf")), mcap),
        "dividend_yield": dy,
        "dividend_per_share": fu.div(div_ps_raw, q["subunit_factor"]) if div_ps_raw is not None else None,
        "shareholder_yield": fu.div(m(fu.add(v.get("dividends") or 0.0, v.get("buybacks") or 0.0)), mcap),
        "graham_number": graham,
        "graham_upside": fu.div(graham, price) - 1 if (graham and price) else None,
        "tobin_q": fu.div(fu.add(mcap, m(v.get("total_liabilities"))), m(v.get("total_assets"))),
        "altman_z": fu.altman_z(v, mcap / fx),
    })
    return out


def dcf_inputs(q: dict, ttm: dict | None, fy: dict, cagr: dict, fx: float | None, beta_m: float | None,
               rf: dict, div_ps_raw: float | None, roe: float | None, payout: float | None) -> dict:
    """Données pré-remplies pour les modèles WACC / DCF / DDM / EVA (calculés et modifiables côté client)."""
    v = ttm or {}
    fx = fx or None

    def m(x):
        x = fu._num(x)
        return None if (x is None or fx is None) else x * fx

    debt = v.get("debt") if v.get("debt") is not None else (0.0 if v.get("total_assets") is not None else None)
    kd = fu.div(fy.get("interest"), fy.get("debt")) if (fy.get("debt") or 0) > 0 else None
    g_hist = cagr.get("revenue")
    return {
        "currency": q["currency"],
        "price": q["price"],
        "market_cap": q["market_cap"],
        "shares": fu.div(q["market_cap"], q["price"]),
        "rf": rf.get("value"),
        "rf_source": rf.get("source"),
        "beta_monthly_5y": beta_m,
        "beta_yahoo": q["yahoo"]["beta"],
        "tax_rate": v.get("tax_rate") if v.get("tax_rate") is not None else fy.get("tax_rate"),
        "cost_of_debt": kd,
        "debt": m(debt),
        "cash": m(v.get("cash_sti") or 0.0),
        "minority": m(v.get("minority") or 0.0),
        "fcff": m(v.get("fcff")),
        "fcf": m(v.get("fcf")),
        "ebit": m(v.get("ebit")),
        "nopat": m(v.get("nopat")),
        "invested_capital": m(v.get("invested_capital")),
        "revenue": m(v.get("revenue")),
        "revenue_cagr": g_hist,
        "dividend_per_share": fu.div(div_ps_raw, q["subunit_factor"]) if div_ps_raw is not None else None,
        "roe": roe,
        "payout": payout,
    }


def ttm_dividend_raw(divs: pd.Series) -> float | None:
    """Somme des dividendes détachés sur les 365 derniers jours (unité de cotation)."""
    if divs is None or divs.empty:
        return 0.0
    idx = pd.DatetimeIndex(divs.index)
    if idx.tz is not None:
        idx = idx.tz_convert(None)
    s = pd.Series(divs.to_numpy(dtype=float), index=idx)
    cutoff = pd.Timestamp.now() - pd.Timedelta(days=365)
    return float(s[s.index > cutoff].sum())


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------


def analyze(symbol: str) -> dict:
    symbol = symbol.strip().upper()
    hist = data.history(symbol, "max", "1d")
    if hist.empty:
        raise LookupError(f"Aucune donnée de cours pour « {symbol} ».")
    inf = data.info(symbol)
    q = quote_block(symbol, inf, hist)
    st = data.statements(symbol)

    annual = fu.Statements(st["income"], st["balance"], st["cashflow"])
    fund = fu.analyze_statements(annual)
    fy = fund["items"][0] if fund["items"] else {}

    ttm_items, basis = None, None
    if not st["income_ttm"].empty:
        ttm_s = fu.Statements(st["income_ttm"], st["balance_q"] if not st["balance_q"].empty else st["balance"],
                              st["cashflow_ttm"] if not st["cashflow_ttm"].empty else st["cashflow"])
        if ttm_s.n():
            ttm_items = fu.base_items(ttm_s, 0)
            basis = "12 derniers mois (TTM) — bilan du dernier trimestre publié"
            # repli sur le dernier exercice pour les flux de trésorerie absents en TTM
            if st["cashflow_ttm"].empty or ttm_items.get("ocf") is None:
                for k in ("ocf", "capex", "fcf", "fcff", "fcfe", "dividends", "buybacks"):
                    ttm_items[k] = fy.get(k)
                if fund["years"]:
                    basis += f" ; flux de trésorerie du dernier exercice ({fund['years'][0]})"
    if ttm_items is None and fy:
        ttm_items, basis = fy, f"Dernier exercice publié ({fund['years'][0]})"

    fin_ccy = q["financial_currency"]
    fin_major, fin_factor = data.major_currency(fin_ccy)
    fx = data.fx_rate(fin_major, q["currency"]) if (fin_major and q["currency"]) else None
    if fx is not None and fin_factor > 1:
        fx = fx / fin_factor

    divs = data.dividends(symbol)
    div_raw = ttm_dividend_raw(divs)
    # garde-fou devises en sous-unités (pence…) : si les dividendes Yahoo sont en devise principale
    # alors que le cours est en sous-unité, le rendement apparaît ~100 fois trop faible par rapport
    # aux dividendes versés du tableau de flux rapportés à la capitalisation.
    factor = q["subunit_factor"]
    if div_raw and factor > 1 and q["price_raw"] and fx and q["market_cap"] and fy.get("dividends"):
        expected = fy["dividends"] * fx / q["market_cap"]
        computed = div_raw / q["price_raw"]
        if computed > 0 and 0.3 * factor < expected / computed < 3 * factor:
            div_raw = div_raw * factor

    val = valuation_block(q, ttm_items, basis, fy, fund["cagr"], fx, div_raw)

    rf = data.risk_free_rate()
    bench_symbol = data.default_benchmark(symbol)
    bench = data.history(bench_symbol, "max", "1d")
    adj = hist["Adj Close"]
    beta_m = None
    if not bench.empty:
        beta_m = risk.monthly_beta(slice_period(adj, "5y"), slice_period(bench["Adj Close"], "5y"))

    roe_row = next(r for g in fund["groups"] if g["key"] == "profitability" for r in g["rows"] if r["key"] == "roe")
    pay_row = next(r for g in fund["groups"] if g["key"] == "cashflow" for r in g["rows"] if r["key"] == "payout_ratio")
    dcf = dcf_inputs(q, ttm_items, fy, fund["cagr"], fx, beta_m, rf, div_raw,
                     roe_row["values"][0] if roe_row["values"] else None,
                     pay_row["values"][0] if pay_row["values"] else None)

    fund_public = {k: v for k, v in fund.items() if k != "items"}
    return {
        "quote": q,
        "chart": chart_block(hist),
        "technical": technical_summary(hist),
        "fundamentals": fund_public,
        "valuation": val,
        "dcf": dcf,
        "benchmark": bench_symbol,
        "risk_free": rf,
        "statements": {
            "income": fu.statements_table(st["income"]),
            "balance": fu.statements_table(st["balance"]),
            "cashflow": fu.statements_table(st["cashflow"]),
            "income_q": fu.statements_table(st["income_q"]),
            "balance_q": fu.statements_table(st["balance_q"]),
            "cashflow_q": fu.statements_table(st["cashflow_q"]),
        },
        "dividends": [{"date": d, "amount": _f(a)} for d, a in zip(_times(divs.index), divs.tolist())][-40:]
        if not divs.empty else [],
    }


def risk_report(symbol: str, period: str, benchmark: str | None, rf_override: float | None) -> dict:
    symbol = symbol.strip().upper()
    hist = data.history(symbol, "max", "1d")
    if hist.empty:
        raise LookupError(f"Aucune donnée de cours pour « {symbol} ».")
    bench_symbol = (benchmark or data.default_benchmark(symbol)).strip().upper()
    bench = data.history(bench_symbol, "max", "1d")
    rf = rf_override if rf_override is not None else (data.risk_free_rate().get("value") or 0.0)
    p = slice_period(hist["Adj Close"], period)
    out = {"period": period, "benchmark": bench_symbol, "rf": rf, "stats": risk.return_stats(p, rf)}
    if not bench.empty:
        b = slice_period(bench["Adj Close"], period)
        out["relative"] = risk.relative_stats(p, b, rf)
        out["benchmark_stats"] = risk.return_stats(b, rf)
        # base 100 alignée pour le graphique comparatif
        pi, bi = risk.to_daily_index(p), risk.to_daily_index(b)
        df = pd.concat([pi.rename("s"), bi.rename("m")], axis=1, join="inner").dropna()
        if len(df):
            out["base100"] = {"time": [d.strftime("%Y-%m-%d") for d in df.index],
                              "stock": _series_list(df["s"] / df["s"].iloc[0] * 100, 3),
                              "bench": _series_list(df["m"] / df["m"].iloc[0] * 100, 3)}
    dd = risk.drawdown_series(p)
    out["drawdown"] = {"time": _times(dd.index), "value": _series_list(dd, 5)}
    out["histogram"] = risk.return_histogram(p)
    out["calendar"] = risk.calendar_returns(hist["Adj Close"])
    # volatilité glissante 21 séances annualisée
    rv = risk.returns(p).rolling(21).std() * math.sqrt(risk.TRADING_DAYS)
    out["rolling_vol"] = {"time": _times(rv.index), "value": _series_list(rv, 5)}
    return out


def compare(symbols: list[str], period: str) -> dict:
    rows, series = [], {}
    rf = data.risk_free_rate().get("value") or 0.0
    for sym in symbols:
        try:
            a = analyze(sym)
        except Exception as e:  # une valeur introuvable ne bloque pas les autres
            rows.append({"symbol": sym.upper(), "error": str(e)})
            continue
        adj = data.history(sym.strip().upper(), "max", "1d")["Adj Close"]
        p = slice_period(adj, period)
        stats = risk.return_stats(p, rf)
        prof = {r["key"]: r["values"][0] if r["values"] else None
                for g in a["fundamentals"]["groups"] for r in g["rows"]}
        v = a["valuation"]
        rows.append({
            "symbol": a["quote"]["symbol"], "name": a["quote"]["name"], "currency": a["quote"]["currency"],
            "price": a["quote"]["price"], "change_pct": a["quote"]["change_pct"],
            "market_cap": a["quote"]["market_cap"],
            "pe": v.get("pe"), "pb": v.get("pb"), "ps": v.get("ps"), "ev_ebitda": v.get("ev_ebitda"),
            "fcf_yield": v.get("fcf_yield"), "dividend_yield": v.get("dividend_yield"),
            "gross_margin": prof.get("gross_margin"), "operating_margin": prof.get("operating_margin"),
            "net_margin": prof.get("net_margin"), "roe": prof.get("roe"), "roic": prof.get("roic"),
            "debt_to_equity": prof.get("debt_to_equity"), "current_ratio": prof.get("current_ratio"),
            "revenue_growth": prof.get("revenue_growth"),
            "total_return": stats.get("total_return"), "cagr": stats.get("cagr"),
            "volatility": stats.get("volatility_ann"), "sharpe": stats.get("sharpe"),
            "max_drawdown": stats.get("max_drawdown"),
        })
        pi = risk.to_daily_index(p)
        series[a["quote"]["symbol"]] = pi
    base = {}
    if series:
        df = pd.concat(series, axis=1, join="inner").dropna()
        if len(df):
            base = {"time": [d.strftime("%Y-%m-%d") for d in df.index],
                    "series": {k: _series_list(df[k] / df[k].iloc[0] * 100, 3) for k in df.columns}}
    return {"rows": rows, "base100": base, "period": period, "rf": rf}
