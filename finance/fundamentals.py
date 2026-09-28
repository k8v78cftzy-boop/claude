"""Analyse financière fondamentale : ratios, scores et données de valorisation.

Les états financiers sont des DataFrames au format yfinance (``pretty=False``) :
index = libellés CamelCase (ex. ``TotalRevenue``), colonnes = dates de clôture.

Conventions (précisées dans chaque formule affichée) :
- « moyen » = moyenne (ouverture + clôture) / 2 lorsque l'exercice précédent est
  disponible, sinon valeur de clôture ;
- CapEx, dividendes et rachats d'actions sont négatifs dans le tableau de flux
  Yahoo : on utilise leur valeur absolue ;
- aucun ratio n'est calculé si une donnée manque ou si un dénominateur est nul
  (valeur « n/d »).
"""
from __future__ import annotations

import math
from typing import Callable

import pandas as pd

# ---------------------------------------------------------------------------
# Opérations tolérantes aux valeurs manquantes
# ---------------------------------------------------------------------------


def _num(x):
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def div(a, b):
    a, b = _num(a), _num(b)
    if a is None or b is None or b == 0:
        return None
    return a / b


def add(*xs):
    xs = [_num(x) for x in xs]
    return None if any(x is None for x in xs) else sum(xs)


def sub(a, b):
    a, b = _num(a), _num(b)
    return None if a is None or b is None else a - b


def mul(*xs):
    xs = [_num(x) for x in xs]
    if any(x is None for x in xs):
        return None
    out = 1.0
    for x in xs:
        out *= x
    return out


def growth(cur, prev):
    """Variation relative : (N / N-1) - 1, définie seulement si N-1 > 0."""
    cur, prev = _num(cur), _num(prev)
    if cur is None or prev is None or prev <= 0:
        return None
    return cur / prev - 1


def cagr(last, first, years):
    last, first = _num(last), _num(first)
    if last is None or first is None or first <= 0 or last <= 0 or not years:
        return None
    return (last / first) ** (1 / years) - 1


def avg(cur, prev):
    """Moyenne ouverture/clôture, sinon clôture."""
    cur, prev = _num(cur), _num(prev)
    if cur is None:
        return None
    return cur if prev is None else (cur + prev) / 2


def absval(x):
    x = _num(x)
    return None if x is None else abs(x)


# ---------------------------------------------------------------------------
# Accès aux états financiers
# ---------------------------------------------------------------------------


def _prep(df: pd.DataFrame | None) -> pd.DataFrame:
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return pd.DataFrame()
    df = df.copy()
    df.columns = pd.to_datetime(df.columns)
    df = df[sorted(df.columns, reverse=True)]
    return df.apply(pd.to_numeric, errors="coerce")


class Statements:
    """Accès aligné aux trois états financiers annuels (le plus récent en premier)."""

    def __init__(self, income, balance, cashflow):
        self.inc = _prep(income)
        self.bal = _prep(balance)
        self.cf = _prep(cashflow)
        # dates maîtres : exercices du compte de résultat (sinon bilan)
        master = self.inc if not self.inc.empty else self.bal
        dates = list(master.columns)
        # on retire les exercices sans chiffre d'affaires ni total bilan (colonnes vides Yahoo)
        kept = []
        for d in dates:
            rev = self._raw(self.inc, "TotalRevenue", d)
            ta = self._raw(self.bal, "TotalAssets", d)
            ni = self._raw(self.inc, "NetIncome", d)
            if rev is not None or ta is not None or ni is not None:
                kept.append(d)
        self.dates = kept

    @staticmethod
    def _match(df: pd.DataFrame, date):
        if df.empty:
            return None
        if date in df.columns:
            return date
        # même exercice à quelques jours près
        for c in df.columns:
            if abs((c - date).days) <= 40:
                return c
        return None

    def _raw(self, df, key, date):
        col = self._match(df, date)
        if col is None or key not in df.index:
            return None
        return _num(df.at[key, col])

    def get(self, stmt: str, keys, i: int):
        """Valeur du premier libellé disponible parmi ``keys`` pour l'exercice i."""
        if i is None or i < 0 or i >= len(self.dates):
            return None
        df = {"inc": self.inc, "bal": self.bal, "cf": self.cf}[stmt]
        if isinstance(keys, str):
            keys = [keys]
        for k in keys:
            v = self._raw(df, k, self.dates[i])
            if v is not None:
                return v
        return None

    def n(self):
        return len(self.dates)


# ---------------------------------------------------------------------------
# Postes de base (avec repli sur des calculs quand Yahoo ne fournit pas le poste)
# ---------------------------------------------------------------------------


