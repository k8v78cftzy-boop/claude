"""Indicateurs d'analyse technique (définitions standard).

Toutes les fonctions reçoivent des pandas.Series alignées sur le même index
et renvoient des Series (ou des tuples de Series) de même index.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def sma(close: pd.Series, n: int) -> pd.Series:
    """Moyenne mobile simple : SMA_t = (1/n) * somme des n dernières clôtures."""
    return close.rolling(n, min_periods=n).mean()


def ema(close: pd.Series, n: int) -> pd.Series:
    """Moyenne mobile exponentielle : EMA_t = a*P_t + (1-a)*EMA_{t-1}, a = 2/(n+1).

    Initialisée sur la moyenne simple des n premières valeurs (convention usuelle).
    """
    values = close.to_numpy(dtype=float)
    out = np.full(len(values), np.nan)
    alpha = 2.0 / (n + 1)
    valid = np.where(~np.isnan(values))[0]
    if len(valid) < n:
        return pd.Series(out, index=close.index)
    start = valid[0]
    seed_end = start + n - 1
    if np.isnan(values[start:seed_end + 1]).any():
        return pd.Series(out, index=close.index)
    out[seed_end] = values[start:seed_end + 1].mean()
    for i in range(seed_end + 1, len(values)):
        v = values[i]
        out[i] = out[i - 1] if np.isnan(v) else alpha * v + (1 - alpha) * out[i - 1]
    return pd.Series(out, index=close.index)


def _wilder(values: np.ndarray, n: int, first_index: int) -> np.ndarray:
    """Lissage de Wilder : première valeur = moyenne simple de n valeurs,
    puis S_t = (S_{t-1}*(n-1) + x_t) / n."""
    out = np.full(len(values), np.nan)
    end = first_index + n
    if end > len(values):
        return out
    out[end - 1] = values[first_index:end].mean()
    for i in range(end, len(values)):
        out[i] = (out[i - 1] * (n - 1) + values[i]) / n
    return out


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    """RSI de Wilder : RSI = 100 - 100/(1+RS), RS = moyenne des hausses / moyenne des baisses."""
    delta = close.diff().to_numpy(dtype=float)
    gains = np.where(delta > 0, delta, 0.0)
    losses = np.where(delta < 0, -delta, 0.0)
    avg_gain = _wilder(gains, n, 1)
    avg_loss = _wilder(losses, n, 1)
    with np.errstate(divide="ignore", invalid="ignore"):
        rs = avg_gain / avg_loss
        out = 100 - 100 / (1 + rs)
    out = np.where((avg_loss == 0) & ~np.isnan(avg_gain), 100.0, out)
    out = np.where((avg_loss == 0) & (avg_gain == 0), 50.0, out)
    return pd.Series(out, index=close.index)


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    """MACD = EMA(fast) - EMA(slow) ; signal = EMA(signal) du MACD ; histogramme = MACD - signal."""
    line = ema(close, fast) - ema(close, slow)
    sig = ema(line, signal)
    return line, sig, line - sig


def bollinger(close: pd.Series, n: int = 20, k: float = 2.0):
    """Bandes de Bollinger : SMA(n) ± k * écart-type (population) sur n périodes."""
    mid = sma(close, n)
    std = close.rolling(n, min_periods=n).std(ddof=0)
    upper = mid + k * std
    lower = mid - k * std
    pct_b = (close - lower) / (upper - lower)
    bandwidth = (upper - lower) / mid
    return upper, mid, lower, pct_b, bandwidth


def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    """TR = max(H - L, |H - C_{t-1}|, |L - C_{t-1}|)."""
    prev = close.shift(1)
    tr = pd.concat([high - low, (high - prev).abs(), (low - prev).abs()], axis=1).max(axis=1)
    tr.iloc[0] = high.iloc[0] - low.iloc[0]
    return tr


def atr(high, low, close, n: int = 14) -> pd.Series:
    """ATR de Wilder : moyenne lissée (Wilder) du True Range."""
    tr = true_range(high, low, close).to_numpy(dtype=float)
    return pd.Series(_wilder(tr, n, 1), index=close.index)


def stochastic(high, low, close, n: int = 14, d: int = 3):
    """%K = 100*(C - plus bas n)/(plus haut n - plus bas n) ; %D = SMA(d) de %K."""
    hh = high.rolling(n, min_periods=n).max()
    ll = low.rolling(n, min_periods=n).min()
    k = 100 * (close - ll) / (hh - ll)
    return k, k.rolling(d, min_periods=d).mean()


def williams_r(high, low, close, n: int = 14) -> pd.Series:
    """%R = -100*(plus haut n - C)/(plus haut n - plus bas n)."""
    hh = high.rolling(n, min_periods=n).max()
    ll = low.rolling(n, min_periods=n).min()
    return -100 * (hh - close) / (hh - ll)


def cci(high, low, close, n: int = 20) -> pd.Series:
    """CCI = (TP - SMA(TP)) / (0,015 * écart absolu moyen), TP = (H+L+C)/3."""
    tp = (high + low + close) / 3
    ma = tp.rolling(n, min_periods=n).mean()
    md = tp.rolling(n, min_periods=n).apply(lambda x: np.mean(np.abs(x - x.mean())), raw=True)
    return (tp - ma) / (0.015 * md)


def obv(close, volume) -> pd.Series:
    """On-Balance Volume : OBV_t = OBV_{t-1} + signe(C_t - C_{t-1}) * V_t."""
    direction = np.sign(close.diff()).fillna(0)
    return (direction * volume).cumsum()


def roc(close, n: int = 12) -> pd.Series:
    """Rate of Change = 100 * (C_t / C_{t-n} - 1)."""
    return 100 * (close / close.shift(n) - 1)


def mfi(high, low, close, volume, n: int = 14) -> pd.Series:
    """Money Flow Index = 100 - 100/(1 + flux positifs n / flux négatifs n), flux = TP*V."""
    tp = (high + low + close) / 3
    flow = tp * volume
    diff = tp.diff()
    pos = flow.where(diff > 0, 0.0).rolling(n, min_periods=n).sum()
    neg = flow.where(diff < 0, 0.0).rolling(n, min_periods=n).sum()
    pos.iloc[:n] = np.nan
    neg.iloc[:n] = np.nan
    with np.errstate(divide="ignore", invalid="ignore"):
        out = 100 - 100 / (1 + pos / neg)
    return out.where(neg != 0, 100.0).where(pos.notna())


def adx(high, low, close, n: int = 14):
    """ADX de Wilder, avec +DI et -DI.

    +DM = H_t - H_{t-1} si > (L_{t-1} - L_t) et > 0, sinon 0 ; -DM symétrique.
    +DI = 100 * lissage(+DM)/lissage(TR) ; DX = 100*|+DI - -DI|/(+DI + -DI) ; ADX = lissage de Wilder de DX.
    """
    up = high.diff().to_numpy(dtype=float)
    down = (-low.diff()).to_numpy(dtype=float)
    plus_dm = np.where((up > down) & (up > 0), up, 0.0)
    minus_dm = np.where((down > up) & (down > 0), down, 0.0)
    tr = true_range(high, low, close).to_numpy(dtype=float)
    s_tr = _wilder(tr, n, 1)
    s_p = _wilder(plus_dm, n, 1)
    s_m = _wilder(minus_dm, n, 1)
    with np.errstate(divide="ignore", invalid="ignore"):
        pdi = 100 * s_p / s_tr
        mdi = 100 * s_m / s_tr
        dx = 100 * np.abs(pdi - mdi) / (pdi + mdi)
    dx = np.where((pdi + mdi) == 0, 0.0, dx)
    first = n  # premier DX disponible (index n)
    adx_arr = np.full(len(dx), np.nan)
    if len(dx) >= first + n:
        adx_arr = _wilder(np.nan_to_num(dx, nan=0.0), n, first)
        adx_arr[: first + n - 1] = np.nan
    idx = close.index
    return pd.Series(adx_arr, index=idx), pd.Series(pdi, index=idx), pd.Series(mdi, index=idx)


def rolling_vwap(high, low, close, volume, n: int = 20) -> pd.Series:
    """VWAP glissant sur n séances : somme(TP*V)/somme(V), TP = (H+L+C)/3."""
    tp = (high + low + close) / 3
    return (tp * volume).rolling(n, min_periods=n).sum() / volume.rolling(n, min_periods=n).sum()


def pivot_points(high: float, low: float, close: float) -> dict:
    """Points pivots classiques calculés sur la dernière séance."""
    p = (high + low + close) / 3
    return {
        "P": p,
        "R1": 2 * p - low, "S1": 2 * p - high,
        "R2": p + (high - low), "S2": p - (high - low),
        "R3": high + 2 * (p - low), "S3": low - 2 * (high - p),
    }


def fibonacci_levels(high: float, low: float) -> dict:
    """Retracements de Fibonacci entre le plus haut et le plus bas de la période."""
    rng = high - low
    return {f"{int(r * 1000) / 10:g} %": high - r * rng for r in (0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0)}
