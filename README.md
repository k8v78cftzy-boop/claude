# FinAnalyse — analyse boursière et financière

Site web d'analyse d'actions façon Google Finance, enrichi de toutes les formules usuelles
d'**analyse financière**, de **marchés financiers** et de **finance d'entreprise**.
Chaque indicateur est affiché avec sa formule.

## Lancer le site

```bash
python -m venv .venv && source .venv/bin/activate   # Windows : .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Puis ouvrir <http://127.0.0.1:5000>. Les données viennent de Yahoo Finance (bibliothèque `yfinance`),
une connexion Internet est donc nécessaire. Toutes les places sont couvertes : `AAPL`, `MC.PA` (Paris),
`SAP.DE`, `7203.T`, indices (`^FCHI`), devises (`EURUSD=X`), crypto (`BTC-USD`)…

## Contenu

| Page / onglet | Contenu |
|---|---|
| Marchés | Indices mondiaux, taux, change, matières premières, liste de suivi |
| Graphique | Chandeliers/ligne, 1J à MAX, MM 20/50/200, MME 12/26, Bollinger, VWAP ; RSI, MACD, stochastique, ADX/DI, CCI, Williams %R, MFI, OBV, ATR, ROC |
| Valorisation | Capitalisation, VE, BPA, ANPA, PER, PEG, P/B, P/TBV, P/S, P/FCF, P/CFO, VE/EBITDA, VE/EBIT, VE/CA, VE/FCF, rendements (dividende, FCF, actionnarial), nombre de Graham, Q de Tobin |
| Ratios financiers (par exercice) | Marges, ROA, ROE, ROIC, ROCE, DuPont 3 et 5 facteurs, liquidité, solvabilité, couverture des intérêts, rotations, DIO/DSO/DPO, cycle de conversion, croissance, SGR/IGR, leviers DOL/DFL/DTL, FCF/FCFF/FCFE, accruals, distribution, TCAM |
| Scores | Altman Z et Z″, Piotroski F, Beneish M (8 variables), Springate |
| Risque & performance | Rendement, TCAM, volatilité, semi-écart-type, max drawdown, Ulcer, VaR/CVaR historiques et paramétriques, asymétrie, kurtosis, Sharpe, Sortino, Calmar, Omega, bêta, alpha de Jensen, R², Treynor, tracking error, ratio d'information, captures hausse/baisse |
| Analyse technique | Dernières valeurs, signaux, croisements MM50/MM200, points pivots, Fibonacci |
| Finance d'entreprise | MEDAF, CMPC, bêta de Hamada, DCF (FCFF) avec table de sensibilité, DCF inversé, Gordon-Shapiro, NOPAT, ROIC, EVA |
| États financiers | Compte de résultat, bilan, flux de trésorerie (annuels et trimestriels) |
| Comparateur | Jusqu'à 8 valeurs, base 100 et tableau de ratios |
| Calculatrices | VA/VF, annuités, emprunt, perpétuités, TAE/Fisher, VAN/TRI/TRIM/délai de récupération, obligations (prix, YTM, duration, convexité, DV01), Black-Scholes et grecques, binomial CRR, volatilité implicite, prix à terme, MEDAF/Sharpe/Treynor/M², Markowitz, VaR, Kelly, CMPC, Hamada/MM, DDM 2 étapes, Graham, EVA, point mort, EOQ |

## Conventions de calcul

- Rendements quotidiens simples sur cours ajustés (dividendes, divisions), 252 séances par an.
- Indicateurs techniques sur cours ajustés des seules divisions (comme les plateformes de trading).
- Ratios de rentabilité et de rotation sur la moyenne ouverture/clôture quand l'exercice précédent existe.
- Multiples de valorisation sur les 12 derniers mois (TTM) et le dernier bilan trimestriel si Yahoo les fournit, sinon sur le dernier exercice.
- Comptes publiés dans une autre devise que la cotation (ADR…) : conversion au taux de change Yahoo ; cotations en pence (GBp) ramenées en livres.
- Donnée manquante ou dénominateur nul : affichage « — », jamais de valeur inventée.
- Prime de risque et croissances du DCF : hypothèses modifiables dans l'interface.

## Tests

```bash
python -m pytest                      # formules Python (ratios, scores, risque, technique, API)
node --test tests/formulas.test.js    # formules JavaScript (Black-Scholes, obligations, TRI…)
```

Les formules sont vérifiées contre des valeurs de référence publiées (RSI de Wilder/StockCharts,
Black-Scholes de Hull, prix et duration d'obligations, exemple TRIM d'Excel…) et des calculs à la main.

*Informations fournies à titre indicatif, sans constituer un conseil en investissement.*