def base_items(s: Statements, i: int) -> dict:
    g = s.get
    rev = g("inc", ["TotalRevenue", "OperatingRevenue"], i)
    cogs = g("inc", ["CostOfRevenue", "ReconciledCostOfRevenue"], i)
    gp = g("inc", "GrossProfit", i)
    if gp is None and rev is not None and cogs is not None:
        gp = rev - cogs
    op_inc = g("inc", ["OperatingIncome", "TotalOperatingIncomeAsReported"], i)
    ebit = g("inc", "EBIT", i)
    if ebit is None:
        ebit = op_inc
    da = g("cf", ["DepreciationAndAmortization", "DepreciationAmortizationDepletion"], i)
    if da is None:
        da = g("inc", ["ReconciledDepreciation", "DepreciationAndAmortizationInIncomeStatement"], i)
    ebitda = g("inc", "EBITDA", i)
    if ebitda is None:
        ebitda = add(ebit, da)
    interest = absval(g("inc", ["InterestExpense", "InterestExpenseNonOperating"], i))
    pretax = g("inc", "PretaxIncome", i)
    tax = g("inc", "TaxProvision", i)
    ni = g("inc", ["NetIncome", "NetIncomeCommonStockholders"], i)
    ni_common = g("inc", ["NetIncomeCommonStockholders", "NetIncome"], i)
    ni_cont = g("inc", ["NetIncomeContinuousOperations", "NetIncomeFromContinuingOperationNetMinorityInterest"], i)
    if ni_cont is None:
        ni_cont = ni
    tax_rate = div(tax, pretax)
    if tax_rate is None or not (0 <= tax_rate <= 0.5):
        tr2 = g("inc", "TaxRateForCalcs", i)
        tax_rate = tr2 if tr2 is not None and 0 <= tr2 <= 0.5 else None

    ta = g("bal", "TotalAssets", i)
    ca = g("bal", "CurrentAssets", i)
    cl = g("bal", "CurrentLiabilities", i)
    inv = g("bal", "Inventory", i)
    ar = g("bal", ["AccountsReceivable", "Receivables"], i)
    ap = g("bal", ["AccountsPayable", "Payables"], i)
    cash = g("bal", ["CashAndCashEquivalents", "CashCashEquivalentsAndFederalFundsSold"], i)
    cash_sti = g("bal", "CashCashEquivalentsAndShortTermInvestments", i)
    if cash_sti is None:
        cash_sti = cash
    debt = g("bal", "TotalDebt", i)
    if debt is None:
        lt = g("bal", ["LongTermDebtAndCapitalLeaseObligation", "LongTermDebt"], i)
        st = g("bal", ["CurrentDebtAndCapitalLeaseObligation", "CurrentDebt"], i)
        if lt is not None or st is not None:
            debt = (lt or 0.0) + (st or 0.0)
    ltd = g("bal", ["LongTermDebtAndCapitalLeaseObligation", "LongTermDebt"], i)
    equity = g("bal", ["StockholdersEquity", "CommonStockEquity"], i)
    total_liab = g("bal", "TotalLiabilitiesNetMinorityInterest", i)
    if total_liab is None:
        total_liab = sub(ta, g("bal", "TotalEquityGrossMinorityInterest", i))
    re = g("bal", "RetainedEarnings", i)
    ppe = g("bal", "NetPPE", i)
    minority = g("bal", "MinorityInterest", i)
    preferred = g("bal", "PreferredStockEquity", i)
    tangible_bv = g("bal", "TangibleBookValue", i)
    shares = g("bal", "OrdinarySharesNumber", i)
    if shares is None:
        shares = g("inc", ["DilutedAverageShares", "BasicAverageShares"], i)
    wc = sub(ca, cl)

    ocf = g("cf", ["OperatingCashFlow", "CashFlowFromContinuingOperatingActivities"], i)
    capex = absval(g("cf", ["CapitalExpenditure", "CapitalExpenditureReported", "PurchaseOfPPE"], i))
    fcf = sub(ocf, capex) if capex is not None else g("cf", "FreeCashFlow", i)
    dividends = absval(g("cf", ["CashDividendsPaid", "CommonStockDividendPaid"], i))
    buybacks = absval(g("cf", ["RepurchaseOfCapitalStock", "CommonStockPayments"], i))
    sbc = g("cf", "StockBasedCompensation", i)
    dnwc_cash = g("cf", "ChangeInWorkingCapital", i)
    net_borrowing = g("cf", "NetIssuancePaymentsOfDebt", i)
    if net_borrowing is None:
        iss = g("cf", "IssuanceOfDebt", i)
        rep = g("cf", "RepaymentOfDebt", i)
        if iss is not None or rep is not None:
            net_borrowing = (iss or 0.0) + (rep or 0.0)
    sga = g("inc", "SellingGeneralAndAdministration", i)
    rnd = g("inc", "ResearchAndDevelopment", i)
    eps = g("inc", ["DilutedEPS", "BasicEPS"], i)

    # poste absent chez Yahoo : nul seulement si la société n'a pas de dette financière
    no_debt = debt is None or debt == 0
    if interest is None and no_debt:
        interest = 0.0
    if net_borrowing is None and no_debt:
        net_borrowing = 0.0

    nopat = mul(ebit, sub(1, tax_rate)) if tax_rate is not None else None
    invested = sub(add(equity, debt), cash) if cash is not None else add(equity, debt)
    net_debt = sub(debt, cash_sti) if debt is not None else None
    # FCFF = CFO + intérêts*(1-t) - CapEx (définition CFA)
    fcff = sub(add(ocf, mul(interest, sub(1, tax_rate))), capex) if tax_rate is not None else None
    fcfe = add(sub(ocf, capex), net_borrowing)
    return dict(
        revenue=rev, cogs=cogs, gross_profit=gp, operating_income=op_inc, ebit=ebit, ebitda=ebitda, da=da,
        interest=interest, pretax=pretax, tax=tax, tax_rate=tax_rate, net_income=ni, ni_common=ni_common,
        ni_cont=ni_cont, total_assets=ta, current_assets=ca, current_liabilities=cl, inventory=inv,
        receivables=ar, payables=ap, cash=cash, cash_sti=cash_sti, debt=debt, ltd=ltd, equity=equity,
        total_liabilities=total_liab, retained_earnings=re, ppe=ppe, minority=minority, preferred=preferred,
        tangible_bv=tangible_bv, shares=shares, working_capital=wc, ocf=ocf, capex=capex, fcf=fcf,
        dividends=dividends, buybacks=buybacks, sbc=sbc, dnwc_cash=dnwc_cash, net_borrowing=net_borrowing,
        sga=sga, rnd=rnd, eps=eps, nopat=nopat, invested_capital=invested, net_debt=net_debt, fcff=fcff,
        fcfe=fcfe,
    )


