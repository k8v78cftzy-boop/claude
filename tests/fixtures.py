"""Données synthétiques au format yfinance (pretty=False), valeurs choisies pour un calcul à la main."""
import numpy as np
import pandas as pd

DATES = pd.to_datetime(["2024-12-31", "2023-12-31", "2022-12-31"])

INCOME = {
    "TotalRevenue": [1000, 800, 700],
    "CostOfRevenue": [600, 500, 450],
    "GrossProfit": [400, 300, 250],
    "OperatingIncome": [200, 150, 120],
    "EBIT": [210, 155, 125],
    "EBITDA": [260, 200, 165],
    "InterestExpense": [20, 18, 15],
    "PretaxIncome": [190, 137, 110],
    "TaxProvision": [47.5, 34.25, 27.5],
    "NetIncome": [142.5, 102.75, 82.5],
    "NetIncomeCommonStockholders": [142.5, 102.75, 82.5],
    "DilutedEPS": [1.425, 1.0275, 0.825],
    "SellingGeneralAndAdministration": [150, 120, 100],
    "ResearchAndDevelopment": [50, 30, 30],
}
BALANCE = {
    "TotalAssets": [2000, 1800, 1600],
    "CurrentAssets": [800, 700, 600],
    "CurrentLiabilities": [400, 380, 350],
    "Inventory": [150, 140, 120],
    "AccountsReceivable": [200, 150, 140],
    "AccountsPayable": [100, 90, 80],
    "CashAndCashEquivalents": [250, 200, 150],
    "CashCashEquivalentsAndShortTermInvestments": [300, 240, 180],
    "TotalDebt": [500, 520, 540],
    "LongTermDebt": [400, 450, 470],
    "StockholdersEquity": [1000, 900, 800],
    "TotalLiabilitiesNetMinorityInterest": [1000, 900, 800],
    "RetainedEarnings": [600, 500, 420],
    "NetPPE": [700, 650, 600],
    "OrdinarySharesNumber": [100, 100, 102],
    "TangibleBookValue": [900, 800, 700],
}
CASHFLOW = {
    "OperatingCashFlow": [250, 180, 150],
    "CapitalExpenditure": [-100, -90, -80],
    "FreeCashFlow": [150, 90, 70],
    "DepreciationAndAmortization": [50, 45, 40],
    "CashDividendsPaid": [-50, -40, -35],
    "RepurchaseOfCapitalStock": [-30, 0, -10],
    "StockBasedCompensation": [10, 8, 7],
    "NetIssuancePaymentsOfDebt": [-20, -20, 10],
    "ChangeInWorkingCapital": [-10, -5, -5],
}


def frame(d, dates=DATES):
    return pd.DataFrame(d, index=dates).T.astype(float)


def price_history(n=800, seed=1, start=100.0, tz="America/New_York"):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2021-01-04", periods=n, tz=tz)
    close = start * np.cumprod(1 + rng.normal(0.0005, 0.015, n))
    high = close * (1 + rng.uniform(0, 0.01, n))
    low = close * (1 - rng.uniform(0, 0.01, n))
    open_ = low + (high - low) * rng.uniform(0, 1, n)
    vol = rng.integers(1_000_000, 5_000_000, n).astype(float)
    return pd.DataFrame({"Open": open_, "High": high, "Low": low, "Close": close, "Adj Close": close,
                         "Volume": vol, "Dividends": 0.0, "Stock Splits": 0.0}, index=idx)
