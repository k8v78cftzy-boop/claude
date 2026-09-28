import pytest

from finance import fundamentals as fu
from tests.fixtures import BALANCE, CASHFLOW, INCOME, frame

APPROX = dict(rel=1e-9, abs=1e-12)


@pytest.fixture(scope="module")
def result():
    s = fu.Statements(frame(INCOME), frame(BALANCE), frame(CASHFLOW))
    return fu.analyze_statements(s)


def val(result, key, year=0):
    for g in result["groups"]:
        for r in g["rows"]:
            if r["key"] == key:
                return r["values"][year]
    raise KeyError(key)


def test_years_sorted_latest_first(result):
    assert result["years"] == ["2024-12-31", "2023-12-31", "2022-12-31"]


@pytest.mark.parametrize("key,expected", [
    ("gross_margin", 400 / 1000),
    ("operating_margin", 200 / 1000),
    ("ebitda_margin", 260 / 1000),
    ("ebit_margin", 210 / 1000),
    ("pretax_margin", 190 / 1000),
    ("net_margin", 142.5 / 1000),
    ("fcf_margin", 150 / 1000),
    ("roa", 142.5 / ((2000 + 1800) / 2)),
    ("roe", 142.5 / ((1000 + 900) / 2)),
    ("roic", 210 * 0.75 / (((1000 + 500 - 250) + (900 + 520 - 200)) / 2)),
    ("roce", 210 / (2000 - 400)),
    ("tax_rate", 0.25),
    ("rnd_to_revenue", 0.05),
    ("sga_to_revenue", 0.15),
    ("current_ratio", 2.0),
    ("quick_ratio", (800 - 150) / 400),
    ("cash_ratio", 300 / 400),
    ("ocf_ratio", 250 / 400),
    ("working_capital", 400),
    ("debt_to_equity", 0.5),
    ("net_debt", 200),
    ("gearing", 0.2),
    ("net_debt_to_ebitda", 200 / 260),
    ("debt_ratio", 0.5),
    ("debt_to_capital", 500 / 1500),
    ("equity_ratio", 0.5),
    ("interest_coverage", 10.5),
    ("ebitda_coverage", 13.0),
    ("cost_of_debt", 20 / 510),
    ("asset_turnover", 1000 / 1900),
    ("fixed_asset_turnover", 1000 / 675),
    ("inventory_turnover", 600 / 145),
    ("dio", 365 * 145 / 600),
    ("receivables_turnover", 1000 / 175),
    ("dso", 365 * 175 / 1000),
    ("payables_turnover", 600 / 95),
    ("dpo", 365 * 95 / 600),
    ("ccc", 365 * 145 / 600 + 365 * 175 / 1000 - 365 * 95 / 600),
    ("revenue_growth", 0.25),
    ("eps_growth", 1.425 / 1.0275 - 1),
    ("net_income_growth", 142.5 / 102.75 - 1),
    ("shares_change", 0.0),
    ("dol", (210 / 155 - 1) / 0.25),
    ("dfl", 210 / 190),
    ("dtl", (210 / 155 - 1) / 0.25 * 210 / 190),
    ("fcf", 150),
    ("fcff", 250 + 20 * 0.75 - 100),
    ("fcfe", 250 - 100 - 20),
    ("capex_to_revenue", 0.1),
    ("capex_to_da", 2.0),
    ("ocf_to_ni", 250 / 142.5),
    ("accruals_ratio", (142.5 - 250) / 1900),
    ("payout_ratio", 50 / 142.5),
    ("total_payout_fcf", 80 / 150),
    ("sustainable_growth", 142.5 / 950 * (1 - 50 / 142.5)),
])
def test_ratio_values(result, key, expected):
    assert val(result, key) == pytest.approx(expected, **APPROX)


def test_dupont_identities(result):
    roe = val(result, "roe")
    assert val(result, "dp_roe3") == pytest.approx(roe, **APPROX)
    assert val(result, "dp_roe5") == pytest.approx(roe, **APPROX)


def test_internal_growth(result):
    roa = 142.5 / 1900
    b = 1 - 50 / 142.5
    assert val(result, "internal_growth") == pytest.approx(roa * b / (1 - roa * b), **APPROX)


def test_oldest_year_uses_closing_balances(result):
    # pas d'exercice précédent pour 2022 : ROE = RN / CP de clôture
    assert val(result, "roe", 2) == pytest.approx(82.5 / 800, **APPROX)
    assert val(result, "revenue_growth", 2) is None