# ---------------------------------------------------------------------------
# Définition des ratios par exercice
# ---------------------------------------------------------------------------

AVG = " (moyenne ouverture/clôture si disponible)"

# (clé, libellé, formule, format, fonction(c, p) -> valeur) ; c = exercice N, p = N-1 (ou {} si absent)
Metric = tuple[str, str, str, str, Callable[[dict, dict], float | None]]


def _a(c, p, k):
    return avg(c.get(k), p.get(k))


GROUPS: list[tuple[str, str, list[Metric]]] = [
    ("profitability", "Rentabilité", [
        ("gross_margin", "Marge brute", "Résultat brut / Chiffre d'affaires", "pct",
         lambda c, p: div(c["gross_profit"], c["revenue"])),
        ("operating_margin", "Marge opérationnelle", "Résultat opérationnel / Chiffre d'affaires", "pct",
         lambda c, p: div(c["operating_income"], c["revenue"])),
        ("ebitda_margin", "Marge d'EBITDA", "EBITDA / Chiffre d'affaires", "pct",
         lambda c, p: div(c["ebitda"], c["revenue"])),
        ("ebit_margin", "Marge d'EBIT", "EBIT / Chiffre d'affaires", "pct",
         lambda c, p: div(c["ebit"], c["revenue"])),
        ("pretax_margin", "Marge avant impôt", "Résultat avant impôt / Chiffre d'affaires", "pct",
         lambda c, p: div(c["pretax"], c["revenue"])),
        ("net_margin", "Marge nette", "Résultat net / Chiffre d'affaires", "pct",
         lambda c, p: div(c["net_income"], c["revenue"])),
        ("fcf_margin", "Marge de FCF", "(CFO − CapEx) / Chiffre d'affaires", "pct",
         lambda c, p: div(c["fcf"], c["revenue"])),
        ("roa", "ROA", "Résultat net / Actif total" + AVG, "pct",
         lambda c, p: div(c["net_income"], _a(c, p, "total_assets"))),
        ("roe", "ROE", "Résultat net / Capitaux propres" + AVG, "pct",
         lambda c, p: div(c["net_income"], _a(c, p, "equity"))),
        ("roic", "ROIC", "NOPAT / Capitaux investis" + AVG
         + " ; NOPAT = EBIT × (1 − t) ; CI = Capitaux propres + Dette financière − Trésorerie", "pct",
         lambda c, p: div(c["nopat"], _a(c, p, "invested_capital"))),
        ("roce", "ROCE", "EBIT / (Actif total − Passif courant)", "pct",
         lambda c, p: div(c["ebit"], sub(c["total_assets"], c["current_liabilities"]))),
        ("tax_rate", "Taux d'impôt effectif", "Impôt sur les sociétés / Résultat avant impôt (retenu si 0–50 %)",
         "pct", lambda c, p: c["tax_rate"]),
        ("rnd_to_revenue", "R&D / CA", "Dépenses de R&D / Chiffre d'affaires", "pct",
         lambda c, p: div(c["rnd"], c["revenue"])),
        ("sga_to_revenue", "Frais commerciaux et généraux / CA", "SG&A / Chiffre d'affaires", "pct",
         lambda c, p: div(c["sga"], c["revenue"])),
    ]),
    ("dupont", "Décomposition DuPont", [
        ("dp_net_margin", "Marge nette", "Résultat net / CA", "pct",
         lambda c, p: div(c["net_income"], c["revenue"])),
        ("dp_asset_turnover", "Rotation de l'actif", "CA / Actif total" + AVG, "x",
         lambda c, p: div(c["revenue"], _a(c, p, "total_assets"))),
        ("dp_equity_multiplier", "Multiplicateur de capitaux propres", "Actif total / Capitaux propres" + AVG, "x",
         lambda c, p: div(_a(c, p, "total_assets"), _a(c, p, "equity"))),
        ("dp_roe3", "ROE DuPont (3 facteurs)", "Marge nette × Rotation de l'actif × Multiplicateur", "pct",
         lambda c, p: mul(div(c["net_income"], c["revenue"]), div(c["revenue"], _a(c, p, "total_assets")),
                          div(_a(c, p, "total_assets"), _a(c, p, "equity")))),
        ("dp_tax_burden", "Charge fiscale (tax burden)", "Résultat net / Résultat avant impôt", "x",
         lambda c, p: div(c["net_income"], c["pretax"])),
        ("dp_interest_burden", "Charge d'intérêts (interest burden)", "Résultat avant impôt / EBIT", "x",
         lambda c, p: div(c["pretax"], c["ebit"])),
        ("dp_ebit_margin", "Marge d'EBIT", "EBIT / CA", "pct", lambda c, p: div(c["ebit"], c["revenue"])),
        ("dp_roe5", "ROE DuPont (5 facteurs)",
         "Charge fiscale × Charge d'intérêts × Marge d'EBIT × Rotation de l'actif × Multiplicateur", "pct",
         lambda c, p: mul(div(c["net_income"], c["pretax"]), div(c["pretax"], c["ebit"]),
                          div(c["ebit"], c["revenue"]), div(c["revenue"], _a(c, p, "total_assets")),
                          div(_a(c, p, "total_assets"), _a(c, p, "equity")))),
    ]),
    ("liquidity", "Liquidité", [
        ("current_ratio", "Ratio de liquidité générale", "Actif courant / Passif courant", "x",
         lambda c, p: div(c["current_assets"], c["current_liabilities"])),
        ("quick_ratio", "Ratio de liquidité réduite (quick ratio)", "(Actif courant − Stocks) / Passif courant", "x",
         lambda c, p: div(sub(c["current_assets"], c["inventory"] or 0.0), c["current_liabilities"])),
        ("cash_ratio", "Ratio de liquidité immédiate", "(Trésorerie + placements CT) / Passif courant", "x",
         lambda c, p: div(c["cash_sti"], c["current_liabilities"])),
        ("ocf_ratio", "Ratio de flux de trésorerie d'exploitation", "CFO / Passif courant", "x",
         lambda c, p: div(c["ocf"], c["current_liabilities"])),
        ("working_capital", "Fonds de roulement (BFR comptable)", "Actif courant − Passif courant", "money",
         lambda c, p: c["working_capital"]),
        ("wc_to_assets", "Fonds de roulement / Actif total", "(Actif courant − Passif courant) / Actif total", "pct",
         lambda c, p: div(c["working_capital"], c["total_assets"])),
    ]),
    ("solvency", "Solvabilité et endettement", [
        ("debt_to_equity", "Dette / Capitaux propres (D/E)", "Dette financière totale / Capitaux propres", "x",
         lambda c, p: div(c["debt"], c["equity"])),
        ("net_debt", "Dette nette", "Dette financière − (Trésorerie + placements CT)", "money",
         lambda c, p: c["net_debt"]),
        ("gearing", "Gearing", "Dette nette / Capitaux propres", "pct",
         lambda c, p: div(c["net_debt"], c["equity"])),
        ("net_debt_to_ebitda", "Dette nette / EBITDA", "Dette nette / EBITDA", "x",
         lambda c, p: div(c["net_debt"], c["ebitda"]) if (c["ebitda"] or 0) > 0 else None),
        ("debt_ratio", "Ratio d'endettement global", "Total des dettes (passif) / Actif total", "pct",
         lambda c, p: div(c["total_liabilities"], c["total_assets"])),
        ("debt_to_assets", "Dette financière / Actif", "Dette financière / Actif total", "pct",
         lambda c, p: div(c["debt"], c["total_assets"])),
        ("debt_to_capital", "Dette / Capitaux permanents", "Dette / (Dette + Capitaux propres)", "pct",
         lambda c, p: div(c["debt"], add(c["debt"], c["equity"]))),
        ("equity_ratio", "Ratio d'autonomie financière", "Capitaux propres / Actif total", "pct",
         lambda c, p: div(c["equity"], c["total_assets"])),
        ("interest_coverage", "Couverture des intérêts", "EBIT / Charges d'intérêts", "x",
         lambda c, p: div(c["ebit"], c["interest"])),
        ("ebitda_coverage", "Couverture EBITDA des intérêts", "EBITDA / Charges d'intérêts", "x",
         lambda c, p: div(c["ebitda"], c["interest"])),
        ("fcf_to_debt", "FCF / Dette", "(CFO − CapEx) / Dette financière", "pct",
         lambda c, p: div(c["fcf"], c["debt"])),
        ("cost_of_debt", "Coût apparent de la dette", "Charges d'intérêts / Dette financière" + AVG, "pct",
         lambda c, p: div(c["interest"], _a(c, p, "debt"))),
    ]),
    ("efficiency", "Efficacité opérationnelle (gestion du BFR)", [
        ("asset_turnover", "Rotation de l'actif", "CA / Actif total" + AVG, "x",
         lambda c, p: div(c["revenue"], _a(c, p, "total_assets"))),
        ("fixed_asset_turnover", "Rotation des immobilisations corporelles", "CA / Immobilisations nettes" + AVG, "x",
         lambda c, p: div(c["revenue"], _a(c, p, "ppe"))),
        ("inventory_turnover", "Rotation des stocks", "Coût des ventes / Stocks" + AVG, "x",
         lambda c, p: div(c["cogs"], _a(c, p, "inventory"))),
        ("dio", "Délai d'écoulement des stocks (DIO)", "365 / Rotation des stocks", "days",
         lambda c, p: div(365, div(c["cogs"], _a(c, p, "inventory")))),
        ("receivables_turnover", "Rotation des créances clients", "CA / Créances clients" + AVG, "x",
         lambda c, p: div(c["revenue"], _a(c, p, "receivables"))),
        ("dso", "Délai de recouvrement clients (DSO)", "365 / Rotation des créances", "days",
         lambda c, p: div(365, div(c["revenue"], _a(c, p, "receivables")))),
        ("payables_turnover", "Rotation des dettes fournisseurs", "Coût des ventes / Dettes fournisseurs" + AVG, "x",
         lambda c, p: div(c["cogs"], _a(c, p, "payables"))),
        ("dpo", "Délai de paiement fournisseurs (DPO)", "365 / Rotation des dettes fournisseurs", "days",
         lambda c, p: div(365, div(c["cogs"], _a(c, p, "payables")))),
        ("ccc", "Cycle de conversion de trésorerie", "DIO + DSO − DPO", "days",
         lambda c, p: _ccc(c, p)),
        ("wc_turnover", "Rotation du fonds de roulement", "CA / (Actif courant − Passif courant)", "x",
         lambda c, p: div(c["revenue"], c["working_capital"]) if (c["working_capital"] or 0) > 0 else None),
    ]),
    ("growth", "Croissance (sur un an)", [
        ("revenue_growth", "Croissance du CA", "CA_N / CA_N−1 − 1", "pct",
         lambda c, p: growth(c["revenue"], p.get("revenue"))),
        ("gross_profit_growth", "Croissance du résultat brut", "RB_N / RB_N−1 − 1", "pct",
         lambda c, p: growth(c["gross_profit"], p.get("gross_profit"))),
        ("ebitda_growth", "Croissance de l'EBITDA", "EBITDA_N / EBITDA_N−1 − 1", "pct",
         lambda c, p: growth(c["ebitda"], p.get("ebitda"))),
        ("ebit_growth", "Croissance de l'EBIT", "EBIT_N / EBIT_N−1 − 1", "pct",
         lambda c, p: growth(c["ebit"], p.get("ebit"))),
        ("net_income_growth", "Croissance du résultat net", "RN_N / RN_N−1 − 1", "pct",
         lambda c, p: growth(c["net_income"], p.get("net_income"))),
        ("eps_growth", "Croissance du BPA dilué", "BPA_N / BPA_N−1 − 1", "pct",
         lambda c, p: growth(c["eps"], p.get("eps"))),
        ("fcf_growth", "Croissance du FCF", "FCF_N / FCF_N−1 − 1", "pct",
         lambda c, p: growth(c["fcf"], p.get("fcf"))),
        ("equity_growth", "Croissance des capitaux propres", "CP_N / CP_N−1 − 1", "pct",
         lambda c, p: growth(c["equity"], p.get("equity"))),
        ("shares_change", "Variation du nombre d'actions", "Actions_N / Actions_N−1 − 1", "pct",
         lambda c, p: growth(c["shares"], p.get("shares"))),
        ("sustainable_growth", "Taux de croissance soutenable (SGR)", "ROE × (1 − taux de distribution)", "pct",
         lambda c, p: _sgr(c, p)),
        ("internal_growth", "Taux de croissance interne (IGR)", "ROA × b / (1 − ROA × b), b = taux de rétention",
         "pct", lambda c, p: _igr(c, p)),
    ]),
    ("leverage", "Effets de levier", [
        ("dol", "Levier opérationnel (DOL)", "%Δ EBIT / %Δ CA", "x",
         lambda c, p: div(growth(c["ebit"], p.get("ebit")), growth(c["revenue"], p.get("revenue")))),
        ("dfl", "Levier financier (DFL)", "EBIT / (EBIT − Charges d'intérêts)", "x",
         lambda c, p: div(c["ebit"], sub(c["ebit"], c["interest"])) if c["interest"] is not None else None),
        ("dtl", "Levier combiné (DTL)", "DOL × DFL", "x",
         lambda c, p: mul(div(growth(c["ebit"], p.get("ebit")), growth(c["revenue"], p.get("revenue"))),
                          div(c["ebit"], sub(c["ebit"], c["interest"])) if c["interest"] is not None else None)),
    ]),
    ("cashflow", "Flux de trésorerie", [
        ("ocf", "Flux de trésorerie d'exploitation (CFO)", "Tableau des flux", "money", lambda c, p: c["ocf"]),
        ("capex", "Investissements (CapEx)", "|Dépenses d'investissement corporel|", "money", lambda c, p: c["capex"]),
        ("fcf", "Free cash flow (FCF)", "CFO − CapEx", "money", lambda c, p: c["fcf"]),
        ("fcff", "FCFF (flux disponible pour la firme)", "CFO + Intérêts × (1 − t) − CapEx", "money",
         lambda c, p: c["fcff"]),
        ("fcfe", "FCFE (flux disponible pour l'actionnaire)", "CFO − CapEx + Emprunts nets", "money",
         lambda c, p: c["fcfe"]),
        ("capex_to_revenue", "Intensité capitalistique", "CapEx / CA", "pct",
         lambda c, p: div(c["capex"], c["revenue"])),
        ("capex_to_da", "CapEx / Amortissements", "CapEx / Dotations aux amortissements", "x",
         lambda c, p: div(c["capex"], c["da"])),
        ("ocf_to_ni", "Qualité des résultats", "CFO / Résultat net", "x",
         lambda c, p: div(c["ocf"], c["net_income"]) if (c["net_income"] or 0) > 0 else None),
        ("fcf_conversion", "Conversion en FCF", "FCF / Résultat net", "pct",
         lambda c, p: div(c["fcf"], c["net_income"]) if (c["net_income"] or 0) > 0 else None),
        ("accruals_ratio", "Ratio d'accruals (Sloan)", "(Résultat net − CFO) / Actif total" + AVG, "pct",
         lambda c, p: div(sub(c["net_income"], c["ocf"]), _a(c, p, "total_assets"))),
        ("sbc_to_revenue", "Rémunération en actions / CA", "Stock-based compensation / CA", "pct",
         lambda c, p: div(c["sbc"], c["revenue"])),
        ("dividends_paid", "Dividendes versés", "|Dividendes payés|", "money", lambda c, p: c["dividends"]),
        ("buybacks", "Rachats d'actions", "|Rachats d'actions propres|", "money", lambda c, p: c["buybacks"]),
        ("payout_ratio", "Taux de distribution", "Dividendes versés / Résultat net", "pct",
         lambda c, p: div(c["dividends"], c["net_income"]) if (c["net_income"] or 0) > 0 else None),
        ("total_payout_fcf", "Retour à l'actionnaire / FCF", "(Dividendes + Rachats) / FCF", "pct",
         lambda c, p: div(add(c["dividends"] or 0.0, c["buybacks"] or 0.0), c["fcf"]) if (c["fcf"] or 0) > 0 else None),
    ]),
]


