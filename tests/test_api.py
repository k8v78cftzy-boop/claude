"""Tests de bout en bout de l'API avec une couche de données simulée (pas d'accès réseau)."""
import json

import pandas as pd
import pytest

import app as webapp
from finance import data
from tests.fixtures import BALANCE, CASHFLOW, INCOME, frame, price_history

HIST = price_history(n=1500, seed=11)
BENCH = price_history(n=1500, seed=12)


def fake_history(symbol, period="max", interval="1d"):
    if symbol == "NODATA":
        return pd.DataFrame()
    df = BENCH if symbol.startswith("^") else HIST
    return df.iloc[-5:] if period == "5d" else df


def fake_info(symbol):
    # cotée en USD, comptes en EUR (cas d'un ADR) ; 100 actions à 50 USD
    return {"currency": "USD", "financialCurrency": "EUR", "currentPrice": 50.0, "previousClose": 49.0,
            "marketCap": 5000.0, "sharesOutstanding": 100.0, "longName": "Société Test", "quoteType": "EQUITY",
            "beta": 1.1, "forwardPE": 20.0}


def fake_statements(symbol):
    empty = pd.DataFrame()
    return {"income": frame(INCOME), "balance": frame(BALANCE), "cashflow": frame(CASHFLOW),
            "income_q": empty, "balance_q": empty, "cashflow_q": empty, "income_ttm": empty, "cashflow_ttm": empty}


@pytest.fixture()
def client(monkeypatch):
    data.clear_cache()
    monkeypatch.setattr(data, "history", fake_history)
    monkeypatch.setattr(data, "info", fake_info)
    monkeypatch.setattr(data, "statements", fake_statements)
    idx = pd.to_datetime([pd.Timestamp.now() - pd.Timedelta(days=200), pd.Timestamp.now() - pd.Timedelta(days=20),
                          pd.Timestamp.now() - pd.Timedelta(days=500)]).tz_localize("UTC")
    monkeypatch.setattr(data, "dividends", lambda s: pd.Series([0.5, 0.6, 0.4], index=idx))
    monkeypatch.setattr(data, "fx_rate", lambda a, b: 1.1 if (a, b) == ("EUR", "USD") else 1.0)
    monkeypatch.setattr(data, "risk_free_rate", lambda: {"value": 0.04, "source": "test"})
    monkeypatch.setattr(data, "news", lambda s: [])
    return webapp.app.test_client()


def test_stock_endpoint_valuation(client):
    r = client.get("/api/stock/test")
    assert r.status_code == 200
    d = r.get_json()
    json.dumps(d, allow_nan=False)  # JSON strict : aucun NaN/inf
    v = d["valuation"]
    fx = 1.1
    assert v["basis"].startswith("Dernier exercice")
    assert v["market_cap"] == 5000
    assert v["enterprise_value"] == pytest.approx(5000 + fx * (500 - 300))
    assert v["pe"] == pytest.approx(5000 / (142.5 * fx))
    assert v["eps"] == pytest.approx(142.5 * fx / 100)
    assert v["pb"] == pytest.approx(5000 / (1000 * fx))
    assert v["ps"] == pytest.approx(5000 / (1000 * fx))
    assert v["ev_ebitda"] == pytest.approx((5000 + fx * 200) / (260 * fx))
    assert v["fcf_yield"] == pytest.approx(150 * fx / 5000)
    assert v["dividend_yield"] == pytest.approx((0.5 + 0.6) / 50)
    assert v["graham_number"] == pytest.approx((22.5 * (142.5 * fx / 100) * (1000 * fx / 100)) ** 0.5)
    assert v["tobin_q"] == pytest.approx((5000 + 1000 * fx) / (2000 * fx))
    # Altman Z avec capitalisation convertie en devise des comptes
    z = v["altman_z"]
    assert z["value"] == pytest.approx(1.2 * 0.2 + 1.4 * 0.3 + 3.3 * 0.105 + 0.6 * (5000 / fx / 1000) + 1.0 * 0.5)
    c = d["dcf"]
    assert c["shares"] == pytest.approx(100)
    assert c["fcff"] == pytest.approx(165 * fx)
    assert c["cost_of_debt"] == pytest.approx(20 / 500)
    assert c["debt"] == pytest.approx(500 * fx)
    q = d["quote"]
    assert q["change_pct"] == pytest.approx(50 / 49 - 1)
    assert len(d["chart"]["time"]) == len(HIST)
    assert d["benchmark"] == "^GSPC"


def test_risk_endpoint(client):
    r = client.get("/api/risk/TEST?period=3y&rf=0.02")
    assert r.status_code == 200
    d = r.get_json()
    json.dumps(d, allow_nan=False)
    assert d["rf"] == 0.02
    assert "beta" in d["relative"] and d["base100"]["stock"][0] == 100


def test_compare_and_quotes(client):
    d = client.get("/api/compare?symbols=AAA,BBB&period=1y").get_json()
    assert [r["symbol"] for r in d["rows"]] == ["AAA", "BBB"]
    assert d["rows"][0]["roe"] == pytest.approx(142.5 / 950)
    q = client.get("/api/quotes?symbols=AAA").get_json()
    assert q[0]["change_pct"] == pytest.approx(HIST["Close"].iloc[-1] / HIST["Close"].iloc[-2] - 1)


def test_errors(client):
    assert client.get("/api/stock/NODATA").status_code == 404
    assert client.get("/api/stock/bad$sym").status_code == 400
    assert client.get("/api/risk/TEST?period=2w").status_code == 400
    assert client.get("/api/nope").status_code == 404
    assert client.get("/").status_code == 200


def test_ttm_basis(client, monkeypatch):
    ttm_dates = pd.to_datetime(["2025-06-30"])
    inc = frame({k: [v[0] * 1.1] for k, v in INCOME.items()}, ttm_dates)
    cf = frame({k: [v[0]] for k, v in CASHFLOW.items()}, ttm_dates)
    bal = frame({k: [v[0]] for k, v in BALANCE.items()}, ttm_dates)

    def st(symbol):
        s = fake_statements(symbol)
        s.update(income_ttm=inc, cashflow_ttm=cf, balance_q=bal)
        return s

    monkeypatch.setattr(data, "statements", st)
    v = client.get("/api/stock/TEST").get_json()["valuation"]
    assert v["basis"].startswith("12 derniers mois")
    assert v["pe"] == pytest.approx(5000 / (142.5 * 1.1 * 1.1))
