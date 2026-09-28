import math

import numpy as np
import pandas as pd
import pytest

from finance import risk, technical as ta
from tests.fixtures import price_history

# Exemple de référence du RSI (StockCharts / Wilder) : premier RSI(14) = 70,53
RSI_CLOSES = [44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826,
              45.8931, 46.0328, 45.6140, 46.2820, 46.2820, 46.0028, 46.0328, 46.4116, 46.2222, 45.6439]


def naive_rsi(closes, n=14):
    d = np.diff(closes)
    g = np.where(d > 0, d, 0.0)
    l_ = np.where(d < 0, -d, 0.0)
    ag, al = g[:n].mean(), l_[:n].mean()
    out = [100 - 100 / (1 + ag / al)]
    for i in range(n, len(d)):
        ag = (ag * (n - 1) + g[i]) / n
        al = (al * (n - 1) + l_[i]) / n
        out.append(100 - 100 / (1 + ag / al))
    return out


def test_rsi_reference_value():
    r = ta.rsi(pd.Series(RSI_CLOSES))
    assert r.iloc[:14].isna().all()
    assert round(r.iloc[14], 2) == 70.53
    np.testing.assert_allclose(r.iloc[14:].to_numpy(), naive_rsi(RSI_CLOSES), rtol=1e-12)


def test_sma_ema():
    s = pd.Series([1.0, 2, 3, 4, 5, 6])
    assert ta.sma(s, 3).tolist()[2:] == [2.0, 3.0, 4.0, 5.0]
    e = ta.ema(s, 3)  # alpha = 0,5 ; amorce = moyenne(1,2,3) = 2
    assert math.isnan(e.iloc[1])
    assert e.iloc[2] == 2.0
    assert e.iloc[3] == pytest.approx(0.5 * 4 + 0.5 * 2)
    assert e.iloc[4] == pytest.approx(0.5 * 5 + 0.5 * 3)


def test_macd_is_difference_of_emas():
    c = price_history()["Close"]
    line, sig, hist = ta.macd(c)
    np.testing.assert_allclose((ta.ema(c, 12) - ta.ema(c, 26)).dropna(), line.dropna())
    np.testing.assert_allclose((line - sig).dropna(), hist.dropna())


def test_bollinger_population_std():
    s = pd.Series(np.arange(1.0, 21.0))
    up, mid, lo, pb, bw = ta.bollinger(s, 20, 2)
    std = np.std(np.arange(1.0, 21.0))  # ddof = 0
    assert mid.iloc[-1] == pytest.approx(10.5)
    assert up.iloc[-1] == pytest.approx(10.5 + 2 * std)
    assert lo.iloc[-1] == pytest.approx(10.5 - 2 * std)
    assert pb.iloc[-1] == pytest.approx((20 - lo.iloc[-1]) / (4 * std))


def test_stochastic_williams():
    h = pd.Series([10.0, 11, 12, 13])
    l_ = pd.Series([8.0, 9, 10, 11])
    c = pd.Series([9.0, 10, 11, 12.5])
    k, d = ta.stochastic(h, l_, c, n=3, d=2)
    assert k.iloc[2] == pytest.approx(100 * (11 - 8) / (12 - 8))
    assert k.iloc[3] == pytest.approx(100 * (12.5 - 9) / (13 - 9))
    assert d.iloc[3] == pytest.approx((k.iloc[2] + k.iloc[3]) / 2)
    assert ta.williams_r(h, l_, c, 3).iloc[3] == pytest.approx(-100 * (13 - 12.5) / (13 - 9))


def test_true_range_and_atr():
    h = pd.Series([10.0, 12, 11])
    l_ = pd.Series([9.0, 10, 8])
    c = pd.Series([9.5, 11, 9])
    tr = ta.true_range(h, l_, c)
    assert tr.tolist() == [1.0, 2.5, 3.0]
    atr = ta.atr(h, l_, c, n=2)
    assert atr.iloc[2] == pytest.approx((2.5 + 3.0) / 2)


def test_obv_roc_cci():
    c = pd.Series([10.0, 11, 10.5, 10.5, 12])
    v = pd.Series([100.0, 200, 150, 120, 300])
    assert ta.obv(c, v).tolist() == [0, 200, 50, 50, 350]
    assert ta.roc(c, 2).iloc[4] == pytest.approx(100 * (12 / 10.5 - 1))
    h, l_ = c + 1, c - 1
    tp = (h + l_ + c) / 3
    window = tp.iloc[-3:]
    md = np.mean(np.abs(window - window.mean()))
    assert ta.cci(h, l_, c, 3).iloc[-1] == pytest.approx((tp.iloc[-1] - window.mean()) / (0.015 * md))