def _ccc(c, p):
    dio = div(365, div(c["cogs"], _a(c, p, "inventory")))
    dso = div(365, div(c["revenue"], _a(c, p, "receivables")))
    dpo = div(365, div(c["cogs"], _a(c, p, "payables")))
    if dso is None or dpo is None:
        return None
    # société sans stocks : DIO = 0
    if dio is None and (c.get("inventory") in (None, 0.0)):
        dio = 0.0
    return add(dio, dso, -dpo)


def _retention(c):
    if (c["net_income"] or 0) <= 0 or c["dividends"] is None:
        return None
    return 1 - c["dividends"] / c["net_income"]


def _sgr(c, p):
    b = _retention(c)
    roe = div(c["net_income"], _a(c, p, "equity"))
    return mul(roe, b) if (b is not None and roe is not None and _a(c, p, "equity") > 0) else None


def _igr(c, p):
    b = _retention(c)
    roa = div(c["net_income"], _a(c, p, "total_assets"))
    if b is None or roa is None:
        return None
    x = roa * b
    return None if x >= 1 else x / (1 - x)


# ---------------------------------------------------------------------------
# Scores
# ---------------------------------------------------------------------------


def altman_z(c: dict, market_equity: float | None) -> dict | None:
    """Altman Z (1968, sociétés industrielles cotées).

    Z = 1,2 X1 + 1,4 X2 + 3,3 X3 + 0,6 X4 + 1,0 X5 ; zones : > 2,99 sain, 1,81–2,99 zone grise, < 1,81 détresse.
    """
    ta = c["total_assets"]
    x = [div(c["working_capital"], ta), div(c["retained_earnings"], ta), div(c["ebit"], ta),
         div(market_equity, c["total_liabilities"]), div(c["revenue"], ta)]
    if any(v is None for v in x):
        return None
    z = 1.2 * x[0] + 1.4 * x[1] + 3.3 * x[2] + 0.6 * x[3] + 1.0 * x[4]
    zone = "sain" if z > 2.99 else ("zone grise" if z >= 1.81 else "détresse")
    return {"value": z, "zone": zone, "components": dict(zip(["X1", "X2", "X3", "X4", "X5"], x))}


