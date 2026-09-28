/* Formatage des nombres (fr-FR) et petits utilitaires DOM. */
(function (root) {
  'use strict';
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const nf = (d) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 2 });
  const ND = '—';

  const Fmt = {
    isNum,
    num(v, d = 2) { return isNum(v) ? nf(d).format(v) : ND; },
    int(v) { return isNum(v) ? nf(0).format(v) : ND; },
    pct(v, d = 2) { return isNum(v) ? nf(d).format(v * 100) + ' %' : ND; },
    signedPct(v, d = 2) { return isNum(v) ? (v > 0 ? '+' : '') + nf(d).format(v * 100) + ' %' : ND; },
    signed(v, d = 2) { return isNum(v) ? (v > 0 ? '+' : '') + nf(d).format(v) : ND; },
    x(v, d = 2) { return isNum(v) ? nf(d).format(v) + '×' : ND; },
    days(v) { return isNum(v) ? nf(1).format(v) + ' j' : ND; },
    big(v) { return isNum(v) ? compact.format(v) : ND; },
    money(v, ccy) { return isNum(v) ? compact.format(v) + (ccy ? ' ' + ccy : '') : ND; },
    price(v, ccy) {
      if (!isNum(v)) return ND;
      const d = Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 1 ? 2 : 4;
      return nf(d).format(v) + (ccy ? ' ' + ccy : '');
    },
    /** Formate selon un code : pct, x, days, money, num, int, price. */
    by(fmt, v, ccy) {
      switch (fmt) {
        case 'pct': return Fmt.pct(v);
        case 'x': return Fmt.x(v);
        case 'days': return Fmt.days(v);
        case 'money': return Fmt.money(v, ccy);
        case 'int': return Fmt.int(v);
        case 'price': return Fmt.price(v, ccy);
        default: return Fmt.num(v);
      }
    },
    cls(v) { return isNum(v) ? (v > 0 ? 'up' : v < 0 ? 'down' : '') : ''; },
    esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
  };

  root.Fmt = Fmt;
})(typeof self !== 'undefined' ? self : this);