def test_adx_bounds_and_trend():
    idx = pd.RangeIndex(80)
    close = pd.Series(np.linspace(100, 180, 80), index=idx)
    adx, pdi, mdi = ta.adx(close + 1, close - 1, close)
    assert adx.iloc[:27].isna().all() and not math.isnan(adx.iloc[27])
    assert adx.iloc[-1] > 90  # tendance haussière parfaite
    assert pdi.iloc[-1] > mdi.iloc[-1]


def test_mfi_all_up_is_100():
    c = pd.Series(np.arange(1.0, 30.0))
    m = ta.mfi(c + 0.5, c - 0.5, c, pd.Series(np.full(29, 1000.0)))
    assert m.iloc[:14].isna().all()
    assert m.iloc[-1] == 100.0


def test_pivots_fibonacci():
    p = ta.pivot_points(12, 8, 10)
    assert p["P"] == 10 and p["R1"] == 12 and p["S1"] == 8 and p["R2"] == 14 and p["S2"] == 6
    f = ta.fibonacci_levels(200, 100)
    assert f["61.8 %"] == pytest.approx(138.2)
    assert f["0 %"] == 200 and f["100 %"] == 100


# ---------------------------------------------------------------------------
# Risque
# ---------------------------------------------------------------------------


def test_max_drawdown_and_calmar():
    idx = pd.to_datetime(["2020-01-01", "2020-06-01", "2021-01-01", "2021-06-01", "2022-01-01"])
    p = pd.Series([100.0, 120, 90, 130, 65], index=idx)
    s = risk.return_stats(p)
    assert s["max_drawdown"] == pytest.approx(65 / 130 - 1)
    assert s["total_return"] == pytest.approx(-0.35)
    years = (idx[-1] - idx[0]).days / 365.25
    assert s["cagr"] == pytest.approx(0.65 ** (1 / years) - 1)
    assert s["calmar"] == pytest.approx(s["cagr"] / 0.5)


def test_sharpe_sortino_volatility():
    p = price_history()["Adj Close"]
    rf = 0.03
    s = risk.return_stats(p, rf)
    r = p.pct_change().dropna().to_numpy()
    ex = r - rf / 252
    assert s["volatility_ann"] == pytest.approx(np.std(r, ddof=1) * math.sqrt(252))
    assert s["sharpe"] == pytest.approx(ex.mean() / np.std(ex, ddof=1) * math.sqrt(252))
    dd = math.sqrt(np.mean(np.minimum(ex, 0) ** 2)) * math.sqrt(252)
    assert s["sortino"] == pytest.approx(ex.mean() * 252 / dd)
    assert s["var95_hist"] == pytest.approx(-np.quantile(r, 0.05))
    assert s["var95_param"] == pytest.approx(-(r.mean() - 1.6448536269514722 * np.std(r, ddof=1)))
    q = np.quantile(r, 0.05)
    assert s["cvar95"] == pytest.approx(-r[r <= q].mean())
    assert s["omega"] == pytest.approx(np.maximum(ex, 0).sum() / np.maximum(-ex, 0).sum())


def test_beta_exact():
    m = price_history(seed=3)["Adj Close"]
    rm = m.pct_change()
    rs = 1.5 * rm
    s = (1 + rs.fillna(0)).cumprod() * 50
    rel = risk.relative_stats(s, m, rf=0.0)
    assert rel["beta"] == pytest.approx(1.5)
    assert rel["r_squared"] == pytest.approx(1.0)
    assert rel["alpha_jensen_ann"] == pytest.approx(0.0, abs=1e-12)
    assert rel["correlation"] == pytest.approx(1.0)


def test_beta_different_timezones_align_on_dates():
    a = price_history(seed=5, tz="Europe/Paris")["Adj Close"]
    b = price_history(seed=5, tz="America/New_York")["Adj Close"]
    rel = risk.relative_stats(a, b)
    assert rel["common_observations"] == len(a) - 1
    assert rel["beta"] == pytest.approx(1.0)


def test_monthly_beta():
    m = price_history(n=1300, seed=7)["Adj Close"]
    s = 50 * (1 + 2 * m.pct_change().fillna(0)).cumprod()
    b = risk.monthly_beta(s, m)
    assert b is not None and 1.9 < b < 2.1  # rendements mensuels composés : proche de 2


def test_calendar_returns():
    idx = pd.to_datetime(["2022-03-01", "2022-12-30", "2023-12-29", "2024-06-28"])
    p = pd.Series([100.0, 110, 121, 133.1], index=idx)
    cal = risk.calendar_returns(p)
    assert [c["year"] for c in cal] == [2022, 2023, 2024]
    assert cal[0]["return"] == pytest.approx(0.1) and cal[0]["partial"]
    assert cal[1]["return"] == pytest.approx(0.1) and not cal[1]["partial"]
    assert cal[2]["return"] == pytest.approx(0.1) and cal[2]["partial"]