def altman_z2(c: dict) -> dict | None:
    """Altman Z'' (sociétés non industrielles / émergents) : 6,56 X1 + 3,26 X2 + 6,72 X3 + 1,05 X4.

    X4 = capitaux propres comptables / total des dettes ; zones : > 2,60 sain, 1,10–2,60 zone grise, < 1,10 détresse.
    """
    ta = c["total_assets"]
    x = [div(c["working_capital"], ta), div(c["retained_earnings"], ta), div(c["ebit"], ta),
         div(c["equity"], c["total_liabilities"])]
    if any(v is None for v in x):
        return None
    z = 6.56 * x[0] + 3.26 * x[1] + 6.72 * x[2] + 1.05 * x[3]
    zone = "sain" if z > 2.6 else ("zone grise" if z >= 1.1 else "détresse")
    return {"value": z, "zone": zone, "components": dict(zip(["X1", "X2", "X3", "X4"], x))}


def springate(c: dict) -> dict | None:
    """Springate S = 1,03 A + 3,07 B + 0,66 C + 0,4 D ; S < 0,862 : risque de défaillance.

    A = FR/Actif, B = EBIT/Actif, C = Résultat avant impôt/Passif courant, D = CA/Actif.
    """
    ta = c["total_assets"]
    x = [div(c["working_capital"], ta), div(c["ebit"], ta), div(c["pretax"], c["current_liabilities"]),
         div(c["revenue"], ta)]
    if any(v is None for v in x):
        return None
    s = 1.03 * x[0] + 3.07 * x[1] + 0.66 * x[2] + 0.4 * x[3]
    return {"value": s, "zone": "sain" if s >= 0.862 else "risque de défaillance",
            "components": dict(zip(["A", "B", "C", "D"], x))}


