/* Calculatrices de finance : définitions déclaratives rendues par renderCalculators(). */
(function (root) {
  'use strict';
  const F = root.FinFormulas;
  const Fm = root.Fmt;

  // type des champs : 'pct' saisi en %, 'num' nombre, 'int' entier, 'list' liste de nombres, 'select'
  const CALCS = [
    // ---------------- Valeur temps de l'argent ----------------
    {
      id: 'fv', group: 'Valeur temps de l\'argent', title: 'Valeur future / actuelle',
      formula: 'VF = VA × (1 + r)ⁿ   ·   VA = VF / (1 + r)ⁿ',
      inputs: [['pv', 'Valeur actuelle', 'num', 1000], ['r', 'Taux par période (%)', 'pct', 5], ['n', 'Nombre de périodes', 'num', 10]],
      compute: (v) => [['Valeur future', Fm.num(F.fv(v.pv, v.r, v.n))], ['Intérêts cumulés', Fm.num(F.fv(v.pv, v.r, v.n) - v.pv)],
        ['Valeur actuelle de la VF', Fm.num(F.pv(F.fv(v.pv, v.r, v.n), v.r, v.n))]],
    },
    {
      id: 'annuity', group: 'Valeur temps de l\'argent', title: 'Annuités constantes',
      formula: 'VA = a × [1 − (1 + r)⁻ⁿ] / r   ·   VF = a × [(1 + r)ⁿ − 1] / r   ·   (× (1 + r) si versement en début de période)',
      inputs: [['pmt', 'Annuité (a)', 'num', 100], ['r', 'Taux par période (%)', 'pct', 5], ['n', 'Nombre de périodes', 'num', 10],
        ['due', 'Versement', 'select', 'fin', [['fin', 'Fin de période'], ['debut', 'Début de période']]]],
      compute: (v) => [['Valeur actuelle', Fm.num(F.annuityPV(v.pmt, v.r, v.n, v.due === 'debut'))],
        ['Valeur future', Fm.num(F.annuityFV(v.pmt, v.r, v.n, v.due === 'debut'))]],
    },
    {
      id: 'loan', group: 'Valeur temps de l\'argent', title: 'Emprunt et tableau d\'amortissement',
      formula: 'Mensualité = K × i / [1 − (1 + i)⁻ⁿ],   i = taux annuel / 12',
      inputs: [['k', 'Capital emprunté', 'num', 200000], ['r', 'Taux annuel (%)', 'pct', 3.5], ['y', 'Durée (années)', 'num', 20]],
      compute: (v) => {
        const a = F.amortization(v.k, v.r, v.y, 12);
        const yearly = [];
        for (let y = 0; y < Math.ceil(a.rows.length / 12); y++) {
          const rows = a.rows.slice(y * 12, y * 12 + 12);
          yearly.push([y + 1, rows.reduce((s, r) => s + r.interest, 0), rows.reduce((s, r) => s + r.principal, 0), rows[rows.length - 1].balance]);
        }
        return {
          results: [['Mensualité', Fm.num(a.payment)], ['Total remboursé', Fm.num(a.totalPaid)], ['Coût total du crédit', Fm.num(a.totalInterest)]],
          table: { head: ['Année', 'Intérêts', 'Capital remboursé', 'Capital restant dû'], rows: yearly.map((r) => [r[0], Fm.num(r[1]), Fm.num(r[2]), Fm.num(r[3])]) },
        };
      },
    },
    {
      id: 'perp', group: 'Valeur temps de l\'argent', title: 'Rentes perpétuelles et croissantes',
      formula: 'Perpétuité : C / r   ·   Perpétuité croissante : C₁ / (r − g)   ·   Annuité croissante : C₁/(r − g) × [1 − ((1 + g)/(1 + r))ⁿ]',
      inputs: [['c', 'Flux C₁', 'num', 100], ['r', 'Taux (%)', 'pct', 8], ['g', 'Croissance g (%)', 'pct', 2], ['n', 'Durée n (annuité croissante)', 'num', 20]],
      compute: (v) => [['Perpétuité constante', Fm.num(F.perpetuity(v.c, v.r))], ['Perpétuité croissante', Fm.num(F.growingPerpetuity(v.c, v.r, v.g))],
        ['Annuité croissante', Fm.num(F.growingAnnuityPV(v.c, v.r, v.g, v.n))]],
    },
    {
      id: 'rates', group: 'Valeur temps de l\'argent', title: 'Taux effectif, continu et réel (Fisher)',
      formula: 'TAE = (1 + TAN/m)ᵐ − 1   ·   continu : eᵀᴬᴺ − 1   ·   réel = (1 + nominal)/(1 + inflation) − 1',
      inputs: [['apr', 'Taux nominal annuel (%)', 'pct', 6], ['m', 'Capitalisations par an', 'num', 12], ['inf', 'Inflation (%)', 'pct', 2]],
      compute: (v) => [['Taux effectif annuel', Fm.pct(F.effectiveAnnualRate(v.apr, v.m), 4)], ['Taux effectif (continu)', Fm.pct(F.continuousEAR(v.apr), 4)],
        ['Taux réel (Fisher exact)', Fm.pct(F.fisherReal(v.apr, v.inf), 4)], ['Taux réel (approx. r − π)', Fm.pct(v.apr - v.inf, 4)]],
    },
    // ---------------- Choix d'investissement ----------------
    {
      id: 'npv', group: 'Choix d\'investissement', title: 'VAN, TRI, TRIM, délai de récupération, IP',
      formula: 'VAN = Σ CFₜ / (1 + k)ᵗ   ·   TRI : VAN(TRI) = 0   ·   TRIM = (VF⁺ au taux de réinvestissement / VA⁻ au taux de financement)^(1/n) − 1   ·   IP = VA des flux futurs / |CF₀|',
      inputs: [['flows', 'Flux (t = 0, 1, 2, …) séparés par des points-virgules', 'list', '-1000; 300; 400; 500; 200'],
        ['k', 'Taux d\'actualisation (%)', 'pct', 8], ['fin', 'Taux de financement TRIM (%)', 'pct', 8], ['re', 'Taux de réinvestissement TRIM (%)', 'pct', 8]],
      compute: (v) => {
        const n = F.npv(v.k, v.flows);
        return [['VAN', Fm.num(n)], ['TRI', Fm.pct(F.irr(v.flows))], ['TRIM', Fm.pct(F.mirr(v.flows, v.fin, v.re))],
          ['Indice de profitabilité', Fm.num(F.profitabilityIndex(v.k, v.flows), 4)],
          ['Délai de récupération', Fm.num(F.payback(v.flows)) + ' périodes'], ['Délai de récupération actualisé', Fm.num(F.payback(v.flows, v.k)) + ' périodes'],
          ['Annuité équivalente (EAA)', Fm.num(F.equivalentAnnualAnnuity(n, v.k, v.flows.length - 1))]];
      },
    },
    // ---------------- Obligations ----------------
    {
      id: 'bond', group: 'Obligations', title: 'Prix, rendement, duration, convexité',
      formula: 'P = Σ C/(1 + y/f)ᵗ + N/(1 + y/f)ᵀ   ·   D_Mac = Σ t·VA(CFₜ) / P   ·   D_mod = D_Mac / (1 + y/f)   ·   ΔP/P ≈ −D_mod·Δy + ½·C·Δy²',
      inputs: [['face', 'Nominal', 'num', 1000], ['c', 'Taux de coupon annuel (%)', 'pct', 5], ['y', 'Rendement à l\'échéance (%)', 'pct', 6],
        ['m', 'Maturité (années)', 'num', 10], ['f', 'Coupons par an', 'select', '1', [['1', 'Annuel'], ['2', 'Semestriel'], ['4', 'Trimestriel'], ['12', 'Mensuel']]],
        ['dy', 'Choc de taux Δy (points de base)', 'num', 100]],
      compute: (v) => {
        const f = Number(v.f);
        const r = F.bondRisk(v.face, v.c, v.y, v.m, f);
        const dy = v.dy / 10000;
        const exact = F.bondPrice(v.face, v.c, v.y + dy, v.m, f) / r.price - 1;
        return [['Prix', Fm.num(r.price, 4)], ['Prix en % du nominal', Fm.pct(r.price / v.face, 3)], ['Rendement courant', Fm.pct(r.currentYield, 3)],
          ['Duration de Macaulay', Fm.num(r.macaulay, 4) + ' ans'], ['Duration modifiée', Fm.num(r.modified, 4)], ['Convexité', Fm.num(r.convexity, 4)],
          ['DV01 (valeur d\'un point de base)', Fm.num(r.dv01, 4)], ['ΔP estimé (duration + convexité)', Fm.signedPct(F.bondPriceChangeApprox(r.modified, r.convexity, dy), 3)],
          ['ΔP exact', Fm.signedPct(exact, 3)]];
      },
    },
    {
      id: 'ytm', group: 'Obligations', title: 'Rendement actuariel à partir du prix',
      formula: 'y tel que Σ C/(1 + y/f)ᵗ + N/(1 + y/f)ᵀ = Prix (résolution numérique)',
      inputs: [['p', 'Prix', 'num', 950], ['face', 'Nominal', 'num', 1000], ['c', 'Taux de coupon (%)', 'pct', 4], ['m', 'Maturité (années)', 'num', 7],
        ['f', 'Coupons par an', 'select', '1', [['1', 'Annuel'], ['2', 'Semestriel'], ['4', 'Trimestriel']]]],
      compute: (v) => {
        const y = F.bondYTM(v.p, v.face, v.c, v.m, Number(v.f));
        return [['Rendement à l\'échéance (YTM)', Fm.pct(y, 4)], ['Rendement courant', Fm.pct(v.face * v.c / v.p, 4)]];
      },
    },
    // ---------------- Options ----------------
    {
      id: 'bs', group: 'Produits dérivés', title: 'Black-Scholes-Merton et grecques',
      formula: 'C = S·e^(−qT)·N(d₁) − K·e^(−rT)·N(d₂)   ·   P = K·e^(−rT)·N(−d₂) − S·e^(−qT)·N(−d₁)   ·   d₁ = [ln(S/K) + (r − q + σ²/2)T] / (σ√T),  d₂ = d₁ − σ√T',
      inputs: [['S', 'Cours du sous-jacent', 'num', 100], ['K', 'Prix d\'exercice', 'num', 100], ['T', 'Maturité (années)', 'num', 1],
        ['r', 'Taux sans risque (%)', 'pct', 5], ['s', 'Volatilité (%)', 'pct', 20], ['q', 'Rendement du dividende (%)', 'pct', 0]],
      compute: (v) => {
        const b = F.blackScholes(v.S, v.K, v.T, v.r, v.s, v.q);
        return {
          results: [['Call', Fm.num(b.call, 4)], ['Put', Fm.num(b.put, 4)], ['d₁', Fm.num(b.d1, 4)], ['d₂', Fm.num(b.d2, 4)],
            ['Parité call-put (écart)', Fm.num(b.parity, 10)]],
          table: {
            head: ['Grecque', 'Call', 'Put'], rows: [
              ['Delta', Fm.num(b.delta.call, 4), Fm.num(b.delta.put, 4)], ['Gamma', Fm.num(b.gamma, 5), Fm.num(b.gamma, 5)],
              ['Véga (pour 1 % de vol.)', Fm.num(b.vega, 4), Fm.num(b.vega, 4)], ['Thêta (par jour)', Fm.num(b.theta.call, 4), Fm.num(b.theta.put, 4)],
              ['Rho (pour 1 % de taux)', Fm.num(b.rho.call, 4), Fm.num(b.rho.put, 4)]],
          },
        };
      },
    },
    {
      id: 'binomial', group: 'Produits dérivés', title: 'Arbre binomial (Cox-Ross-Rubinstein)',
      formula: 'u = e^(σ√Δt),  d = 1/u,  p = (e^((r − q)Δt) − d)/(u − d) ; valeur = e^(−rΔt)[p·Vᵤ + (1 − p)·V_d] (exercice anticipé testé à chaque nœud pour l\'américaine)',
      inputs: [['S', 'Cours', 'num', 100], ['K', 'Prix d\'exercice', 'num', 100], ['T', 'Maturité (années)', 'num', 1], ['r', 'Taux sans risque (%)', 'pct', 5],
        ['s', 'Volatilité (%)', 'pct', 20], ['q', 'Dividende continu (%)', 'pct', 0], ['n', 'Nombre de pas', 'num', 500]],
      compute: (v) => {
        const n = Math.max(1, Math.min(5000, Math.round(v.n)));
        return [['Call européen', Fm.num(F.binomial(v.S, v.K, v.T, v.r, v.s, n, 'call', false, v.q), 4)],
          ['Put européen', Fm.num(F.binomial(v.S, v.K, v.T, v.r, v.s, n, 'put', false, v.q), 4)],
          ['Call américain', Fm.num(F.binomial(v.S, v.K, v.T, v.r, v.s, n, 'call', true, v.q), 4)],
          ['Put américain', Fm.num(F.binomial(v.S, v.K, v.T, v.r, v.s, n, 'put', true, v.q), 4)]];
      },
    },
    {
      id: 'iv', group: 'Produits dérivés', title: 'Volatilité implicite',
      formula: 'σ implicite tel que BSM(σ) = prix de marché de l\'option',
      inputs: [['p', 'Prix de l\'option', 'num', 10], ['S', 'Cours', 'num', 100], ['K', 'Prix d\'exercice', 'num', 100], ['T', 'Maturité (années)', 'num', 1],
        ['r', 'Taux sans risque (%)', 'pct', 5], ['q', 'Dividende continu (%)', 'pct', 0], ['type', 'Type', 'select', 'call', [['call', 'Call'], ['put', 'Put']]]],
      compute: (v) => [['Volatilité implicite', Fm.pct(F.impliedVol(v.p, v.S, v.K, v.T, v.r, v.type, v.q), 3)]],
    },
    {
      id: 'forward', group: 'Produits dérivés', title: 'Prix à terme',
      formula: 'F = S·e^((r − q)T)   ·   Change à terme (parité des taux) : F = S × (1 + i_dom)ᵀ / (1 + i_étr)ᵀ',
      inputs: [['S', 'Cours / spot', 'num', 100], ['r', 'Taux domestique (%)', 'pct', 4], ['q', 'Rendement du sous-jacent ou taux étranger (%)', 'pct', 1], ['T', 'Maturité (années)', 'num', 1]],
      compute: (v) => [['Prix à terme (capitalisation continue)', Fm.num(F.forwardPrice(v.S, v.r, v.T, v.q), 4)],
        ['Change à terme (taux actuariels)', Fm.num(F.fxForward(v.S, v.r, v.q, v.T), 4)]],
    },
    // ---------------- Marchés et portefeuille ----------------
    {
      id: 'capm', group: 'Marchés et portefeuille', title: 'MEDAF (CAPM) et mesures de performance',
      formula: 'E(Rᵢ) = r_f + βᵢ[E(R_m) − r_f]   ·   Sharpe = (R − r_f)/σ   ·   Treynor = (R − r_f)/β   ·   α de Jensen = R − E(R)   ·   M² = r_f + Sharpe × σ_m',
      inputs: [['rf', 'Taux sans risque (%)', 'pct', 3], ['beta', 'Bêta', 'num', 1.2], ['rm', 'Rendement attendu du marché (%)', 'pct', 8],
        ['r', 'Rendement du portefeuille (%)', 'pct', 11], ['s', 'Volatilité du portefeuille (%)', 'pct', 18], ['sm', 'Volatilité du marché (%)', 'pct', 15]],
      compute: (v) => [['Rendement exigé (MEDAF)', Fm.pct(F.capm(v.rf, v.beta, v.rm))], ['Prime de risque du marché', Fm.pct(v.rm - v.rf)],
        ['Ratio de Sharpe', Fm.num(F.sharpe(v.r, v.rf, v.s), 3)], ['Ratio de Treynor', Fm.num(F.treynor(v.r, v.rf, v.beta), 4)],
        ['Alpha de Jensen', Fm.pct(F.jensenAlpha(v.r, v.rf, v.beta, v.rm))], ['M² de Modigliani', Fm.pct(F.m2(v.r, v.rf, v.s, v.sm))]],
    },
    {
      id: 'portfolio', group: 'Marchés et portefeuille', title: 'Portefeuille à deux actifs (Markowitz)',
      formula: 'E(Rₚ) = w₁E₁ + w₂E₂   ·   σₚ² = w₁²σ₁² + w₂²σ₂² + 2w₁w₂ρσ₁σ₂   ·   w₁* (variance minimale) = (σ₂² − ρσ₁σ₂)/(σ₁² + σ₂² − 2ρσ₁σ₂)',
      inputs: [['w', 'Poids de l\'actif 1 (%)', 'pct', 60], ['e1', 'Rendement attendu 1 (%)', 'pct', 9], ['s1', 'Volatilité 1 (%)', 'pct', 20],
        ['e2', 'Rendement attendu 2 (%)', 'pct', 4], ['s2', 'Volatilité 2 (%)', 'pct', 7], ['rho', 'Corrélation ρ', 'num', 0.2]],
      compute: (v) => {
        const p = F.twoAssetPortfolio(v.w, v.e1, v.s1, v.e2, v.s2, v.rho);
        const pm = F.twoAssetPortfolio(p.minVarianceWeight1, v.e1, v.s1, v.e2, v.s2, v.rho);
        return [['Rendement attendu', Fm.pct(p.expected)], ['Volatilité', Fm.pct(p.volatility)],
          ['Poids actif 1 (variance minimale)', Fm.pct(p.minVarianceWeight1)], ['Volatilité minimale', Fm.pct(pm.volatility)], ['Rendement au point de variance minimale', Fm.pct(pm.expected)]];
      },
    },
    {
      id: 'var', group: 'Marchés et portefeuille', title: 'Value at Risk paramétrique',
      formula: 'VaR = V × z_α × σ_annuelle × √(jours / 252)',
      inputs: [['V', 'Valeur du portefeuille', 'num', 1000000], ['s', 'Volatilité annuelle (%)', 'pct', 20], ['d', 'Horizon (jours de bourse)', 'num', 10],
        ['c', 'Niveau de confiance', 'select', '0.99', [['0.9', '90 %'], ['0.95', '95 %'], ['0.975', '97,5 %'], ['0.99', '99 %']]]],
      compute: (v) => [['z', Fm.num(F.normInv(Number(v.c)), 4)], ['VaR', Fm.num(F.parametricVaR(v.V, v.s, v.d, Number(v.c)))]],
    },
    {
      id: 'kelly', group: 'Marchés et portefeuille', title: 'Critère de Kelly',
      formula: 'f* = p − (1 − p)/b   (b = gain net pour 1 misé)',
      inputs: [['p', 'Probabilité de gain (%)', 'pct', 55], ['b', 'Gain net / mise', 'num', 1]],
      compute: (v) => [['Fraction optimale f*', Fm.pct(F.kelly(v.p, v.b))], ['Demi-Kelly', Fm.pct(F.kelly(v.p, v.b) / 2)]],
    },
    // ---------------- Finance d'entreprise ----------------
    {
      id: 'wacc', group: 'Finance d\'entreprise', title: 'CMPC (WACC)',
      formula: 'CMPC = E/(D + E) × k_e + D/(D + E) × k_d × (1 − t)   ·   k_e = r_f + β × PRM',
      inputs: [['E', 'Capitaux propres (valeur de marché)', 'num', 600], ['D', 'Dette', 'num', 400], ['rf', 'Taux sans risque (%)', 'pct', 3.5],
        ['beta', 'Bêta', 'num', 1.1], ['erp', 'Prime de risque du marché (%)', 'pct', 5.5], ['kd', 'Coût de la dette avant impôt (%)', 'pct', 5], ['t', 'Taux d\'impôt (%)', 'pct', 25]],
      compute: (v) => {
        const ke = F.capmFromPremium(v.rf, v.beta, v.erp);
        return [['Coût des fonds propres k_e', Fm.pct(ke)], ['Coût de la dette après impôt', Fm.pct(v.kd * (1 - v.t))],
          ['Poids fonds propres', Fm.pct(v.E / (v.E + v.D))], ['CMPC', Fm.pct(F.wacc(v.E, v.D, ke, v.kd, v.t))]];
      },
    },
    {
      id: 'hamada', group: 'Finance d\'entreprise', title: 'Bêta désendetté / réendetté (Hamada) et Modigliani-Miller',
      formula: 'β_U = β_L / [1 + (1 − t)·D/E]   ·   β_L = β_U × [1 + (1 − t)·D/E]   ·   MM avec impôt : V_L = V_U + t × D',
      inputs: [['bl', 'Bêta endetté actuel', 'num', 1.3], ['D', 'Dette actuelle', 'num', 300], ['E', 'Capitaux propres actuels', 'num', 700],
        ['t', 'Taux d\'impôt (%)', 'pct', 25], ['D2', 'Dette cible', 'num', 500], ['E2', 'Capitaux propres cibles', 'num', 500], ['vu', 'Valeur non endettée V_U', 'num', 1000]],
      compute: (v) => {
        const bu = F.unleverBeta(v.bl, v.D, v.E, v.t);
        return [['Bêta de l\'actif β_U', Fm.num(bu, 4)], ['Bêta réendetté (structure cible)', Fm.num(F.releverBeta(bu, v.D2, v.E2, v.t), 4)],
          ['Valeur endettée V_L (MM)', Fm.num(F.mmLeveredValue(v.vu, v.t, v.D))], ['Valeur de l\'économie d\'impôt', Fm.num(v.t * v.D)]];
      },
    },
    {
      id: 'ddm', group: 'Finance d\'entreprise', title: 'Modèle de Gordon-Shapiro et DDM à deux étapes',
      formula: 'P₀ = D₁/(k − g) = D₀(1 + g)/(k − g)   ·   k implicite = D₁/P₀ + g   ·   2 étapes : Σ Dₜ/(1 + k)ᵗ + [Dₙ(1 + g₂)/(k − g₂)]/(1 + k)ⁿ',
      inputs: [['d0', 'Dernier dividende D₀', 'num', 2], ['k', 'Rendement exigé k (%)', 'pct', 8], ['g', 'Croissance perpétuelle g (%)', 'pct', 3],
        ['g1', 'Croissance 1re étape g₁ (%)', 'pct', 10], ['n', 'Durée 1re étape (ans)', 'num', 5], ['p', 'Cours actuel (pour k implicite)', 'num', 40]],
      compute: (v) => [['Valeur (Gordon)', Fm.num(F.gordon(v.d0, v.k, v.g))], ['Valeur (2 étapes)', Fm.num(F.twoStageDDM(v.d0, v.k, v.g1, v.n, v.g))],
        ['Coût implicite des fonds propres', Fm.pct(F.impliedCostOfEquity(v.d0 * (1 + v.g), v.p, v.g))], ['Rendement du dividende attendu', Fm.pct(v.d0 * (1 + v.g) / v.p)]],
    },
    {
      id: 'graham', group: 'Finance d\'entreprise', title: 'Formules de Benjamin Graham',
      formula: 'Valeur = BPA × (8,5 + 2g) × 4,4 / Y   (g en %, Y = rendement AAA en %)   ·   Nombre de Graham = √(22,5 × BPA × ANPA)',
      inputs: [['eps', 'BPA', 'num', 5], ['g', 'Croissance attendue 7–10 ans (%)', 'pct', 6], ['y', 'Rendement des obligations AAA (%)', 'pct', 5], ['bv', 'Actif net par action', 'num', 30]],
      compute: (v) => [['Valeur intrinsèque (Graham révisée)', Fm.num(F.grahamValue(v.eps, v.g, v.y))], ['Nombre de Graham', Fm.num(F.grahamNumber(v.eps, v.bv))]],
    },
    {
      id: 'eva', group: 'Finance d\'entreprise', title: 'EVA / création de valeur',
      formula: 'EVA = NOPAT − CMPC × Capitaux investis   ·   NOPAT = EBIT × (1 − t)   ·   Spread = ROIC − CMPC',
      inputs: [['ebit', 'EBIT', 'num', 150], ['t', 'Taux d\'impôt (%)', 'pct', 25], ['ic', 'Capitaux investis', 'num', 900], ['w', 'CMPC (%)', 'pct', 8]],
      compute: (v) => {
        const nopat = v.ebit * (1 - v.t);
        return [['NOPAT', Fm.num(nopat)], ['ROIC', Fm.pct(nopat / v.ic)], ['Spread ROIC − CMPC', Fm.pct(nopat / v.ic - v.w)], ['EVA', Fm.num(F.eva(nopat, v.w, v.ic))]];
      },
    },
    {
      id: 'breakeven', group: 'Finance d\'entreprise', title: 'Seuil de rentabilité et levier opérationnel',
      formula: 'Q* = Coûts fixes / (Prix − Coût variable unitaire)   ·   DOL = Q(P − CV) / [Q(P − CV) − CF]',
      inputs: [['cf', 'Coûts fixes', 'num', 100000], ['p', 'Prix unitaire', 'num', 50], ['cv', 'Coût variable unitaire', 'num', 30], ['q', 'Volume actuel', 'num', 8000]],
      compute: (v) => [['Seuil (unités)', Fm.num(F.breakEvenUnits(v.cf, v.p, v.cv))], ['Seuil (chiffre d\'affaires)', Fm.num(F.breakEvenUnits(v.cf, v.p, v.cv) * v.p)],
        ['Taux de marge sur coûts variables', Fm.pct((v.p - v.cv) / v.p)], ['Levier opérationnel au volume actuel', Fm.num(F.dolAt(v.q, v.p, v.cv, v.cf), 3)],
        ['Marge de sécurité', Fm.pct(1 - F.breakEvenUnits(v.cf, v.p, v.cv) / v.q)]],
    },
    {
      id: 'eoq', group: 'Finance d\'entreprise', title: 'Quantité économique de commande (Wilson)',
      formula: 'EOQ = √(2 × D × S / H)',
      inputs: [['d', 'Demande annuelle', 'num', 12000], ['s', 'Coût de passation par commande', 'num', 80], ['h', 'Coût de possession unitaire annuel', 'num', 4]],
      compute: (v) => {
        const q = F.eoq(v.d, v.s, v.h);
        return [['Quantité optimale', Fm.num(q)], ['Nombre de commandes par an', Fm.num(v.d / q)], ['Coût total annuel', Fm.num(v.d / q * v.s + q / 2 * v.h)]];
      },
    },
  ];

  function readInputs(calc, form) {
    const v = {};
    for (const [key, , type] of calc.inputs) {
      const el = form.elements[key];
      if (type === 'select') v[key] = el.value;
      else if (type === 'list') v[key] = el.value.split(/[;\n]+/).map((s) => Number(s.trim().replace(',', '.'))).filter((x) => isFinite(x));
      else {
        const x = Number(String(el.value).replace(',', '.'));
        v[key] = type === 'pct' ? x / 100 : x;
      }
    }
    return v;
  }

  function renderCalc(calc, container) {
    const E = Fm.esc;
    container.innerHTML = `
      <h2>${E(calc.title)}</h2>
      <div class="formula-box">${E(calc.formula)}</div>
      <form class="form-grid" autocomplete="off">
        ${calc.inputs.map(([k, label, type, def, opts]) => `
          <label class="field" ${type === 'list' ? 'style="grid-column:1/-1"' : ''}>${E(label)}
            ${type === 'select'
    ? `<select name="${k}">${opts.map(([val, txt]) => `<option value="${E(val)}" ${val === def ? 'selected' : ''}>${E(txt)}</option>`).join('')}</select>`
    : `<input name="${k}" type="${type === 'list' ? 'text' : 'number'}" step="any" value="${E(def)}">`}
          </label>`).join('')}
      </form>
      <div class="result-grid"></div>
      <div class="calc-table table-wrap"></div>`;
    const form = container.querySelector('form');
    const update = () => {
      let out;
      try { out = calc.compute(readInputs(calc, form)); } catch (e) { out = [['Erreur', e.message]]; }
      const results = Array.isArray(out) ? out : out.results;
      container.querySelector('.result-grid').innerHTML = results.map(([l, val]) =>
        `<div class="kpi"><div class="k-label">${E(l)}</div><div class="k-value">${E(val)}</div></div>`).join('');
      const t = Array.isArray(out) ? null : out.table;
      container.querySelector('.calc-table').innerHTML = t ? `<table class="compact"><thead><tr>${t.head.map((h, i) => `<th class="${i ? 'num' : ''}">${E(h)}</th>`).join('')}</tr></thead>
        <tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'num' : ''}">${E(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';
    };
    form.addEventListener('input', update);
    update();
  }

  function renderCalculators(root, selected) {
    const groups = [...new Set(CALCS.map((c) => c.group))];
    const current = CALCS.find((c) => c.id === selected) || CALCS[0];
    root.innerHTML = `
      <div class="hero"><h1>Calculatrices financières</h1>
      <p class="muted">Mathématiques financières, obligations, dérivés, gestion de portefeuille et finance d'entreprise. Les résultats se mettent à jour à chaque saisie.</p></div>
      <div class="calc-layout">
        <nav class="calc-menu">${groups.map((g) => `<div class="grp">${Fm.esc(g)}</div>` +
          CALCS.filter((c) => c.group === g).map((c) => `<button data-id="${c.id}" class="${c.id === current.id ? 'active' : ''}">${Fm.esc(c.title)}</button>`).join('')).join('')}
        </nav>
        <section class="card calc-body"></section>
      </div>`;
    root.querySelectorAll('.calc-menu button').forEach((b) => b.addEventListener('click', () => {
      location.hash = '#/calculators/' + b.dataset.id;
    }));
    renderCalc(current, root.querySelector('.calc-body'));
  }

  root.Calculators = { CALCS, renderCalculators };
})(typeof self !== 'undefined' ? self : this);