def test_altman_z2(result):
    z = result["scores"][0]["altman_z2"]
    assert z["value"] == pytest.approx(6.56 * 0.2 + 3.26 * 0.3 + 6.72 * 0.105 + 1.05 * 1.0, **APPROX)
    assert z["zone"] == "sain"


def test_springate(result):
    s = result["scores"][0]["springate"]
    assert s["value"] == pytest.approx(1.03 * 0.2 + 3.07 * 0.105 + 0.66 * 190 / 400 + 0.4 * 0.5, **APPROX)


def test_piotroski_full_score(result):
    p = result["scores"][0]["piotroski"]
    assert p["value"] == 9 and p["max"] == 9
    # dernier exercice : pas de N-1 -> non calculé
    assert result["scores"][2]["piotroski"] is None


def test_piotroski_second_year(result):
    # 2023 vs 2022 : actions 100 <= 102 (1) ; ROA_2023 = 102,75/1600 vs ROA_2022 = 82,5/1600 (actif d'ouverture absent)
    p = result["scores"][1]["piotroski"]
    points = {c["label"]: c["point"] for c in p["criteria"]}
    assert points["Pas de dilution"] == 1
    assert points["ROA en hausse"] == 1
    assert points["Levier en baisse"] == int(450 / 1800 < 470 / 1600)


def test_beneish_components(result):
    b = result["scores"][0]["beneish"]
    c = b["components"]
    assert c["DSRI"] == pytest.approx((200 / 1000) / (150 / 800), **APPROX)
    assert c["GMI"] == pytest.approx((300 / 800) / (400 / 1000), **APPROX)
    aq_c = 1 - (800 + 700) / 2000
    aq_p = 1 - (700 + 650) / 1800
    assert c["AQI"] == pytest.approx(aq_c / aq_p, **APPROX)
    assert c["SGI"] == pytest.approx(1.25, **APPROX)
    assert c["DEPI"] == pytest.approx((45 / (45 + 650)) / (50 / (50 + 700)), **APPROX)
    assert c["SGAI"] == pytest.approx((150 / 1000) / (120 / 800), **APPROX)
    assert c["LVGI"] == pytest.approx(((400 + 400) / 2000) / ((380 + 450) / 1800), **APPROX)
    assert c["TATA"] == pytest.approx((142.5 - 250) / 2000, **APPROX)
    expected = (-4.84 + 0.920 * c["DSRI"] + 0.528 * c["GMI"] + 0.404 * c["AQI"] + 0.892 * c["SGI"]
                + 0.115 * c["DEPI"] - 0.172 * c["SGAI"] + 4.679 * c["TATA"] - 0.327 * c["LVGI"])
    assert b["value"] == pytest.approx(expected, **APPROX)


def test_beneish_neutral_company():
    """Indices tous égaux à 1 et TATA = 0 -> M = -2,48 (somme des coefficients)."""
    item = dict(receivables=100, revenue=1000, gross_profit=400, current_assets=500, ppe=300, total_assets=2000,
                da=50, sga=100, current_liabilities=200, ltd=300, ni_cont=100, ocf=100)
    m = fu.beneish(item, dict(item))
    assert m["value"] == pytest.approx(-2.48, abs=1e-9)


def test_altman_z_original():
    item = dict(total_assets=1000, working_capital=100, retained_earnings=200, ebit=150,
                total_liabilities=400, revenue=1200)
    z = fu.altman_z(item, market_equity=800)
    expected = 1.2 * 0.1 + 1.4 * 0.2 + 3.3 * 0.15 + 0.6 * 2.0 + 1.0 * 1.2
    assert z["value"] == pytest.approx(expected, **APPROX)
    assert z["zone"] == "sain"


def test_cagr(result):
    span = result["cagr"]["years"]
    assert span == pytest.approx((pytest.importorskip("pandas").Timestamp("2024-12-31")
                                  - pytest.importorskip("pandas").Timestamp("2022-12-31")).days / 365.25)
    assert result["cagr"]["revenue"] == pytest.approx((1000 / 700) ** (1 / span) - 1, **APPROX)


def test_missing_data_gives_none():
    s = fu.Statements(frame({"TotalRevenue": [100, 90, 80]}), frame({"TotalAssets": [500, 400, 300]}), None)
    r = fu.analyze_statements(s)
    assert val(r, "gross_margin") is None
    assert val(r, "asset_turnover") == pytest.approx(100 / 450)
    assert val(r, "fcf") is None


def test_helpers():
    assert fu.div(1, 0) is None
    assert fu.div(None, 2) is None
    assert fu.growth(10, -5) is None
    assert fu.cagr(121, 100, 2) == pytest.approx(0.1)
    assert fu.avg(10, None) == 10
    assert fu.avg(10, 20) == 15