def piotroski(c: dict, p: dict, pp: dict) -> dict | None:
    """Score F de Piotroski (2000), 9 critères binaires comparant N à N-1.

    ROA et rotation de l'actif utilisent l'actif total d'ouverture (clôture N-1) ;
    à défaut, l'actif de clôture.
    """
    if not p:
        return None
    ta_begin = p.get("total_assets") or c["total_assets"]
    ta_begin_prev = (pp or {}).get("total_assets") or p.get("total_assets")
    roa = div(c["net_income"], ta_begin)
    roa_prev = div(p.get("net_income"), ta_begin_prev)
    cfo_ta = div(c["ocf"], ta_begin)

    def lev(x):
        if x.get("total_assets") in (None, 0):
            return None
        return (x.get("ltd") or 0.0) / x["total_assets"]

    lev_c, lev_p = lev(c), lev(p)
    cr_c = div(c["current_assets"], c["current_liabilities"])
    cr_p = div(p.get("current_assets"), p.get("current_liabilities"))
    gm_c = div(c["gross_profit"], c["revenue"])
    gm_p = div(p.get("gross_profit"), p.get("revenue"))
    at_c = div(c["revenue"], ta_begin)
    at_p = div(p.get("revenue"), ta_begin_prev)

    def cmp(a, b, fn):
        return None if a is None or b is None else int(fn(a, b))

    criteria = [
        ("ROA positif", "Résultat net / Actif d'ouverture > 0", None if roa is None else int(roa > 0)),
        ("CFO positif", "Flux de trésorerie d'exploitation > 0", None if c["ocf"] is None else int(c["ocf"] > 0)),
        ("ROA en hausse", "ROA_N > ROA_N−1", cmp(roa, roa_prev, lambda a, b: a > b)),
        ("Qualité des résultats", "CFO / Actif > ROA", cmp(cfo_ta, roa, lambda a, b: a > b)),
        ("Levier en baisse", "Dette LT / Actif en baisse (ou nulle les deux années)",
         cmp(lev_c, lev_p, lambda a, b: a < b or (a == 0 and b == 0))),
        ("Liquidité en hausse", "Ratio de liquidité générale en hausse", cmp(cr_c, cr_p, lambda a, b: a > b)),
        ("Pas de dilution", "Nombre d'actions N ≤ N−1", cmp(c["shares"], p.get("shares"), lambda a, b: a <= b)),
        ("Marge brute en hausse", "Marge brute_N > Marge brute_N−1", cmp(gm_c, gm_p, lambda a, b: a > b)),
        ("Rotation de l'actif en hausse", "CA / Actif d'ouverture en hausse", cmp(at_c, at_p, lambda a, b: a > b)),
    ]
    available = [v for _, _, v in criteria if v is not None]
    if not available:
        return None
    return {"value": sum(available), "max": len(available),
            "criteria": [{"label": l, "rule": r, "point": v} for l, r, v in criteria]}


