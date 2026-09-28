/*
 * Bibliothèque de formules financières (sans dépendance).
 * Utilisable dans le navigateur (window.FinFormulas) et dans Node (require) pour les tests.
 * Conventions : taux en décimal (0.05 = 5 %), durées en années sauf mention contraire.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FinFormulas = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------
  // Loi normale
  // ------------------------------------------------------------------

  /** Fonction de répartition de la loi normale centrée réduite (algorithme de Hart, précision double). */
  function normCdf(x) {
    const z = Math.abs(x);
    let c;
    if (z > 37) {
      c = 0;
    } else {
      const e = Math.exp(-z * z / 2);
      if (z < 7.07106781186547) {
        let n = 3.52624965998911e-2 * z + 0.700383064443688;
        n = n * z + 6.37396220353165;
        n = n * z + 33.912866078383;
        n = n * z + 112.079291497871;
        n = n * z + 221.213596169931;
        n = n * z + 220.206867912376;
        let d = 8.83883476483184e-2 * z + 1.75566716318264;
        d = d * z + 16.064177579207;
        d = d * z + 86.7807322029461;
        d = d * z + 296.564248779674;
        d = d * z + 637.333633378831;
        d = d * z + 793.826512519948;
        d = d * z + 440.413735824752;
        c = e * n / d;
      } else {
        let f = z + 0.65;
        f = z + 4 / f;
        f = z + 3 / f;
        f = z + 2 / f;
        f = z + 1 / f;
        c = e / f / 2.506628274631;
      }
    }
    return x <= 0 ? c : 1 - c;
  }

  /** Densité de la loi normale centrée réduite. */
  function normPdf(x) {
    return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  }

  /** Quantile de la loi normale (algorithme d'Acklam affiné par une itération de Newton). */
  function normInv(p) {
    if (!(p > 0 && p < 1)) return NaN;
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
      -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
      -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
      4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    let q, r, x;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= 1 - pl) {
      q = p - 0.5;
      r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    // raffinement de Newton
    const e = normCdf(x) - p;
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  }

  /** Recherche d'une racine par dichotomie sur [lo, hi]. */
  function bisect(f, lo, hi, tol = 1e-12, maxIter = 500) {
    let flo = f(lo);
    const fhi = f(hi);
    if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return NaN;
    for (let i = 0; i < maxIter; i++) {
      const mid = (lo + hi) / 2;
      const fm = f(mid);
      if (fm === 0 || (hi - lo) / 2 < tol) return mid;
      if (fm * flo < 0) hi = mid;
      else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  // ------------------------------------------------------------------
  // Valeur temps de l'argent
  // ------------------------------------------------------------------

  const fv = (pv, r, n) => pv * Math.pow(1 + r, n);
  const pv = (fvv, r, n) => fvv / Math.pow(1 + r, n);
  const annuityPV = (pmt, r, n, due = false) =>
    (r === 0 ? pmt * n : pmt * (1 - Math.pow(1 + r, -n)) / r) * (due ? 1 + r : 1);
  const annuityFV = (pmt, r, n, due = false) =>
    (r === 0 ? pmt * n : pmt * (Math.pow(1 + r, n) - 1) / r) * (due ? 1 + r : 1);
  const payment = (principal, r, n) => (r === 0 ? principal / n : principal * r / (1 - Math.pow(1 + r, -n)));
  const perpetuity = (c, r) => c / r;
  const growingPerpetuity = (c1, r, g) => (r > g ? c1 / (r - g) : NaN);
  const growingAnnuityPV = (c1, r, g, n) =>
    (r === g ? c1 * n / (1 + r) : c1 / (r - g) * (1 - Math.pow((1 + g) / (1 + r), n)));
  const effectiveAnnualRate = (apr, m) => Math.pow(1 + apr / m, m) - 1;
  const continuousEAR = (apr) => Math.exp(apr) - 1;
  const fisherReal = (nominal, inflation) => (1 + nominal) / (1 + inflation) - 1;

  /** Tableau d'amortissement d'un prêt à mensualités constantes. */
  function amortization(principal, annualRate, years, perYear = 12) {
    const n = Math.round(years * perYear);
    const r = annualRate / perYear;
    const pmt = payment(principal, r, n);
    const rows = [];
    let bal = principal;
    for (let k = 1; k <= n; k++) {
      const interest = bal * r;
      const princ = pmt - interest;
      bal -= princ;
      rows.push({ period: k, payment: pmt, interest, principal: princ, balance: Math.abs(bal) < 1e-7 ? 0 : bal });
    }
    return { payment: pmt, totalPaid: pmt * n, totalInterest: pmt * n - principal, rows };
  }

  // ------------------------------------------------------------------
  // Choix d'investissement
  // ------------------------------------------------------------------

  /** VAN : flux[0] à t = 0 (généralement négatif). */
  function npv(rate, flows) {
    return flows.reduce((s, cf, t) => s + cf / Math.pow(1 + rate, t), 0);
  }

  /** TRI : racine de la VAN, recherchée par balayage puis dichotomie. */
  function irr(flows) {
    const f = (r) => npv(r, flows);
    const grid = [-0.9999, -0.99, -0.9, -0.75, -0.5, -0.25, -0.1, 0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 3,
      5, 10, 25, 100];
    for (let i = 0; i < grid.length - 1; i++) {
      const a = f(grid[i]);
      const b = f(grid[i + 1]);
      if (a === 0) return grid[i];
      if (a * b < 0) return bisect(f, grid[i], grid[i + 1]);
    }
    return NaN;
  }

  /** TRI modifié : (VF des flux positifs au taux de réinvestissement / VA des flux négatifs au taux de financement)^(1/n) − 1. */
  function mirr(flows, financeRate, reinvestRate) {
    const n = flows.length - 1;
    let pvNeg = 0;
    let fvPos = 0;
    flows.forEach((cf, t) => {
      if (cf < 0) pvNeg += cf / Math.pow(1 + financeRate, t);
      else fvPos += cf * Math.pow(1 + reinvestRate, n - t);
    });
    if (pvNeg === 0 || n <= 0) return NaN;
    return Math.pow(fvPos / -pvNeg, 1 / n) - 1;
  }

  /** Délai de récupération (interpolation linéaire dans l'année de récupération). */
  function payback(flows, rate = null) {
    let cum = 0;
    for (let t = 0; t < flows.length; t++) {
      const cf = rate === null ? flows[t] : flows[t] / Math.pow(1 + rate, t);
      const prev = cum;
      cum += cf;
      if (t > 0 && prev < 0 && cum >= 0) return t - 1 + (-prev) / cf;
    }
    return NaN;
  }

  const profitabilityIndex = (rate, flows) => (npv(rate, flows) - flows[0]) / Math.abs(flows[0]);
  const equivalentAnnualAnnuity = (npvValue, r, n) => npvValue * r / (1 - Math.pow(1 + r, -n));

  // ------------------------------------------------------------------
  // Obligations
  // ------------------------------------------------------------------

  function bondCashflows(face, couponRate, years, freq) {
    const n = Math.round(years * freq);
    const c = face * couponRate / freq;
    const flows = [];
    for (let t = 1; t <= n; t++) flows.push(t === n ? c + face : c);
    return flows;
  }

  function bondPrice(face, couponRate, ytm, years, freq = 1) {
    const y = ytm / freq;
    return bondCashflows(face, couponRate, years, freq).reduce((s, cf, i) => s + cf / Math.pow(1 + y, i + 1), 0);
  }

  function bondYTM(price, face, couponRate, years, freq = 1) {
    return bisect((y) => bondPrice(face, couponRate, y, years, freq) - price, -0.99 * freq, 10);
  }

  /** Duration de Macaulay (années), duration modifiée, convexité (années²), DV01. */
  function bondRisk(face, couponRate, ytm, years, freq = 1) {
    const y = ytm / freq;
    const flows = bondCashflows(face, couponRate, years, freq);
    let price = 0;
    let wt = 0;
    let conv = 0;
    flows.forEach((cf, i) => {
      const t = i + 1;
      const disc = cf / Math.pow(1 + y, t);
      price += disc;
      wt += t * disc;
      conv += cf * t * (t + 1) / Math.pow(1 + y, t + 2);
    });
    const macaulay = wt / price / freq;
    const modified = macaulay / (1 + y);
    const convexity = conv / (price * freq * freq);
    return {
      price,
      currentYield: face * couponRate / price,
      macaulay,
      modified,
      convexity,
      dv01: modified * price * 0.0001,
    };
  }

  /** Variation de prix estimée : −Dmod × Δy + ½ × Convexité × Δy². */
  const bondPriceChangeApprox = (modified, convexity, dy) => -modified * dy + 0.5 * convexity * dy * dy;

  // ------------------------------------------------------------------
  // Options
  // ------------------------------------------------------------------

  /** Black-Scholes-Merton avec rendement de dividende continu q. Grecques : véga et rho pour 1 point (1 %), thêta par jour calendaire. */
  function blackScholes(S, K, T, r, sigma, q = 0) {
    const sq = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r - q + sigma * sigma / 2) * T) / (sigma * sq);
    const d2 = d1 - sigma * sq;
    const dq = Math.exp(-q * T);
    const dr = Math.exp(-r * T);
    const call = S * dq * normCdf(d1) - K * dr * normCdf(d2);
    const put = K * dr * normCdf(-d2) - S * dq * normCdf(-d1);
    const pdf = normPdf(d1);
    const gamma = dq * pdf / (S * sigma * sq);
    const vega = S * dq * pdf * sq;
    const thetaCall = -S * dq * pdf * sigma / (2 * sq) - r * K * dr * normCdf(d2) + q * S * dq * normCdf(d1);
    const thetaPut = -S * dq * pdf * sigma / (2 * sq) + r * K * dr * normCdf(-d2) - q * S * dq * normCdf(-d1);
    return {
      d1, d2, call, put,
      delta: { call: dq * normCdf(d1), put: -dq * normCdf(-d1) },
      gamma,
      vega: vega / 100,
      theta: { call: thetaCall / 365, put: thetaPut / 365 },
      rho: { call: K * T * dr * normCdf(d2) / 100, put: -K * T * dr * normCdf(-d2) / 100 },
      parity: call - put - (S * dq - K * dr),
    };
  }

  function impliedVol(price, S, K, T, r, type = 'call', q = 0) {
    const f = (s) => blackScholes(S, K, T, r, s, q)[type] - price;
    return bisect(f, 1e-6, 5);
  }

  /** Arbre binomial de Cox-Ross-Rubinstein (européenne ou américaine). */
  function binomial(S, K, T, r, sigma, steps = 200, type = 'call', american = false, q = 0) {
    const dt = T / steps;
    const u = Math.exp(sigma * Math.sqrt(dt));
    const d = 1 / u;
    const p = (Math.exp((r - q) * dt) - d) / (u - d);
    const disc = Math.exp(-r * dt);
    const payoff = (s) => (type === 'call' ? Math.max(s - K, 0) : Math.max(K - s, 0));
    let values = [];
    for (let i = 0; i <= steps; i++) values.push(payoff(S * Math.pow(u, steps - i) * Math.pow(d, i)));
    for (let j = steps - 1; j >= 0; j--) {
      const next = [];
      for (let i = 0; i <= j; i++) {
        let v = disc * (p * values[i] + (1 - p) * values[i + 1]);
        if (american) v = Math.max(v, payoff(S * Math.pow(u, j - i) * Math.pow(d, i)));
        next.push(v);
      }
      values = next;
    }
    return values[0];
  }

  // ------------------------------------------------------------------
  // Marchés et portefeuille
  // ------------------------------------------------------------------

  const capm = (rf, beta, marketReturn) => rf + beta * (marketReturn - rf);
  const capmFromPremium = (rf, beta, erp) => rf + beta * erp;
  const sharpe = (ret, rf, vol) => (ret - rf) / vol;
  const treynor = (ret, rf, beta) => (ret - rf) / beta;
  const jensenAlpha = (ret, rf, beta, marketReturn) => ret - capm(rf, beta, marketReturn);
  const m2 = (ret, rf, vol, marketVol) => rf + (ret - rf) / vol * marketVol;

  function twoAssetPortfolio(w1, e1, s1, e2, s2, rho) {
    const w2 = 1 - w1;
    const variance = w1 * w1 * s1 * s1 + w2 * w2 * s2 * s2 + 2 * w1 * w2 * rho * s1 * s2;
    const denom = s1 * s1 + s2 * s2 - 2 * rho * s1 * s2;
    const wMin = denom === 0 ? NaN : (s2 * s2 - rho * s1 * s2) / denom;
    return { expected: w1 * e1 + w2 * e2, volatility: Math.sqrt(variance), variance, minVarianceWeight1: wMin };
  }

  const kelly = (p, b) => p - (1 - p) / b;
  const forwardPrice = (S, r, T, q = 0) => S * Math.exp((r - q) * T);
  const fxForward = (spot, domesticRate, foreignRate, T) => spot * Math.pow(1 + domesticRate, T) / Math.pow(1 + foreignRate, T);
  const parametricVaR = (value, vol, days, confidence) => value * normInv(confidence) * vol * Math.sqrt(days / 252);

  // ------------------------------------------------------------------
  // Finance d'entreprise
  // ------------------------------------------------------------------

  const wacc = (E, D, ke, kd, tax) => (E / (E + D)) * ke + (D / (E + D)) * kd * (1 - tax);
  const unleverBeta = (betaL, D, E, tax) => betaL / (1 + (1 - tax) * D / E);
  const releverBeta = (betaU, D, E, tax) => betaU * (1 + (1 - tax) * D / E);
  const mmLeveredValue = (vu, tax, debt) => vu + tax * debt;
  const gordon = (d0, k, g) => (k > g ? d0 * (1 + g) / (k - g) : NaN);
  const impliedCostOfEquity = (d1, price, g) => d1 / price + g;
  const grahamValue = (eps, g, aaaYield) => eps * (8.5 + 2 * g * 100) * 4.4 / (aaaYield * 100);
  const grahamNumber = (eps, bvps) => (eps > 0 && bvps > 0 ? Math.sqrt(22.5 * eps * bvps) : NaN);
  const eva = (nopat, waccRate, investedCapital) => nopat - waccRate * investedCapital;
  const breakEvenUnits = (fixed, price, variable) => fixed / (price - variable);
  const dolAt = (q, price, variable, fixed) => q * (price - variable) / (q * (price - variable) - fixed);
  const eoq = (annualDemand, orderCost, holdingCost) => Math.sqrt(2 * annualDemand * orderCost / holdingCost);

  /** DDM à deux étapes : croissance g1 pendant n ans, puis g2 à perpétuité. */
  function twoStageDDM(d0, k, g1, n, g2) {
    let value = 0;
    let d = d0;
    for (let t = 1; t <= n; t++) {
      d *= 1 + g1;
      value += d / Math.pow(1 + k, t);
    }
    const tv = k > g2 ? d * (1 + g2) / (k - g2) : NaN;
    return value + tv / Math.pow(1 + k, n);
  }

  /**
   * DCF des flux disponibles pour la firme (FCFF).
   * FCFF_t = FCFF_0 × (1+g)^t pour t = 1..n ; valeur terminale de Gordon-Shapiro : FCFF_n × (1+gT)/(WACC − gT).
   * Valeur des fonds propres = VE − dette nette − intérêts minoritaires.
   */
  function dcf({ fcff0, growth, years, terminalGrowth, waccRate, netDebt = 0, minority = 0, shares }) {
    if (!(waccRate > terminalGrowth)) return null;
    const rows = [];
    let f = fcff0;
    let pvSum = 0;
    for (let t = 1; t <= years; t++) {
      f *= 1 + growth;
      const df = 1 / Math.pow(1 + waccRate, t);
      rows.push({ year: t, fcff: f, discount: df, pv: f * df });
      pvSum += f * df;
    }
    const tv = f * (1 + terminalGrowth) / (waccRate - terminalGrowth);
    const pvTv = tv / Math.pow(1 + waccRate, years);
    const ev = pvSum + pvTv;
    const equity = ev - netDebt - minority;
    return { rows, pvSum, tv, pvTv, ev, equity, perShare: shares ? equity / shares : NaN, tvShare: pvTv / ev };
  }

  /** DCF inversé : croissance implicite du FCFF qui égalise la valeur par action au cours. */
  function reverseDCF(params, price) {
    const f = (g) => {
      const r = dcf({ ...params, growth: g });
      return r ? r.perShare - price : NaN;
    };
    return bisect(f, -0.5, 1.0, 1e-10);
  }

  return {
    normCdf, normPdf, normInv, bisect,
    fv, pv, annuityPV, annuityFV, payment, perpetuity, growingPerpetuity, growingAnnuityPV,
    effectiveAnnualRate, continuousEAR, fisherReal, amortization,
    npv, irr, mirr, payback, profitabilityIndex, equivalentAnnualAnnuity,
    bondCashflows, bondPrice, bondYTM, bondRisk, bondPriceChangeApprox,
    blackScholes, impliedVol, binomial,
    capm, capmFromPremium, sharpe, treynor, jensenAlpha, m2, twoAssetPortfolio, kelly, forwardPrice, fxForward,
    parametricVaR,
    wacc, unleverBeta, releverBeta, mmLeveredValue, gordon, impliedCostOfEquity, grahamValue, grahamNumber, eva,
    breakEvenUnits, dolAt, eoq, twoStageDDM, dcf, reverseDCF,
  };
});
