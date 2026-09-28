// Tests des formules JavaScript : node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../static/js/formulas.js');

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (tol ${tol})`);

test('loi normale', () => {
  close(F.normCdf(0), 0.5, 1e-15);
  close(F.normCdf(1), 0.8413447460685429, 1e-14);
  close(F.normCdf(1.96), 0.9750021048517795, 1e-14);
  close(F.normCdf(-3), 0.0013498980316301, 1e-15);
  close(F.normCdf(8), 1 - 6.220960574271785e-16, 1e-15);
  close(F.normInv(0.975), 1.959963984540054, 1e-12);
  close(F.normInv(0.01), -2.3263478740408408, 1e-12);
});

test('Black-Scholes : cas de référence', () => {
  const r = F.blackScholes(100, 100, 1, 0.05, 0.2);
  close(r.call, 10.450583572185565, 1e-9);
  close(r.put, 5.573526022256971, 1e-9);
  close(r.delta.call, 0.6368306511756191, 1e-12);
  close(r.gamma, 0.018762017345846895, 1e-12);
  close(r.parity, 0, 1e-12);
  // Hull, exemple 15.6 : S = 42, K = 40, r = 10 %, σ = 20 %, T = 0,5
  const h = F.blackScholes(42, 40, 0.5, 0.1, 0.2);
  assert.equal(h.call.toFixed(2), '4.76');
  assert.equal(h.put.toFixed(2), '0.81');
});

test('Black-Scholes : grecques par différences finies', () => {
  const S = 105, K = 100, T = 0.75, r = 0.03, s = 0.25, q = 0.01, h = 1e-4;
  const base = F.blackScholes(S, K, T, r, s, q);
  const up = F.blackScholes(S + h, K, T, r, s, q);
  const dn = F.blackScholes(S - h, K, T, r, s, q);
  close(base.delta.call, (up.call - dn.call) / (2 * h), 1e-7);
  close(base.delta.put, (up.put - dn.put) / (2 * h), 1e-7);
  close(base.gamma, (up.call - 2 * base.call + dn.call) / (h * h), 1e-4);
  const vUp = F.blackScholes(S, K, T, r, s + h, q).call;
  const vDn = F.blackScholes(S, K, T, r, s - h, q).call;
  close(base.vega, (vUp - vDn) / (2 * h) / 100, 1e-7);
  const tUp = F.blackScholes(S, K, T + h, r, s, q);
  const tDn = F.blackScholes(S, K, T - h, r, s, q);
  close(base.theta.call, -(tUp.call - tDn.call) / (2 * h) / 365, 1e-8);
  close(base.theta.put, -(tUp.put - tDn.put) / (2 * h) / 365, 1e-8);
  const rUp = F.blackScholes(S, K, T, r + h, s, q);
  const rDn = F.blackScholes(S, K, T, r - h, s, q);
  close(base.rho.call, (rUp.call - rDn.call) / (2 * h) / 100, 1e-7);
  close(base.rho.put, (rUp.put - rDn.put) / (2 * h) / 100, 1e-7);
});

test('volatilité implicite et binomial', () => {
  const p = F.blackScholes(100, 95, 0.5, 0.02, 0.3).call;
  close(F.impliedVol(p, 100, 95, 0.5, 0.02, 'call'), 0.3, 1e-9);
  const eu = F.binomial(100, 100, 1, 0.05, 0.2, 2000, 'call');
  close(eu, 10.450583572185565, 5e-3);
  const amPut = F.binomial(100, 100, 1, 0.05, 0.2, 500, 'put', true);
  const euPut = F.binomial(100, 100, 1, 0.05, 0.2, 500, 'put', false);
  assert.ok(amPut > euPut);
  // call américain sans dividende = call européen
  close(F.binomial(100, 100, 1, 0.05, 0.2, 500, 'call', true), F.binomial(100, 100, 1, 0.05, 0.2, 500, 'call'), 1e-10);
});

test('valeur temps de l\'argent', () => {
  close(F.fv(100, 0.05, 10), 162.8894626777442, 1e-9);
  close(F.pv(162.8894626777442, 0.05, 10), 100, 1e-9);
  close(F.payment(200000, 0.05 / 12, 360), 1073.6432460242797, 1e-8);
  close(F.annuityPV(100, 0.1, 3), 248.68519909842224, 1e-9);
  close(F.annuityPV(100, 0.1, 3, true), 273.5537190082645, 1e-9);
  close(F.annuityFV(100, 0.1, 3), 331, 1e-9);
  close(F.effectiveAnnualRate(0.12, 12), 0.12682503013196977, 1e-12);
  close(F.continuousEAR(0.1), Math.exp(0.1) - 1, 1e-15);
  close(F.fisherReal(0.05, 0.02), 1.05 / 1.02 - 1, 1e-15);
  close(F.growingPerpetuity(5, 0.1, 0.03), 5 / 0.07, 1e-12);
  // annuité croissante = somme explicite
  let s = 0;
  for (let t = 1; t <= 5; t++) s += 10 * Math.pow(1.03, t - 1) / Math.pow(1.08, t);
  close(F.growingAnnuityPV(10, 0.08, 0.03, 5), s, 1e-10);
  const am = F.amortization(10000, 0.06, 1, 12);
  close(am.rows[11].balance, 0, 1e-6);
  close(am.rows.reduce((a, r) => a + r.principal, 0), 10000, 1e-6);
});

test('choix d\'investissement', () => {
  close(F.npv(0.1, [-100, 60, 60]), -100 + 60 / 1.1 + 60 / 1.21, 1e-12);
  const x = (-1 + Math.sqrt(1 + 4 * 100 / 60)) / 2;
  close(F.irr([-100, 60, 60]), 1 / x - 1, 1e-9);
  close(F.npv(F.irr([-1000, 300, 400, 500, 200]), [-1000, 300, 400, 500, 200]), 0, 1e-6);
  const flows = [-120000, 39000, 30000, 21000, 37000, 46000];
  const fvPos = 39000 * 1.12 ** 4 + 30000 * 1.12 ** 3 + 21000 * 1.12 ** 2 + 37000 * 1.12 + 46000;
  close(F.mirr(flows, 0.1, 0.12), (fvPos / 120000) ** (1 / 5) - 1, 1e-12);
  assert.equal(F.mirr(flows, 0.1, 0.12).toFixed(4), '0.1261'); // exemple de la documentation Excel (≈ 13 %)
  close(F.payback([-100, 40, 40, 40]), 2.5, 1e-12);
  const dp = F.payback([-100, 50, 50, 50], 0.1);
  const d1 = 50 / 1.1, d2 = 50 / 1.21, d3 = 50 / 1.331;
  close(dp, 2 + (100 - d1 - d2) / d3, 1e-12);
  close(F.profitabilityIndex(0.1, [-100, 60, 60]), (60 / 1.1 + 60 / 1.21) / 100, 1e-12);
});

test('obligations', () => {
  close(F.bondPrice(1000, 0.05, 0.06, 10), 926.3991294858207, 1e-8);
  close(F.bondYTM(926.3991294858207, 1000, 0.05, 10), 0.06, 1e-9);
  const r = F.bondRisk(1000, 0.1, 0.1, 5);
  close(r.price, 1000, 1e-9);
  close(r.macaulay, 4.169865446510518, 1e-9);
  close(r.modified, 4.169865446510518 / 1.1, 1e-9);
  const z = F.bondRisk(1000, 0, 0.04, 7);
  close(z.macaulay, 7, 1e-12);
  close(z.convexity, 7 * 8 / 1.04 ** 2, 1e-9);
  // semestriel : prix au pair quand coupon = rendement
  close(F.bondPrice(100, 0.06, 0.06, 5, 2), 100, 1e-9);
  // approximation duration + convexité proche du prix exact pour un petit choc
  const b = F.bondRisk(1000, 0.05, 0.05, 10, 2);
  const exact = F.bondPrice(1000, 0.05, 0.051, 10, 2) / b.price - 1;
  close(F.bondPriceChangeApprox(b.modified, b.convexity, 0.001), exact, 1e-6);
});

test('marchés et portefeuille', () => {
  close(F.capm(0.03, 1.2, 0.08), 0.09, 1e-15);
  close(F.capmFromPremium(0.03, 1.2, 0.05), 0.09, 1e-15);
  const p = F.twoAssetPortfolio(0.6, 0.1, 0.2, 0.05, 0.1, 0.3);
  close(p.expected, 0.08, 1e-15);
  close(p.variance, 0.36 * 0.04 + 0.16 * 0.01 + 2 * 0.6 * 0.4 * 0.3 * 0.2 * 0.1, 1e-15);
  close(F.kelly(0.6, 1), 0.2, 1e-15);
  close(F.m2(0.12, 0.02, 0.2, 0.15), 0.02 + 0.5 * 0.15, 1e-15);
  close(F.parametricVaR(1e6, 0.2, 1, 0.99), 1e6 * 2.3263478740408408 * 0.2 / Math.sqrt(252), 1e-3);
  close(F.fxForward(1.1, 0.05, 0.03, 1), 1.1 * 1.05 / 1.03, 1e-15);
});

test('finance d\'entreprise', () => {
  close(F.wacc(600, 400, 0.1, 0.06, 0.25), 0.078, 1e-15);
  close(F.unleverBeta(1.2, 50, 100, 0.25), 1.2 / 1.375, 1e-15);
  close(F.releverBeta(F.unleverBeta(1.2, 50, 100, 0.25), 50, 100, 0.25), 1.2, 1e-15);
  close(F.gordon(2, 0.08, 0.03), 41.2, 1e-12);
  close(F.impliedCostOfEquity(2.06, 41.2, 0.03), 0.08, 1e-15);
  close(F.grahamValue(5, 0.05, 0.044), 5 * 18.5, 1e-12);
  close(F.grahamNumber(4, 25), Math.sqrt(22.5 * 100), 1e-12);
  close(F.breakEvenUnits(1000, 15, 5), 100, 1e-15);
  close(F.dolAt(200, 15, 5, 1000), 2, 1e-15);
  close(F.eoq(1000, 50, 2), Math.sqrt(50000), 1e-12);
  // DDM 2 étapes = Gordon si g1 = g2
  close(F.twoStageDDM(2, 0.08, 0.03, 5, 0.03), 41.2, 1e-9);
});

test('DCF et DCF inversé', () => {
  const r = F.dcf({ fcff0: 100, growth: 0.1, years: 2, terminalGrowth: 0.02, waccRate: 0.08, netDebt: 50, shares: 10 });
  const f1 = 110, f2 = 121;
  const pvs = f1 / 1.08 + f2 / 1.08 ** 2;
  const tv = f2 * 1.02 / 0.06;
  close(r.pvSum, pvs, 1e-9);
  close(r.tv, tv, 1e-9);
  close(r.ev, pvs + tv / 1.08 ** 2, 1e-9);
  close(r.perShare, (r.ev - 50) / 10, 1e-9);
  assert.equal(F.dcf({ fcff0: 100, growth: 0.1, years: 2, terminalGrowth: 0.08, waccRate: 0.08, shares: 1 }), null);
  const params = { fcff0: 100, years: 5, terminalGrowth: 0.02, waccRate: 0.09, netDebt: 200, shares: 50 };
  const price = F.dcf({ ...params, growth: 0.07 }).perShare;
  close(F.reverseDCF(params, price), 0.07, 1e-8);
});