def beneish(c: dict, p: dict) -> dict | None:
    """M-score de Beneish (1999, modèle à 8 variables).

    M = −4,84 + 0,920 DSRI + 0,528 GMI + 0,404 AQI + 0,892 SGI + 0,115 DEPI − 0,172 SGAI + 4,679 TATA − 0,327 LVGI.
    M > −1,78 : probabilité élevée de manipulation comptable.
    """
    if not p:
        return None
    dsri = div(div(c["receivables"], c["revenue"]), div(p.get("receivables"), p.get("revenue")))
    gm_c = div(c["gross_profit"], c["revenue"])
    gm_p = div(p.get("gross_profit"), p.get("revenue"))
    gmi = div(gm_p, gm_c)

    def aq(x):
        return sub(1, div(add(x.get("current_assets"), x.get("ppe")), x.get("total_assets")))

    aqi = div(aq(c), aq(p))
    sgi = div(c["revenue"], p.get("revenue"))

    def dep_rate(x):
        return div(x.get("da"), add(x.get("da"), x.get("ppe")))

    depi = div(dep_rate(p), dep_rate(c))
    sgai = div(div(c["sga"], c["revenue"]), div(p.get("sga"), p.get("revenue")))

    def lv(x):
        return div(add(x.get("current_liabilities"), x.get("ltd") or 0.0), x.get("total_assets"))

    lvgi = div(lv(c), lv(p))
    tata = div(sub(c["ni_cont"], c["ocf"]), c["total_assets"])
    comps = {"DSRI": dsri, "GMI": gmi, "AQI": aqi, "SGI": sgi, "DEPI": depi, "SGAI": sgai, "TATA": tata,
             "LVGI": lvgi}
    if any(v is None for v in comps.values()):
        return {"value": None, "components": comps}
    m = (-4.84 + 0.920 * dsri + 0.528 * gmi + 0.404 * aqi + 0.892 * sgi + 0.115 * depi - 0.172 * sgai
         + 4.679 * tata - 0.327 * lvgi)
    return {"value": m, "zone": "risque de manipulation" if m > -1.78 else "peu probable", "components": comps}


# ---------------------------------------------------------------------------
# Analyse complète par exercice
# ---------------------------------------------------------------------------


def analyze_statements(s: Statements) -> dict:
    n = s.n()
    items = [base_items(s, i) for i in range(n)]
    years = [d.strftime("%Y-%m-%d") for d in s.dates]
    groups = []
    for gkey, glabel, metrics in GROUPS:
        rows = []
        for key, label, formula, fmt, fn in metrics:
            values = []
            for i in range(n):
                c = items[i]
                p = items[i + 1] if i + 1 < n else {}
                try:
                    v = fn(c, p)
                except (TypeError, ZeroDivisionError):
                    v = None
                values.append(_num(v))
            rows.append({"key": key, "label": label, "formula": formula, "fmt": fmt, "values": values})
        groups.append({"key": gkey, "label": glabel, "rows": rows})

    scores = []
    for i in range(n):
        c = items[i]
        p = items[i + 1] if i + 1 < n else {}
        pp = items[i + 2] if i + 2 < n else {}
        scores.append({
            "year": years[i],
            "altman_z2": altman_z2(c),
            "springate": springate(c),
            "piotroski": piotroski(c, p, pp) if p else None,
            "beneish": beneish(c, p) if p else None,
        })

    multi_year = {}
    if n >= 2:
        span = (s.dates[0] - s.dates[-1]).days / 365.25
        for key in ("revenue", "ebitda", "net_income", "eps", "fcf", "equity"):
            multi_year[key] = cagr(items[0][key], items[-1][key], span)
        multi_year["years"] = span

    return {"years": years, "items": items, "groups": groups, "scores": scores, "cagr": multi_year}


def statements_table(df: pd.DataFrame) -> dict:
    """Tableau brut d'un état financier pour l'affichage."""
    df = _prep(df)
    if df.empty:
        return {"columns": [], "rows": []}
    rows = []
    for key in df.index:
        vals = [_num(v) for v in df.loc[key].tolist()]
        if all(v is None for v in vals):
            continue
        rows.append({"key": str(key), "values": vals})
    return {"columns": [c.strftime("%Y-%m-%d") for c in df.columns], "rows": rows}
