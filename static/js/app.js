/* FinAnalyse — application monopage (routage par ancre #/...). */
(function () {
  'use strict';
  const F = window.FinFormulas;
  const Fm = window.Fmt;
  const E = Fm.esc;
  const app = document.getElementById('app');

  // ------------------------------------------------------------------
  // Utilitaires
  // ------------------------------------------------------------------

  async function api(path) {
    const res = await fetch(path);
    let body;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!res.ok) throw new Error((body && body.error) || `Erreur HTTP ${res.status}`);
    return body;
  }

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const loading = (msg = 'Chargement des données…') => `<div class="loading"><div class="spinner"></div>${E(msg)}</div>`;
  const errorBox = (e) => `<div class="error">${E(e.message || e)}</div>`;

  const store = {
    get(key, def) { try { const v = localStorage.getItem(key); return v === null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
  };
  const watchlist = () => store.get('watchlist', []);
  function toggleWatch(sym) {
    const w = watchlist();
    const i = w.indexOf(sym);
    if (i >= 0) w.splice(i, 1); else w.push(sym);
    store.set('watchlist', w);
    return i < 0;
  }

  function metricRow(label, formula, value, cls = '') {
    return `<tr><td>${E(label)}${formula ? `<span class="formula">${E(formula)}</span>` : ''}</td><td class="num ${cls}">${value}</td></tr>`;
  }

  // ------------------------------------------------------------------
  // Thème
  // ------------------------------------------------------------------

  const savedTheme = store.get('theme', null);
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('theme', next);
    route();
  });

  // ------------------------------------------------------------------
  // Recherche
  // ------------------------------------------------------------------

  const searchInput = document.getElementById('search');
  const searchList = document.getElementById('search-results');
  let searchTimer = null;
  let searchItems = [];
  let activeIdx = -1;

  function renderSearch() {
    if (!searchItems.length) { searchList.hidden = true; return; }
    searchList.innerHTML = searchItems.map((it, i) => `
      <li role="option" data-sym="${E(it.symbol)}" class="${i === activeIdx ? 'active' : ''}">
        <span class="sym">${E(it.symbol)}</span><span class="nm">${E(it.name)}</span>
        <span class="muted small">${E(it.exchange || '')} · ${E(it.type || '')}</span></li>`).join('');
    searchList.hidden = false;
  }
  function goStock(sym) {
    searchList.hidden = true;
    searchInput.value = '';
    location.hash = '#/stock/' + encodeURIComponent(sym.toUpperCase());
  }
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) { searchItems = []; renderSearch(); return; }
    searchTimer = setTimeout(async () => {
      try { searchItems = await api('/api/search?q=' + encodeURIComponent(q)); } catch (e) { searchItems = []; }
      activeIdx = -1;
      renderSearch();
    }, 250);
  });
  searchInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { activeIdx = Math.min(activeIdx + 1, searchItems.length - 1); renderSearch(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { activeIdx = Math.max(activeIdx - 1, 0); renderSearch(); ev.preventDefault(); }
    else if (ev.key === 'Enter') {
      const it = searchItems[activeIdx] || searchItems[0];
      if (it) goStock(it.symbol);
      else if (searchInput.value.trim()) goStock(searchInput.value.trim());
    } else if (ev.key === 'Escape') { searchList.hidden = true; }
  });
  searchList.addEventListener('mousedown', (ev) => {
    const li = ev.target.closest('li');
    if (li) goStock(li.dataset.sym);
  });
  document.addEventListener('click', (ev) => { if (!ev.target.closest('.search')) searchList.hidden = true; });

  // ------------------------------------------------------------------
  // Graphiques
  // ------------------------------------------------------------------

  function lwChart(el, opts = {}) {
    return LightweightCharts.createChart(el, {
      autoSize: true,
      layout: { background: { type: 'solid', color: css('--surface') }, textColor: css('--muted'), fontSize: 11 },
      grid: { vertLines: { color: css('--chart-grid') }, horzLines: { color: css('--chart-grid') } },
      rightPriceScale: { borderColor: css('--border') },
      timeScale: { borderColor: css('--border') },
      crosshair: { mode: 0 },
      localization: { locale: 'fr-FR', priceFormatter: (p) => Fm.num(p, Math.abs(p) < 1 ? 4 : 2) },
      ...opts,
    });
  }

  /** Série linéaire avec points « vides » pour garder l'alignement des index entre graphiques. */
  function lineData(times, values) {
    return times.map((t, i) => (Fm.isNum(values[i]) ? { time: t, value: values[i] } : { time: t }));
  }

  const chartRegistry = [];
  function destroyCharts() {
    while (chartRegistry.length) {
      const c = chartRegistry.pop();
      try { c.remove ? c.remove() : c.destroy(); } catch (e) { /* déjà détruit */ }
    }
  }

  function cjs(canvas, config) {
    Chart.defaults.color = css('--muted');
    Chart.defaults.borderColor = css('--chart-grid');
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    const c = new Chart(canvas, config);
    chartRegistry.push(c);
    return c;
  }

  // ------------------------------------------------------------------
  // Accueil
  // ------------------------------------------------------------------

  const POPULAR = [['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'NVIDIA'], ['AMZN', 'Amazon'], ['GOOGL', 'Alphabet'],
    ['MC.PA', 'LVMH'], ['TTE.PA', 'TotalEnergies'], ['AIR.PA', 'Airbus'], ['OR.PA', 'L\'Oréal'], ['SAN.PA', 'Sanofi'],
    ['ASML.AS', 'ASML'], ['SAP.DE', 'SAP'], ['NESN.SW', 'Nestlé'], ['7203.T', 'Toyota']];

  function tile(q) {
    return `<a class="tile" href="#/stock/${encodeURIComponent(q.symbol)}">
      <div class="t-name">${E(q.name || q.symbol)}</div>
      <div class="t-price">${Fm.num(q.price)}</div>
      <div class="${Fm.cls(q.change_pct)} small">${Fm.signed(q.change)} (${Fm.signedPct(q.change_pct)})</div></a>`;
  }

  async function viewHome() {
    const wl = watchlist();
    app.innerHTML = `
      <div class="hero"><h1>Marchés</h1><p class="muted">Recherchez n'importe quelle action, ETF, indice, devise ou crypto-actif dans la barre de recherche.</p></div>
      <div id="market" class="market-grid">${loading('Chargement des marchés…')}</div>
      <h2>Ma liste de suivi</h2>
      <div id="watch" class="market-grid">${wl.length ? loading() : '<p class="muted">Ajoutez des valeurs avec le bouton « ☆ Suivre » d\'une fiche action.</p>'}</div>
      <h2>Valeurs populaires</h2>
      <div class="chips">${POPULAR.map(([s, n]) => `<a class="chip" href="#/stock/${s}">${E(n)} <span class="muted">${s}</span></a>`).join('')}</div>`;
    api('/api/market').then((rows) => {
      document.getElementById('market').innerHTML = rows.map(tile).join('');
    }).catch((e) => { document.getElementById('market').innerHTML = errorBox(e); });
    if (wl.length) {
      api('/api/quotes?symbols=' + encodeURIComponent(wl.join(','))).then((rows) => {
        document.getElementById('watch').innerHTML = rows.map(tile).join('');
      }).catch((e) => { document.getElementById('watch').innerHTML = errorBox(e); });
    }
  }

  // ------------------------------------------------------------------
  // Fiche action
  // ------------------------------------------------------------------

  const RANGES = [['1d', '1J'], ['5d', '5J'], ['1m', '1M'], ['6m', '6M'], ['ytd', 'YTD'], ['1y', '1A'], ['5y', '5A'], ['max', 'MAX']];
  const OVERLAYS = [['sma20', 'MM 20', '--s2'], ['sma50', 'MM 50', '--s3'], ['sma200', 'MM 200', '--s5'], ['ema12', 'MME 12', '--s4'],
    ['ema26', 'MME 26', '--s7'], ['bb', 'Bollinger (20, 2)', '--s8'], ['vwap20', 'VWAP 20 j', '--s6']];
  const SUBS = [['none', 'Aucun'], ['rsi', 'RSI (14)'], ['macd', 'MACD (12, 26, 9)'], ['stoch', 'Stochastique (14, 3)'], ['adx', 'ADX / DI (14)'],
    ['cci', 'CCI (20)'], ['williams_r', 'Williams %R (14)'], ['mfi', 'MFI (14)'], ['obv', 'OBV'], ['atr', 'ATR (14)'], ['roc', 'ROC (12)']];

  const TABS = [['summary', 'Synthèse'], ['valuation', 'Valorisation'], ['ratios', 'Ratios financiers'], ['scores', 'Scores'],
    ['risk', 'Risque & performance'], ['technical', 'Analyse technique'], ['corporate', 'Finance d\'entreprise'],
    ['statements', 'États financiers'], ['dividends', 'Dividendes & actualités']];

  async function viewStock(symbol, tab) {
    destroyCharts();
    app.innerHTML = loading(`Analyse de ${symbol} en cours…`);
    let d;
    try {
      d = await api('/api/stock/' + encodeURIComponent(symbol));
    } catch (e) {
      app.innerHTML = errorBox(e) + '<p><a href="#/">← Retour aux marchés</a></p>';
      return;
    }
    const q = d.quote;
    const cur = q.currency_raw || q.currency || '';
    const watched = watchlist().includes(q.symbol);
    app.innerHTML = `
      <div class="quote-head">
        <div>
          <div class="muted small">${E(q.exchange || '')} · ${E(q.symbol)} · ${E(q.quote_type || '')}${q.sector ? ' · ' + E(q.sector) : ''}</div>
          <h1>${E(q.name)}</h1>
          <div><span class="quote-price">${Fm.price(q.price_raw)}</span> <span class="muted">${E(cur)}</span>
            <span class="quote-change ${Fm.cls(q.change_pct)}">${Fm.signed(q.change_raw)} (${Fm.signedPct(q.change_pct)})</span></div>
        </div>
        <div><button class="btn watch-btn ${watched ? 'on' : ''}" id="watch-btn">${watched ? '★ Suivie' : '☆ Suivre'}</button>
          <a class="btn" href="#/compare?s=${encodeURIComponent(q.symbol)}">Comparer</a></div>
      </div>
      <div class="chart-toolbar">
        <div class="chips" id="ranges">${RANGES.map(([k, l]) => `<button class="chip ${k === '1y' ? 'active' : ''}" data-r="${k}">${l}</button>`).join('')}</div>
        <div class="chips"><button class="chip active" data-type="candle" id="t-candle">Chandeliers</button><button class="chip" data-type="line" id="t-line">Ligne</button></div>
      </div>
      <div class="overlays" id="overlays">${OVERLAYS.map(([k, l, c]) => `<label><input type="checkbox" data-o="${k}"><span style="color:var(${c})">■</span> ${l}</label>`).join('')}
        <label>Indicateur : <select id="sub-select" style="width:auto">${SUBS.map(([k, l]) => `<option value="${k}" ${k === 'rsi' ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="chart-box" id="main-chart"><div class="legend" id="legend"></div></div>
      <div class="sub-chart" id="sub-chart"><div class="legend" id="sub-legend"></div></div>
      <div class="stats-grid">${keyStats(d)}</div>
      <div class="tabs" id="tabs">${TABS.map(([k, l]) => `<button class="tab ${k === tab ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <section id="tab-body"></section>`;

    document.getElementById('watch-btn').addEventListener('click', (ev) => {
      const on = toggleWatch(q.symbol);
      ev.target.classList.toggle('on', on);
      ev.target.textContent = on ? '★ Suivie' : '☆ Suivre';
    });
    setupPriceChart(d);
    const showTab = (k) => {
      document.querySelectorAll('#tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === k));
      history.replaceState(null, '', `#/stock/${encodeURIComponent(q.symbol)}/${k}`);
      // les graphiques des onglets sont recréés à chaque affichage
      while (chartRegistry.length > 2) { const c = chartRegistry.pop(); try { c.remove ? c.remove() : c.destroy(); } catch (e) { /* */ } }
      renderTab(k, d);
    };
    document.getElementById('tabs').addEventListener('click', (ev) => {
      const b = ev.target.closest('.tab');
      if (b) showTab(b.dataset.tab);
    });
    renderTab(TABS.some(([k]) => k === tab) ? tab : 'summary', d);
  }

  function keyStats(d) {
    const q = d.quote;
    const v = d.valuation || {};
    const items = [
      ['Ouverture', Fm.price(q.open_raw)], ['Plus haut du jour', Fm.price(q.day_high_raw)], ['Plus bas du jour', Fm.price(q.day_low_raw)],
      ['Clôture précédente', Fm.price(q.previous_close_raw)], ['Plus haut 52 sem.', Fm.price(q.high_52w_raw)], ['Plus bas 52 sem.', Fm.price(q.low_52w_raw)],
      ['Capitalisation', Fm.money(q.market_cap, q.currency)], ['Valeur d\'entreprise', Fm.money(v.enterprise_value, q.currency)],
      ['PER', Fm.x(v.pe)], ['Rendement du dividende', Fm.pct(v.dividend_yield)], ['Bêta 5 ans (mensuel)', Fm.num(d.dcf.beta_monthly_5y)],
      ['Volume', Fm.big(q.volume)], ['Volume moyen 3 mois', Fm.big(q.avg_volume_3m)], ['Indice de référence', E(d.benchmark)],
    ];
    return items.map(([l, val]) => `<div class="stat"><span>${E(l)}</span><span>${val}</span></div>`).join('');
  }

  // ---------------- Graphique de cours ----------------

  function rangeStart(times, r) {
    if (r === 'max' || !times.length) return 0;
    const last = new Date(times[times.length - 1] + 'T00:00:00Z');
    const start = new Date(last);
    if (r === 'ytd') { start.setUTCMonth(0, 1); } else {
      const months = { '1m': 1, '6m': 6, '1y': 12, '5y': 60 }[r];
      start.setUTCMonth(start.getUTCMonth() - months);
    }
    const iso = start.toISOString().slice(0, 10);
    const idx = times.findIndex((t) => t >= iso);
    return idx < 0 ? 0 : idx;
  }

  function setupPriceChart(d) {
    const c = d.chart;
    const mainEl = document.getElementById('main-chart');
    const subEl = document.getElementById('sub-chart');
    const main = lwChart(mainEl);
    const sub = lwChart(subEl, { timeScale: { visible: true, borderColor: css('--border') } });
    chartRegistry.push(main, sub);
    const up = css('--up');
    const down = css('--down');
    const state = { range: '1y', type: 'candle', overlays: new Set(store.get('overlays', ['sma50', 'sma200'])), sub: store.get('sub', 'rsi') };
    document.querySelectorAll('#overlays input[data-o]').forEach((cb) => { cb.checked = state.overlays.has(cb.dataset.o); });
    document.getElementById('sub-select').value = state.sub;
    let series = [];
    let subSeries = [];

    function clear(chart, list) { list.forEach((s) => chart.removeSeries(s)); list.length = 0; }

    async function draw() {
      clear(main, series);
      clear(sub, subSeries);
      const legend = document.getElementById('legend');
      if (state.range === '1d' || state.range === '5d') {
        subEl.style.display = 'none';
        try {
          const it = await api(`/api/intraday/${encodeURIComponent(d.quote.symbol)}?range=${state.range}`);
          const off = (t) => t - new Date(t * 1000).getTimezoneOffset() * 60;
          const area = main.addAreaSeries({ lineColor: css('--s1'), topColor: css('--accent-soft'), bottomColor: 'transparent', lineWidth: 2 });
          area.setData(it.time.map((t, i) => ({ time: off(t), value: it.close[i] })));
          series.push(area);
          main.applyOptions({ timeScale: { timeVisible: true, secondsVisible: false } });
          main.timeScale().fitContent();
          legend.textContent = 'Heure locale du navigateur · pas de ' + (state.range === '1d' ? '5 min' : '15 min');
        } catch (e) { legend.textContent = e.message; }
        return;
      }
      subEl.style.display = state.sub === 'none' ? 'none' : '';
      main.applyOptions({ timeScale: { timeVisible: false } });
      const s0 = rangeStart(c.time, state.range);
      const times = c.time.slice(s0);
      const sl = (arr) => arr.slice(s0);
      if (state.type === 'candle') {
        const cs = main.addCandlestickSeries({ upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down });
        cs.setData(times.map((t, i) => ({ time: t, open: c.open[s0 + i], high: c.high[s0 + i], low: c.low[s0 + i], close: c.close[s0 + i] })));
        series.push(cs);
      } else {
        const ls = main.addLineSeries({ color: css('--s1'), lineWidth: 2 });
        ls.setData(lineData(times, sl(c.close)));
        series.push(ls);
      }
      const vol = main.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(times.map((t, i) => ({ time: t, value: c.volume[s0 + i] || 0,
        color: (c.close[s0 + i] >= c.open[s0 + i] ? up : down) + '66' })));
      series.push(vol);
      const addLine = (chart, list, key, color, width = 1) => {
        const s = chart.addLineSeries({ color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        s.setData(lineData(times, sl(c.ind[key])));
        list.push(s);
        return s;
      };
      for (const [k, , col] of OVERLAYS) {
        if (!state.overlays.has(k)) continue;
        if (k === 'bb') ['bb_upper', 'bb_mid', 'bb_lower'].forEach((b) => addLine(main, series, b, css(col)));
        else addLine(main, series, k, css(col));
      }
      // indicateur secondaire
      const subLegend = document.getElementById('sub-legend');
      subLegend.textContent = (SUBS.find(([k]) => k === state.sub) || [])[1] || '';
      const refLines = (s, levels) => levels.forEach((p) => s.createPriceLine({ price: p, color: css('--border'), lineWidth: 1, lineStyle: 2, axisLabelVisible: false }));
      switch (state.sub) {
        case 'rsi': refLines(addLine(sub, subSeries, 'rsi', css('--s3'), 2), [30, 70]); break;
        case 'macd': {
          const h = sub.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
          h.setData(times.map((t, i) => { const v = c.ind.macd_hist[s0 + i]; return Fm.isNum(v) ? { time: t, value: v, color: v >= 0 ? up : down } : { time: t }; }));
          subSeries.push(h);
          addLine(sub, subSeries, 'macd', css('--s1'), 2);
          addLine(sub, subSeries, 'macd_signal', css('--s2'), 1);
          break;
        }
        case 'stoch': refLines(addLine(sub, subSeries, 'stoch_k', css('--s1'), 2), [20, 80]); addLine(sub, subSeries, 'stoch_d', css('--s2')); break;
        case 'adx': refLines(addLine(sub, subSeries, 'adx', css('--s3'), 2), [25]); addLine(sub, subSeries, 'plus_di', up); addLine(sub, subSeries, 'minus_di', down); break;
        case 'cci': refLines(addLine(sub, subSeries, 'cci', css('--s4'), 2), [-100, 100]); break;
        case 'williams_r': refLines(addLine(sub, subSeries, 'williams_r', css('--s5'), 2), [-80, -20]); break;
        case 'mfi': refLines(addLine(sub, subSeries, 'mfi', css('--s6'), 2), [20, 80]); break;
        case 'obv': addLine(sub, subSeries, 'obv', css('--s7'), 2); break;
        case 'atr': addLine(sub, subSeries, 'atr', css('--s2'), 2); break;
        case 'roc': refLines(addLine(sub, subSeries, 'roc', css('--s1'), 2), [0]); break;
        default: break;
      }
      main.timeScale().fitContent();
      sub.timeScale().fitContent();
      legend.textContent = '';
    }

    // synchronisation des échelles de temps
    let syncing = false;
    const sync = (a, b) => a.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (syncing || !r || subEl.style.display === 'none') return;
      syncing = true;
      b.timeScale().setVisibleLogicalRange(r);
      syncing = false;
    });
    sync(main, sub);
    sync(sub, main);

    main.subscribeCrosshairMove((p) => {
      const legend = document.getElementById('legend');
      if (!p || !p.time || typeof p.time !== 'string') return;
      const i = c.time.indexOf(p.time);
      if (i < 0) return;
      const ch = i > 0 ? c.close[i] / c.close[i - 1] - 1 : null;
      legend.innerHTML = `${E(p.time)} · O ${Fm.num(c.open[i])} · H ${Fm.num(c.high[i])} · B ${Fm.num(c.low[i])} · C ${Fm.num(c.close[i])} <span class="${Fm.cls(ch)}">${Fm.signedPct(ch)}</span> · Vol ${Fm.big(c.volume[i])}`;
    });

    document.getElementById('ranges').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-r]');
      if (!b) return;
      state.range = b.dataset.r;
      document.querySelectorAll('#ranges .chip').forEach((x) => x.classList.toggle('active', x === b));
      draw();
    });
    ['t-candle', 't-line'].forEach((id) => document.getElementById(id).addEventListener('click', (ev) => {
      state.type = ev.target.dataset.type;
      document.getElementById('t-candle').classList.toggle('active', state.type === 'candle');
      document.getElementById('t-line').classList.toggle('active', state.type === 'line');
      draw();
    }));
    document.getElementById('overlays').addEventListener('change', (ev) => {
      if (ev.target.dataset.o) {
        if (ev.target.checked) state.overlays.add(ev.target.dataset.o); else state.overlays.delete(ev.target.dataset.o);
        store.set('overlays', [...state.overlays]);
      } else if (ev.target.id === 'sub-select') {
        state.sub = ev.target.value;
        store.set('sub', state.sub);
      }
      draw();
    });
    draw();
  }

  // ---------------- Onglets ----------------

  function renderTab(k, d) {
    const body = document.getElementById('tab-body');
    const fn = { summary: tabSummary, valuation: tabValuation, ratios: tabRatios, scores: tabScores, risk: tabRisk,
      technical: tabTechnical, corporate: tabCorporate, statements: tabStatements, dividends: tabDividends }[k] || tabSummary;
    try { fn(body, d); } catch (e) { body.innerHTML = errorBox(e); console.error(e); }
  }

  const VAL_DEFS = [
    ['Capitalisation et valeur d\'entreprise', [
      ['market_cap', 'Capitalisation boursière', 'Cours × nombre d\'actions', 'money'],
      ['enterprise_value', 'Valeur d\'entreprise (VE)', 'Capitalisation + Dette financière − Trésorerie et placements CT + Intérêts minoritaires + Actions préférentielles', 'money'],
    ]],
    ['Données par action', [
      ['eps', 'Bénéfice par action (BPA)', 'Résultat net part des actionnaires ordinaires / Nombre d\'actions', 'price'],
      ['bvps', 'Actif net par action (ANPA)', 'Capitaux propres / Nombre d\'actions', 'price'],
      ['fcf_per_share', 'FCF par action', '(CFO − CapEx) / Nombre d\'actions', 'price'],
      ['sales_per_share', 'CA par action', 'Chiffre d\'affaires / Nombre d\'actions', 'price'],
      ['dividend_per_share', 'Dividende par action (12 mois)', 'Somme des dividendes détachés sur 365 jours', 'price'],
    ]],
    ['Multiples de résultat', [
      ['pe', 'PER (P/E)', 'Capitalisation / Résultat net (= Cours / BPA)', 'x'],
      ['earnings_yield', 'Rendement bénéficiaire', 'Résultat net / Capitalisation (= 1 / PER)', 'pct'],
      ['forward_pe_yahoo', 'PER prévisionnel (consensus Yahoo)', 'Cours / BPA attendu par les analystes', 'x'],
      ['peg', 'PEG', 'PER / (TCAM historique du BPA × 100)', 'num'],
    ]],
    ['Multiples de bilan et de flux', [
      ['pb', 'Price to Book (P/B)', 'Capitalisation / Capitaux propres', 'x'],
      ['ptbv', 'Price to Tangible Book', 'Capitalisation / Actif net tangible', 'x'],
      ['ps', 'Price to Sales (P/S)', 'Capitalisation / Chiffre d\'affaires', 'x'],
      ['pfcf', 'Price to FCF', 'Capitalisation / FCF', 'x'],
      ['pocf', 'Price to Operating Cash Flow', 'Capitalisation / CFO', 'x'],
      ['tobin_q', 'Q de Tobin (approximation)', '(Capitalisation + Total des dettes) / Actif total', 'num'],
    ]],
    ['Multiples de valeur d\'entreprise', [
      ['ev_ebitda', 'VE / EBITDA', 'Valeur d\'entreprise / EBITDA', 'x'],
      ['ev_ebit', 'VE / EBIT', 'Valeur d\'entreprise / EBIT', 'x'],
      ['ev_sales', 'VE / CA', 'Valeur d\'entreprise / Chiffre d\'affaires', 'x'],
      ['ev_fcf', 'VE / FCF', 'Valeur d\'entreprise / FCF', 'x'],
    ]],
    ['Rendements pour l\'actionnaire', [
      ['dividend_yield', 'Rendement du dividende', 'Dividendes par action sur 12 mois / Cours', 'pct'],
      ['fcf_yield', 'Rendement FCF', 'FCF / Capitalisation', 'pct'],
      ['shareholder_yield', 'Rendement actionnarial total', '(Dividendes versés + Rachats d\'actions) / Capitalisation', 'pct'],
    ]],
    ['Valeur intrinsèque (Graham)', [
      ['graham_number', 'Nombre de Graham', '√(22,5 × BPA × ANPA)', 'price'],
      ['graham_upside', 'Potentiel vs cours', 'Nombre de Graham / Cours − 1', 'pct'],
    ]],
  ];

  function valTable(d, groups) {
    const v = d.valuation;
    const ccy = d.quote.currency;
    return groups.map(([g, rows]) => `<h3>${E(g)}</h3><div class="table-wrap"><table class="metrics"><tbody>${
      rows.map(([k, l, f, fmt]) => metricRow(l, f, fmt === 'price' ? Fm.price(v[k], ccy) : Fm.by(fmt, v[k], ccy))).join('')}</tbody></table></div>`).join('');
  }

  function basisNotice(d) {
    const v = d.valuation;
    const q = d.quote;
    let s = `<div class="notice">Base de calcul : ${E(v.basis || 'n/d')}. Montants en ${E(q.currency || '')}.`;
    if (q.financial_currency && q.financial_currency !== q.currency && v.fx) {
      s += ` États financiers publiés en ${E(q.financial_currency)}, convertis au taux ${Fm.num(v.fx, 6)} (${E(q.financial_currency)}→${E(q.currency)}).`;
    }
    return s + '</div>';
  }

  function tabSummary(body, d) {
    const q = d.quote;
    const v = d.valuation;
    const rows = latestRatios(d);
    const sc = (d.fundamentals.scores || [])[0] || {};
    const y = q.yahoo || {};
    const kpis = [
      ['PER', Fm.x(v.pe)], ['VE / EBITDA', Fm.x(v.ev_ebitda)], ['P/B', Fm.x(v.pb)], ['Rendement FCF', Fm.pct(v.fcf_yield)],
      ['Marge nette', Fm.pct(rows.net_margin)], ['ROE', Fm.pct(rows.roe)], ['ROIC', Fm.pct(rows.roic)], ['Dette nette / EBITDA', Fm.x(rows.net_debt_to_ebitda)],
      ['Croissance du CA', Fm.pct(rows.revenue_growth)], ['Piotroski', sc.piotroski ? `${sc.piotroski.value} / ${sc.piotroski.max}` : '—'],
      ['Altman Z', v.altman_z ? Fm.num(v.altman_z.value) : '—'], ['Liquidité générale', Fm.x(rows.current_ratio)],
    ];
    body.innerHTML = `
      ${v.available ? '' : '<div class="notice">Données fondamentales indisponibles pour cet instrument (indice, devise, ETF…) : seules les analyses de marché s\'appliquent.</div>'}
      <div class="grid auto">${kpis.map(([l, val]) => `<div class="kpi"><div class="k-label">${E(l)}</div><div class="k-value">${val}</div></div>`).join('')}</div>
      <div class="grid cols-2" style="margin-top:16px">
        <div class="card profile"><h3 style="margin-top:0">Profil</h3>
          <p><b>Secteur :</b> ${E(q.sector || '—')} · <b>Industrie :</b> ${E(q.industry || '—')}</p>
          <p><b>Pays :</b> ${E(q.country || '—')} · <b>Effectif :</b> ${Fm.int(q.employees)}</p>
          ${q.website ? `<p><a href="${E(q.website)}" target="_blank" rel="noopener">${E(q.website)}</a></p>` : ''}
          <details class="explain"><summary>Description</summary><p class="small">${E(q.summary || '—')}</p></details>
        </div>
        <div class="card"><h3 style="margin-top:0">Consensus des analystes (Yahoo Finance)</h3>
          <table class="compact"><tbody>
            ${metricRow('Recommandation', '', E(y.recommendation || '—'))}
            ${metricRow('Nombre d\'analystes', '', Fm.int(y.analysts))}
            ${metricRow('Objectif de cours moyen', '', Fm.price(y.target_mean_raw, q.currency_raw))}
            ${metricRow('Potentiel vs objectif moyen', 'Objectif / Cours − 1', Fm.signedPct(y.target_mean_raw && q.price_raw ? y.target_mean_raw / q.price_raw - 1 : null))}
            ${metricRow('Fourchette des objectifs', '', `${Fm.price(y.target_low_raw)} – ${Fm.price(y.target_high_raw)}`)}
            ${metricRow('Bêta (Yahoo)', '', Fm.num(y.beta))}
          </tbody></table>
        </div>
      </div>
      <h3>Chiffre d'affaires, résultat net et FCF (exercices)</h3>
      <div class="card"><div class="canvas-box"><canvas id="fin-bars"></canvas></div></div>`;
    finBars(document.getElementById('fin-bars'), d);
  }

  function latestRatios(d) {
    const out = {};
    for (const g of d.fundamentals.groups || []) for (const r of g.rows) out[r.key] = r.values[0];
    return out;
  }

  function finBars(canvas, d) {
    const years = (d.fundamentals.years || []).slice().reverse();
    if (!years.length) { canvas.parentElement.innerHTML = '<p class="muted">Pas d\'états financiers.</p>'; return; }
    const get = (group, key) => {
      const g = d.fundamentals.groups.find((x) => x.key === group);
      const r = g && g.rows.find((x) => x.key === key);
      return r ? r.values.slice().reverse() : [];
    };
    const inc = d.statements.income;
    const rowOf = (key) => {
      const r = inc.rows.find((x) => x.key === key);
      if (!r) return years.map(() => null);
      return years.map((y) => { const i = inc.columns.indexOf(y); return i >= 0 ? r.values[i] : null; });
    };
    cjs(canvas, {
      type: 'bar',
      data: {
        labels: years.map((y) => y.slice(0, 4)),
        datasets: [
          { label: 'Chiffre d\'affaires', data: rowOf('TotalRevenue'), backgroundColor: css('--s1') },
          { label: 'Résultat net', data: rowOf('NetIncome'), backgroundColor: css('--s2') },
          { label: 'Free cash flow', data: get('cashflow', 'fcf'), backgroundColor: css('--s6') },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label} : ${Fm.money(c.raw, d.quote.financial_currency)}` } } },
        scales: { y: { ticks: { callback: (v) => Fm.big(v) } } },
      },
    });
  }

  function tabValuation(body, d) {
    if (!d.valuation.available) { body.innerHTML = '<div class="notice">Valorisation indisponible (pas d\'états financiers ou de capitalisation).</div>'; return; }
    body.innerHTML = basisNotice(d) + valTable(d, VAL_DEFS);
  }

  function tabRatios(body, d) {
    const f = d.fundamentals;
    if (!f.years || !f.years.length) { body.innerHTML = '<div class="notice">Aucun état financier disponible.</div>'; return; }
    const ccy = d.quote.financial_currency;
    const cagr = f.cagr || {};
    body.innerHTML = `<div class="notice">Ratios calculés sur les comptes annuels publiés (montants en ${E(ccy)}). « — » : donnée non publiée ou ratio non significatif.</div>
      <div class="chips" id="grp-chips">${f.groups.map((g, i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-g="${g.key}">${E(g.label)}</button>`).join('')}
      <button class="chip" data-g="all">Tout afficher</button></div>
      <div id="grp-body"></div>
      <h3>Croissance annuelle moyenne (TCAM) sur ${Fm.num(cagr.years, 1)} ans</h3>
      <p class="muted small">TCAM = (Valeur finale / Valeur initiale)^(1/années) − 1 ; non calculé si une valeur est négative.</p>
      <div class="grid auto">${[['revenue', 'Chiffre d\'affaires'], ['ebitda', 'EBITDA'], ['net_income', 'Résultat net'], ['eps', 'BPA dilué'], ['fcf', 'FCF'], ['equity', 'Capitaux propres']]
    .map(([k, l]) => `<div class="kpi"><div class="k-label">${l}</div><div class="k-value">${Fm.pct(cagr[k])}</div></div>`).join('')}</div>`;
    const render = (key) => {
      const groups = key === 'all' ? f.groups : f.groups.filter((g) => g.key === key);
      document.getElementById('grp-body').innerHTML = groups.map((g) => `<h3>${E(g.label)}</h3><div class="table-wrap"><table class="metrics">
        <thead><tr><th>Indicateur et formule</th>${f.years.map((y) => `<th class="num">${y.slice(0, 4)}</th>`).join('')}</tr></thead>
        <tbody>${g.rows.map((r) => `<tr><td>${E(r.label)}<span class="formula">${E(r.formula)}</span></td>${r.values.map((v) => `<td class="num">${Fm.by(r.fmt, v, ccy)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`).join('');
    };
    document.getElementById('grp-chips').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-g]');
      if (!b) return;
      document.querySelectorAll('#grp-chips .chip').forEach((x) => x.classList.toggle('active', x === b));
      render(b.dataset.g);
    });
    render(f.groups[0].key);
  }

  function zoneBadge(zone) {
    if (!zone) return '';
    const cls = /sain|peu probable/.test(zone) ? 'up' : /grise/.test(zone) ? 'warn' : 'down';
    return `<span class="badge ${cls}">${E(zone)}</span>`;
  }

  function tabScores(body, d) {
    const scores = d.fundamentals.scores || [];
    const z = d.valuation.altman_z;
    const s0 = scores[0] || {};
    const comp = (c) => (c ? Object.entries(c).map(([k, v]) => `${E(k)} = ${Fm.num(v, 4)}`).join(' · ') : '');
    const hist = (key) => scores.map((s) => `<td class="num">${s[key] && Fm.isNum(s[key].value) ? Fm.num(s[key].value, key === 'piotroski' ? 0 : 3) : '—'}</td>`).join('');
    body.innerHTML = `
      <div class="grid cols-2">
        <div class="card score-card"><h3 style="margin:0">Altman Z-score (1968)</h3>
          <div class="formula-box">Z = 1,2·X1 + 1,4·X2 + 3,3·X3 + 0,6·X4 + 1,0·X5</div>
          <div><span class="score-value">${z ? Fm.num(z.value) : '—'}</span> ${z ? zoneBadge(z.zone) : ''}</div>
          <div class="small muted">X1 = Fonds de roulement / Actif ; X2 = Réserves (bénéfices non distribués) / Actif ; X3 = EBIT / Actif ; X4 = Capitalisation / Total des dettes ; X5 = CA / Actif. Seuils : &gt; 2,99 sain ; 1,81–2,99 zone grise ; &lt; 1,81 détresse. Conçu pour les sociétés industrielles cotées.</div>
          <div class="small">${z ? comp(z.components) : 'Données insuffisantes.'}</div></div>
        <div class="card score-card"><h3 style="margin:0">Altman Z″ (non industrielles)</h3>
          <div class="formula-box">Z″ = 6,56·X1 + 3,26·X2 + 6,72·X3 + 1,05·X4</div>
          <div><span class="score-value">${s0.altman_z2 ? Fm.num(s0.altman_z2.value) : '—'}</span> ${s0.altman_z2 ? zoneBadge(s0.altman_z2.zone) : ''}</div>
          <div class="small muted">X4 = Capitaux propres comptables / Total des dettes. Seuils : &gt; 2,60 sain ; 1,10–2,60 zone grise ; &lt; 1,10 détresse.</div>
          <div class="small">${s0.altman_z2 ? comp(s0.altman_z2.components) : 'Données insuffisantes.'}</div></div>
        <div class="card score-card"><h3 style="margin:0">Piotroski F-score (2000)</h3>
          <div><span class="score-value">${s0.piotroski ? `${s0.piotroski.value} / ${s0.piotroski.max}` : '—'}</span></div>
          ${s0.piotroski ? `<div class="gauge"><div style="width:${s0.piotroski.value / 9 * 100}%"></div></div>
          <table class="compact"><tbody>${s0.piotroski.criteria.map((c) => metricRow(c.label, c.rule, c.point === null ? '—' : c.point ? '<span class="up">✔ 1</span>' : '<span class="down">✘ 0</span>')).join('')}</tbody></table>` : '<p class="muted">Deux exercices nécessaires.</p>'}
          <div class="small muted">8–9 : situation solide ; 0–2 : situation fragile.</div></div>
        <div class="card score-card"><h3 style="margin:0">Beneish M-score (1999)</h3>
          <div class="formula-box">M = −4,84 + 0,920·DSRI + 0,528·GMI + 0,404·AQI + 0,892·SGI + 0,115·DEPI − 0,172·SGAI + 4,679·TATA − 0,327·LVGI</div>
          <div><span class="score-value">${s0.beneish && Fm.isNum(s0.beneish.value) ? Fm.num(s0.beneish.value) : '—'}</span> ${s0.beneish ? zoneBadge(s0.beneish.zone) : ''}</div>
          <div class="small muted">M &gt; −1,78 : probabilité élevée de manipulation des résultats. DSRI : créances/CA ; GMI : marge brute ; AQI : qualité des actifs ; SGI : croissance du CA ; DEPI : amortissements ; SGAI : frais généraux ; TATA : accruals/actif ; LVGI : levier.</div>
          <div class="small">${s0.beneish ? comp(s0.beneish.components) : 'Deux exercices nécessaires.'}</div></div>
        <div class="card score-card"><h3 style="margin:0">Springate S-score (1978)</h3>
          <div class="formula-box">S = 1,03·A + 3,07·B + 0,66·C + 0,4·D</div>
          <div><span class="score-value">${s0.springate ? Fm.num(s0.springate.value) : '—'}</span> ${s0.springate ? zoneBadge(s0.springate.zone) : ''}</div>
          <div class="small muted">A = Fonds de roulement / Actif ; B = EBIT / Actif ; C = Résultat avant impôt / Passif courant ; D = CA / Actif. S &lt; 0,862 : risque de défaillance.</div>
          <div class="small">${s0.springate ? comp(s0.springate.components) : ''}</div></div>
      </div>
      <h3>Historique des scores</h3>
      <div class="table-wrap"><table class="compact"><thead><tr><th>Score</th>${scores.map((s) => `<th class="num">${s.year.slice(0, 4)}</th>`).join('')}</tr></thead><tbody>
        <tr><td>Altman Z″</td>${hist('altman_z2')}</tr><tr><td>Springate</td>${hist('springate')}</tr>
        <tr><td>Piotroski</td>${hist('piotroski')}</tr><tr><td>Beneish</td>${hist('beneish')}</tr></tbody></table></div>
      <p class="muted small">Scores calculés sur les comptes annuels ; l'Altman Z original utilise la capitalisation actuelle et les comptes les plus récents. Ces modèles ne s'appliquent pas aux banques et assurances.</p>`;
  }

  // ---------------- Risque ----------------

  const RISK_DEFS = [
    ['Rendement', [
      ['total_return', 'Rendement total', 'P_fin / P_début − 1 (cours ajustés des dividendes et divisions)', 'pct'],
      ['cagr', 'Rendement annualisé (TCAM)', '(P_fin / P_début)^(365,25 / jours) − 1', 'pct'],
      ['mean_return_ann', 'Rendement moyen arithmétique annualisé', 'moyenne(rₜ) × 252', 'pct'],
      ['best_day', 'Meilleure séance', 'max(rₜ)', 'pct'], ['worst_day', 'Pire séance', 'min(rₜ)', 'pct'],
      ['positive_days', 'Séances en hausse', 'Part des rₜ > 0', 'pct'],
    ]],
    ['Risque', [
      ['volatility_ann', 'Volatilité annualisée', 'écart-type(rₜ) × √252', 'pct'],
      ['downside_dev_ann', 'Semi-écart-type (downside deviation)', '√(moyenne(min(rₜ − r_f/252, 0)²)) × √252', 'pct'],
      ['max_drawdown', 'Perte maximale (max drawdown)', 'min(Pₜ / max(P₀…Pₜ) − 1)', 'pct'],
      ['longest_drawdown_days', 'Plus long drawdown (jours)', 'Durée maximale sous un plus haut précédent', 'int'],
      ['ulcer_index', 'Ulcer Index', '√(moyenne(drawdown % ²))', 'num'],
      ['var95_hist', 'VaR 95 % 1 jour (historique)', '− quantile 5 % des rendements', 'pct'],
      ['var99_hist', 'VaR 99 % 1 jour (historique)', '− quantile 1 % des rendements', 'pct'],
      ['var95_param', 'VaR 95 % 1 jour (paramétrique)', '−(μ − 1,645 σ)', 'pct'],
      ['var99_param', 'VaR 99 % 1 jour (paramétrique)', '−(μ − 2,326 σ)', 'pct'],
      ['cvar95', 'CVaR / Expected Shortfall 95 %', '− moyenne des rendements ≤ quantile 5 %', 'pct'],
      ['cvar99', 'CVaR / Expected Shortfall 99 %', '− moyenne des rendements ≤ quantile 1 %', 'pct'],
      ['skewness', 'Asymétrie (skewness)', 'Coefficient d\'asymétrie échantillon', 'num'],
      ['excess_kurtosis', 'Kurtosis excédentaire', 'Kurtosis − 3 (échantillon)', 'num'],
    ]],
    ['Performance ajustée du risque', [
      ['sharpe', 'Ratio de Sharpe', 'moyenne(rₜ − r_f/252) / écart-type × √252', 'num'],
      ['sortino', 'Ratio de Sortino', 'moyenne(rₜ − r_f/252) × 252 / semi-écart-type', 'num'],
      ['calmar', 'Ratio de Calmar', 'TCAM / |max drawdown|', 'num'],
      ['omega', 'Ratio Omega (seuil r_f)', 'Σ max(rₜ − τ, 0) / Σ max(τ − rₜ, 0)', 'num'],
    ]],
  ];
  const REL_DEFS = [
    ['beta', 'Bêta', 'cov(rₛ, rₘ) / var(rₘ)', 'num'],
    ['alpha_jensen_ann', 'Alpha de Jensen annualisé', '[moy(rₛ) − (r_f + β(moy(rₘ) − r_f))] × 252', 'pct'],
    ['correlation', 'Corrélation', 'ρ(rₛ, rₘ)', 'num'],
    ['r_squared', 'R²', 'ρ²', 'num'],
    ['treynor', 'Ratio de Treynor', '(moy(rₛ) × 252 − r_f) / β', 'num'],
    ['tracking_error', 'Tracking error', 'écart-type(rₛ − rₘ) × √252', 'pct'],
    ['information_ratio', 'Ratio d\'information', 'moyenne(rₛ − rₘ) × 252 / tracking error', 'num'],
    ['upside_capture', 'Capture à la hausse', 'moy(rₛ | rₘ > 0) / moy(rₘ | rₘ > 0)', 'pct'],
    ['downside_capture', 'Capture à la baisse', 'moy(rₛ | rₘ < 0) / moy(rₘ | rₘ < 0)', 'pct'],
    ['benchmark_total_return', 'Rendement total de l\'indice', '', 'pct'],
  ];

  function tabRisk(body, d) {
    const rf0 = d.risk_free.value;
    body.innerHTML = `
      <div class="card"><div class="form-grid">
        <label class="field">Période<select id="rk-period">${[['6mo', '6 mois'], ['1y', '1 an'], ['3y', '3 ans'], ['5y', '5 ans'], ['10y', '10 ans'], ['max', 'Maximum']]
    .map(([k, l]) => `<option value="${k}" ${k === '1y' ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">Indice de référence<input id="rk-bench" type="text" value="${E(d.benchmark)}"></label>
        <label class="field">Taux sans risque (%)<input id="rk-rf" type="number" step="any" value="${Fm.isNum(rf0) ? (rf0 * 100).toFixed(3) : '0'}"></label>
        <label class="field">&nbsp;<button class="btn primary" id="rk-go">Calculer</button></label>
      </div><p class="small muted" style="margin:8px 0 0">Taux sans risque par défaut : ${E(d.risk_free.source || '')}. Rendements quotidiens sur cours ajustés, 252 séances par an.</p></div>
      <div id="rk-body">${loading()}</div>`;
    const run = async () => {
      const period = document.getElementById('rk-period').value;
      const bench = document.getElementById('rk-bench').value.trim();
      const rf = Number(document.getElementById('rk-rf').value) / 100;
      const out = document.getElementById('rk-body');
      out.innerHTML = loading();
      while (chartRegistry.length > 2) { const c = chartRegistry.pop(); try { c.remove ? c.remove() : c.destroy(); } catch (e) { /* */ } }
      try {
        const r = await api(`/api/risk/${encodeURIComponent(d.quote.symbol)}?period=${period}&benchmark=${encodeURIComponent(bench)}&rf=${rf}`);
        renderRisk(out, r);
      } catch (e) { out.innerHTML = errorBox(e); }
    };
    document.getElementById('rk-go').addEventListener('click', run);
    run();
  }

  function renderRisk(out, r) {
    const s = r.stats || {};
    const b = r.benchmark_stats || {};
    const rel = r.relative || {};
    const table = RISK_DEFS.map(([g, rows]) => `<h3>${E(g)}</h3><div class="table-wrap"><table class="metrics"><thead><tr><th>Indicateur</th><th class="num">Action</th><th class="num">${E(r.benchmark)}</th></tr></thead><tbody>${
      rows.map(([k, l, f, fmt]) => `<tr><td>${E(l)}<span class="formula">${E(f)}</span></td><td class="num">${Fm.by(fmt, s[k])}</td><td class="num">${Fm.by(fmt, b[k])}</td></tr>`).join('')}</tbody></table></div>`).join('');
    out.innerHTML = `
      <p class="muted small">Du ${E(s.start || '')} au ${E(s.end || '')} · ${Fm.int(s.observations)} rendements quotidiens · r_f = ${Fm.pct(r.rf, 3)}</p>
      <div class="grid cols-2">
        <div class="card"><h3 style="margin-top:0">Performance base 100 vs ${E(r.benchmark)}</h3><div class="chart-box" style="height:280px" id="rk-base"></div></div>
        <div class="card"><h3 style="margin-top:0">Drawdown</h3><div class="chart-box" style="height:280px" id="rk-dd"></div></div>
        <div class="card"><h3 style="margin-top:0">Distribution des rendements quotidiens</h3><div class="canvas-box"><canvas id="rk-hist"></canvas></div></div>
        <div class="card"><h3 style="margin-top:0">Volatilité glissante 21 séances (annualisée)</h3><div class="chart-box" style="height:260px" id="rk-vol"></div></div>
      </div>
      <h3>Mesures relatives à l'indice ${E(r.benchmark)} (${Fm.int(rel.common_observations)} séances communes)</h3>
      <div class="table-wrap"><table class="metrics"><tbody>${REL_DEFS.map(([k, l, f, fmt]) => metricRow(l, f, Fm.by(fmt, rel[k]))).join('')}</tbody></table></div>
      ${table}
      <h3>Rendements par année civile</h3><div class="card"><div class="canvas-box"><canvas id="rk-cal"></canvas></div></div>`;
    if (r.base100) {
      const ch = lwChart(document.getElementById('rk-base'));
      chartRegistry.push(ch);
      ch.addLineSeries({ color: css('--s1'), lineWidth: 2, title: 'Action' }).setData(lineData(r.base100.time, r.base100.stock));
      ch.addLineSeries({ color: css('--s2'), lineWidth: 2, title: r.benchmark }).setData(lineData(r.base100.time, r.base100.bench));
      ch.timeScale().fitContent();
    }
    const dd = lwChart(document.getElementById('rk-dd'), { localization: { locale: 'fr-FR', priceFormatter: (p) => Fm.pct(p, 1) } });
    chartRegistry.push(dd);
    dd.addAreaSeries({ lineColor: css('--down'), topColor: 'transparent', bottomColor: css('--down-soft'), lineWidth: 1, invertFilledArea: true })
      .setData(lineData(r.drawdown.time, r.drawdown.value));
    dd.timeScale().fitContent();
    const vol = lwChart(document.getElementById('rk-vol'), { localization: { locale: 'fr-FR', priceFormatter: (p) => Fm.pct(p, 1) } });
    chartRegistry.push(vol);
    vol.addLineSeries({ color: css('--s3'), lineWidth: 2 }).setData(lineData(r.rolling_vol.time, r.rolling_vol.value));
    vol.timeScale().fitContent();
    const h = r.histogram;
    cjs(document.getElementById('rk-hist'), {
      type: 'bar',
      data: { labels: h.counts.map((_, i) => Fm.pct((h.edges[i] + h.edges[i + 1]) / 2, 1)),
        datasets: [{ label: 'Séances', data: h.counts, backgroundColor: h.counts.map((_, i) => ((h.edges[i] + h.edges[i + 1]) / 2 >= 0 ? css('--up') : css('--down'))) }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 10 } } } },
    });
    cjs(document.getElementById('rk-cal'), {
      type: 'bar',
      data: { labels: r.calendar.map((c) => c.year + (c.partial ? '*' : '')),
        datasets: [{ label: 'Rendement', data: r.calendar.map((c) => c.return), backgroundColor: r.calendar.map((c) => (c.return >= 0 ? css('--up') : css('--down'))) }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => Fm.signedPct(c.raw) } } },
        scales: { y: { ticks: { callback: (v) => Fm.pct(v, 0) } } } },
    });
  }

  // ---------------- Technique ----------------

  function tabTechnical(body, d) {
    const t = d.technical;
    const ccy = d.quote.currency_raw;
    const rows = [
      ['Moyennes mobiles', [
        ['MM 20 / 50 / 200', 'SMA = moyenne des n dernières clôtures', `${Fm.num(t.sma20)} / ${Fm.num(t.sma50)} / ${Fm.num(t.sma200)}`],
        ['MME 12 / 26', 'EMA_t = α·P_t + (1 − α)·EMA_{t−1}, α = 2/(n + 1)', `${Fm.num(t.ema12)} / ${Fm.num(t.ema26)}`],
        ['Cours vs MM 50', 'Cours / MM50 − 1', `<span class="${Fm.cls(t.price_vs_sma50)}">${Fm.signedPct(t.price_vs_sma50)}</span>`],
        ['Cours vs MM 200', 'Cours / MM200 − 1', `<span class="${Fm.cls(t.price_vs_sma200)}">${Fm.signedPct(t.price_vs_sma200)}</span>`],
        ['Dernier croisement MM50 / MM200', 'Golden cross : MM50 passe au-dessus de MM200 ; death cross : en dessous',
          t.last_cross ? `<span class="badge ${t.last_cross.type === 'golden cross' ? 'up' : 'down'}">${E(t.last_cross.type)}</span> ${E(t.last_cross.date)}` : '—'],
        ['VWAP 20 séances', 'Σ(TP × V) / ΣV, TP = (H + B + C)/3', Fm.num(t.vwap20)],
      ]],
      ['Momentum', [
        ['RSI (14)', 'RSI = 100 − 100/(1 + RS), RS = moyenne des hausses / moyenne des baisses (lissage de Wilder)',
          `${Fm.num(t.rsi)} ${t.rsi_signal ? `<span class="badge ${t.rsi_signal === 'neutre' ? 'neutral' : 'warn'}">${E(t.rsi_signal)}</span>` : ''}`],
        ['MACD (12, 26, 9)', 'MACD = MME12 − MME26 ; signal = MME9(MACD) ; histogramme = MACD − signal',
          `${Fm.num(t.macd, 3)} / ${Fm.num(t.macd_signal, 3)} / <span class="${Fm.cls(t.macd_hist)}">${Fm.num(t.macd_hist, 3)}</span>`],
        ['Stochastique %K / %D', '%K = 100 × (C − B14)/(H14 − B14) ; %D = MM3(%K)', `${Fm.num(t.stoch_k)} / ${Fm.num(t.stoch_d)}`],
        ['Williams %R (14)', '−100 × (H14 − C)/(H14 − B14)', Fm.num(t.williams_r)],
        ['CCI (20)', '(TP − MM20(TP)) / (0,015 × écart moyen absolu)', Fm.num(t.cci)],
        ['ROC (12)', '100 × (C_t / C_{t−12} − 1)', Fm.num(t.roc12)],
        ['MFI (14)', '100 − 100/(1 + flux monétaires positifs / négatifs)', Fm.num(t.mfi)],
      ]],
      ['Tendance et volatilité', [
        ['ADX (14)', 'Moyenne lissée de DX = 100 × |+DI − −DI| / (+DI + −DI) ; > 25 : tendance marquée', Fm.num(t.adx)],
        ['+DI / −DI', 'Indicateurs directionnels de Wilder', `${Fm.num(t.plus_di)} / ${Fm.num(t.minus_di)}`],
        ['ATR (14)', 'Moyenne de Wilder du True Range = max(H − B, |H − C_{t−1}|, |B − C_{t−1}|)', `${Fm.num(t.atr)} (${Fm.pct(t.atr_pct)} du cours)`],
        ['Bandes de Bollinger (20, 2)', 'MM20 ± 2 écarts-types', `${Fm.num(t.bb_lower)} – ${Fm.num(t.bb_upper)}`],
        ['%B de Bollinger', '(C − bande basse) / (bande haute − bande basse)', Fm.num(t.bb_percent_b, 3)],
        ['Largeur de bande', '(bande haute − bande basse) / MM20', Fm.pct(t.bb_bandwidth)],
        ['OBV', 'OBV_t = OBV_{t−1} + signe(ΔC) × Volume', Fm.big(t.obv)],
      ]],
    ];
    body.innerHTML = `<div class="notice">Indicateurs calculés sur les cours quotidiens non ajustés des dividendes (ajustés des divisions), dernière séance. Cours en ${E(ccy || '')}.</div>
      ${rows.map(([g, rs]) => `<h3>${E(g)}</h3><div class="table-wrap"><table class="metrics"><tbody>${rs.map(([l, f, v]) => metricRow(l, f, v)).join('')}</tbody></table></div>`).join('')}
      <div class="grid cols-2">
        <div><h3>Points pivots (dernière séance)</h3><p class="small muted">P = (H + B + C)/3 ; R1 = 2P − B ; S1 = 2P − H ; R2 = P + (H − B) ; S2 = P − (H − B) ; R3 = H + 2(P − B) ; S3 = B − 2(H − P)</p>
          <table class="compact"><tbody>${['R3', 'R2', 'R1', 'P', 'S1', 'S2', 'S3'].map((k) => metricRow(k, '', Fm.num(t.pivots[k]))).join('')}</tbody></table></div>
        <div><h3>Retracements de Fibonacci (52 semaines)</h3><p class="small muted">Niveau = Plus haut − ratio × (Plus haut − Plus bas)</p>
          <table class="compact"><tbody>${Object.entries(t.fibonacci_52w).map(([k, v]) => metricRow(k, '', Fm.num(v))).join('')}</tbody></table></div>
      </div>`;
  }

  // ---------------- Finance d'entreprise ----------------

  function tabCorporate(body, d) {
    const c = d.dcf;
    const ccy = c.currency;
    const pct = (v, def) => (Fm.isNum(v) ? +(v * 100).toFixed(3) : def);
    const defG = Fm.isNum(c.revenue_cagr) ? Math.min(Math.max(c.revenue_cagr, 0), 0.15) : 0.05;
    const beta0 = Fm.isNum(c.beta_monthly_5y) ? c.beta_monthly_5y : (Fm.isNum(c.beta_yahoo) ? c.beta_yahoo : 1);
    const fields = [
      ['rf', 'Taux sans risque r_f (%)', pct(c.rf, 4)],
      ['beta', 'Bêta', +beta0.toFixed(4)],
      ['erp', 'Prime de risque du marché (%)', 5.5],
      ['kd', 'Coût de la dette avant impôt (%)', pct(c.cost_of_debt, 5)],
      ['tax', 'Taux d\'impôt (%)', pct(c.tax_rate, 25)],
      ['E', `Capitaux propres E (${ccy})`, c.market_cap || 0],
      ['D', `Dette financière D (${ccy})`, c.debt || 0],
      ['fcff', `FCFF de base (${ccy})`, c.fcff || 0],
      ['g', 'Croissance du FCFF, années 1 à n (%)', pct(defG, 5)],
      ['n', 'Durée de la phase explicite (années)', 5],
      ['gt', 'Croissance à l\'infini g (%)', 2.5],
      ['cash', `Trésorerie et placements (${ccy})`, c.cash || 0],
      ['minority', `Intérêts minoritaires (${ccy})`, c.minority || 0],
      ['shares', 'Nombre d\'actions', c.shares || 0],
      ['d0', `Dividende par action D₀ (${ccy})`, c.dividend_per_share || 0],
      ['gd', 'Croissance du dividende (%)', 3],
    ];
    body.innerHTML = `
      <div class="notice">Les champs sont pré-remplis avec les données de l'entreprise (bêta 5 ans mensuel vs ${E(d.benchmark)}, coût de la dette = intérêts / dette financière, FCFF des 12 derniers mois). La prime de risque et les croissances sont des <b>hypothèses modifiables</b>. Le poids de la dette utilise sa valeur comptable.</div>
      <div class="card"><form class="form-grid" id="cf-form">${fields.map(([k, l, v]) => `<label class="field">${E(l)}<input name="${k}" type="number" step="any" value="${E(Fm.isNum(v) ? +v.toPrecision(10) : v)}"></label>`).join('')}</form></div>
      <div id="cf-out"></div>`;
    const form = document.getElementById('cf-form');
    const update = () => {
      const v = {};
      fields.forEach(([k]) => { v[k] = Number(form.elements[k].value); });
      ['rf', 'erp', 'kd', 'tax', 'g', 'gt', 'gd'].forEach((k) => { v[k] /= 100; });
      renderCorporate(document.getElementById('cf-out'), v, c, ccy);
    };
    form.addEventListener('input', update);
    update();
  }

  function renderCorporate(out, v, c, ccy) {
    const ke = F.capmFromPremium(v.rf, v.beta, v.erp);
    const w = F.wacc(v.E, v.D, ke, v.kd, v.tax);
    const netDebt = v.D - v.cash;
    const params = { fcff0: v.fcff, years: Math.max(1, Math.round(v.n)), terminalGrowth: v.gt, waccRate: w, netDebt, minority: v.minority, shares: v.shares };
    const r = F.dcf({ ...params, growth: v.g });
    const price = c.price;
    const upside = r && Fm.isNum(r.perShare) && price ? r.perShare / price - 1 : null;
    const implied = v.fcff > 0 && price ? F.reverseDCF(params, price) : NaN;
    const ddm = F.gordon(v.d0, ke, v.gd);
    const bu = v.E > 0 ? F.unleverBeta(v.beta, v.D, v.E, v.tax) : NaN;
    const evaV = Fm.isNum(c.nopat) && Fm.isNum(c.invested_capital) ? F.eva(c.nopat, w, c.invested_capital) : null;
    const roic = Fm.isNum(c.nopat) && c.invested_capital > 0 ? c.nopat / c.invested_capital : null;
    const sens = [];
    const dw = [-0.01, -0.005, 0, 0.005, 0.01];
    const dg = [-0.01, -0.005, 0, 0.005, 0.01];
    for (const a of dw) {
      sens.push(dg.map((b) => {
        const x = F.dcf({ ...params, growth: v.g, waccRate: w + a, terminalGrowth: v.gt + b });
        return x ? x.perShare : null;
      }));
    }
    out.innerHTML = `
      <h3>Coût du capital</h3>
      <div class="table-wrap"><table class="metrics"><tbody>
        ${metricRow('Coût des fonds propres k_e (MEDAF)', 'k_e = r_f + β × prime de risque', Fm.pct(ke))}
        ${metricRow('Coût de la dette après impôt', 'k_d × (1 − t)', Fm.pct(v.kd * (1 - v.tax)))}
        ${metricRow('Poids des fonds propres', 'E / (D + E)', Fm.pct(v.E / (v.D + v.E)))}
        ${metricRow('Poids de la dette', 'D / (D + E)', Fm.pct(v.D / (v.D + v.E)))}
        ${metricRow('CMPC (WACC)', 'E/(D+E) × k_e + D/(D+E) × k_d × (1 − t)', `<b>${Fm.pct(w)}</b>`)}
        ${metricRow('Bêta désendetté (Hamada)', 'β_U = β_L / [1 + (1 − t) D/E]', Fm.num(bu, 4))}
      </tbody></table></div>
      <h3>DCF — actualisation des flux disponibles pour la firme (FCFF)</h3>
      ${v.fcff <= 0 ? '<div class="notice">FCFF de base négatif ou nul : un DCF n\'est pas significatif sans hypothèse de redressement des flux.</div>' : ''}
      ${!r ? '<div class="error">Le CMPC doit être strictement supérieur à la croissance à l\'infini.</div>' : `
      <div class="formula-box">VE = Σ FCFFₜ/(1 + CMPC)ᵗ + [FCFFₙ × (1 + g)/(CMPC − g)]/(1 + CMPC)ⁿ ; Valeur des fonds propres = VE − Dette nette − Minoritaires</div>
      <div class="table-wrap"><table class="compact"><thead><tr><th>Année</th>${r.rows.map((x) => `<th class="num">${x.year}</th>`).join('')}<th class="num">Valeur terminale</th></tr></thead><tbody>
        <tr><td>FCFF</td>${r.rows.map((x) => `<td class="num">${Fm.big(x.fcff)}</td>`).join('')}<td class="num">${Fm.big(r.tv)}</td></tr>
        <tr><td>Facteur d'actualisation</td>${r.rows.map((x) => `<td class="num">${Fm.num(x.discount, 4)}</td>`).join('')}<td class="num">${Fm.num(r.rows[r.rows.length - 1].discount, 4)}</td></tr>
        <tr><td>Valeur actuelle</td>${r.rows.map((x) => `<td class="num">${Fm.big(x.pv)}</td>`).join('')}<td class="num">${Fm.big(r.pvTv)}</td></tr>
      </tbody></table></div>
      <div class="result-grid">
        <div class="kpi"><div class="k-label">Valeur d'entreprise</div><div class="k-value">${Fm.money(r.ev, ccy)}</div><div class="k-sub">dont valeur terminale ${Fm.pct(r.tvShare, 1)}</div></div>
        <div class="kpi"><div class="k-label">Dette nette</div><div class="k-value">${Fm.money(netDebt, ccy)}</div></div>
        <div class="kpi"><div class="k-label">Valeur des fonds propres</div><div class="k-value">${Fm.money(r.equity, ccy)}</div></div>
        <div class="kpi"><div class="k-label">Valeur par action</div><div class="k-value">${Fm.price(r.perShare, ccy)}</div><div class="k-sub">cours ${Fm.price(price, ccy)}</div></div>
        <div class="kpi"><div class="k-label">Potentiel</div><div class="k-value ${Fm.cls(upside)}">${Fm.signedPct(upside)}</div></div>
        <div class="kpi"><div class="k-label">Croissance implicite du cours (DCF inversé)</div><div class="k-value">${Fm.pct(implied)}</div><div class="k-sub">croissance du FCFF sur ${params.years} ans justifiant le cours</div></div>
      </div>
      <h3>Sensibilité de la valeur par action (${E(ccy)})</h3>
      <div class="table-wrap"><table class="compact sens"><thead><tr><th>CMPC \\ g</th>${dg.map((b) => `<th class="num">${Fm.pct(v.gt + b)}</th>`).join('')}</tr></thead><tbody>
        ${sens.map((row, i) => `<tr><th>${Fm.pct(w + dw[i])}</th>${row.map((x, j) => `<td class="num ${i === 2 && j === 2 ? 'hl' : ''}">${Fm.num(x)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>`}
      <h3>Autres modèles</h3>
      <div class="table-wrap"><table class="metrics"><tbody>
        ${metricRow('Modèle de Gordon-Shapiro (DDM)', 'P₀ = D₀ × (1 + g) / (k_e − g)', v.d0 > 0 ? Fm.price(ddm, ccy) : '— (pas de dividende)')}
        ${metricRow('Rendement exigé implicite (Gordon)', 'k = D₁ / P₀ + g', v.d0 > 0 && price ? Fm.pct(F.impliedCostOfEquity(v.d0 * (1 + v.gd), price, v.gd)) : '—')}
        ${metricRow('NOPAT', 'EBIT × (1 − t)', Fm.money(c.nopat, ccy))}
        ${metricRow('Capitaux investis', 'Capitaux propres + Dette financière − Trésorerie', Fm.money(c.invested_capital, ccy))}
        ${metricRow('ROIC', 'NOPAT / Capitaux investis', Fm.pct(roic))}
        ${metricRow('Spread de création de valeur', 'ROIC − CMPC', `<span class="${Fm.isNum(roic) ? Fm.cls(roic - w) : ''}">${Fm.isNum(roic) ? Fm.signedPct(roic - w) : '—'}</span>`)}
        ${metricRow('EVA (Economic Value Added)', 'NOPAT − CMPC × Capitaux investis', `<span class="${Fm.cls(evaV)}">${Fm.money(evaV, ccy)}</span>`)}
        ${metricRow('Taux de croissance soutenable', 'ROE × (1 − taux de distribution)', Fm.isNum(c.roe) && Fm.isNum(c.payout) ? Fm.pct(c.roe * (1 - c.payout)) : '—')}
      </tbody></table></div>`;
  }

  // ---------------- États financiers ----------------

  const LABELS_FR = {
    TotalRevenue: 'Chiffre d\'affaires', CostOfRevenue: 'Coût des ventes', GrossProfit: 'Résultat brut', OperatingExpense: 'Charges opérationnelles',
    OperatingIncome: 'Résultat opérationnel', EBIT: 'EBIT', EBITDA: 'EBITDA', InterestExpense: 'Charges d\'intérêts', PretaxIncome: 'Résultat avant impôt',
    TaxProvision: 'Impôt sur les sociétés', NetIncome: 'Résultat net', NetIncomeCommonStockholders: 'Résultat net part des actionnaires ordinaires',
    DilutedEPS: 'BPA dilué', BasicEPS: 'BPA de base', DilutedAverageShares: 'Nombre moyen d\'actions dilué', ResearchAndDevelopment: 'Recherche et développement',
    SellingGeneralAndAdministration: 'Frais commerciaux, généraux et administratifs', TotalAssets: 'Total de l\'actif', CurrentAssets: 'Actif courant',
    CashAndCashEquivalents: 'Trésorerie et équivalents', CashCashEquivalentsAndShortTermInvestments: 'Trésorerie et placements à court terme',
    AccountsReceivable: 'Créances clients', Inventory: 'Stocks', NetPPE: 'Immobilisations corporelles nettes', Goodwill: 'Écarts d\'acquisition (goodwill)',
    GoodwillAndOtherIntangibleAssets: 'Goodwill et incorporels', CurrentLiabilities: 'Passif courant', AccountsPayable: 'Dettes fournisseurs',
    TotalDebt: 'Dette financière totale', LongTermDebt: 'Dette à long terme', NetDebt: 'Dette nette (Yahoo)', StockholdersEquity: 'Capitaux propres',
    TotalLiabilitiesNetMinorityInterest: 'Total des dettes', RetainedEarnings: 'Réserves (bénéfices non distribués)', WorkingCapital: 'Fonds de roulement',
    InvestedCapital: 'Capitaux investis (Yahoo)', OrdinarySharesNumber: 'Nombre d\'actions ordinaires', TangibleBookValue: 'Actif net tangible',
    MinorityInterest: 'Intérêts minoritaires', OperatingCashFlow: 'Flux de trésorerie d\'exploitation', CapitalExpenditure: 'Investissements (CapEx)',
    FreeCashFlow: 'Free cash flow', InvestingCashFlow: 'Flux d\'investissement', FinancingCashFlow: 'Flux de financement',
    CashDividendsPaid: 'Dividendes versés', RepurchaseOfCapitalStock: 'Rachats d\'actions', DepreciationAndAmortization: 'Dotations aux amortissements',
    StockBasedCompensation: 'Rémunération en actions', ChangeInWorkingCapital: 'Variation du BFR', EndCashPosition: 'Trésorerie de clôture',
  };
  const labelOf = (k) => LABELS_FR[k] || k.replace(/([a-z])([A-Z])/g, '$1 $2');

  function tabStatements(body, d) {
    const st = d.statements;
    const opts = [['income', 'Compte de résultat'], ['balance', 'Bilan'], ['cashflow', 'Flux de trésorerie']];
    let kind = 'income';
    let freq = '';
    body.innerHTML = `<div class="chart-toolbar"><div class="chips" id="st-kind">${opts.map(([k, l], i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
      <div class="chips" id="st-freq"><button class="chip active" data-f="">Annuel</button><button class="chip" data-f="_q">Trimestriel</button></div></div>
      <p class="muted small">Montants publiés en ${E(d.quote.financial_currency || '')}, tels que fournis par Yahoo Finance.</p><div id="st-body" class="table-wrap"></div>`;
    const render = () => {
      const t = st[kind + freq];
      const el = document.getElementById('st-body');
      if (!t || !t.rows.length) { el.innerHTML = '<p class="muted">Aucune donnée.</p>'; return; }
      el.innerHTML = `<table class="compact"><thead><tr><th>Poste</th>${t.columns.map((c) => `<th class="num">${E(c)}</th>`).join('')}</tr></thead>
        <tbody>${t.rows.map((r) => `<tr><td>${E(labelOf(r.key))}</td>${r.values.map((v) => `<td class="num">${Math.abs(v) < 1000 && Fm.isNum(v) ? Fm.num(v, 4) : Fm.int(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    };
    document.getElementById('st-kind').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-k]'); if (!b) return;
      kind = b.dataset.k;
      document.querySelectorAll('#st-kind .chip').forEach((x) => x.classList.toggle('active', x === b));
      render();
    });
    document.getElementById('st-freq').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-f]'); if (!b) return;
      freq = b.dataset.f;
      document.querySelectorAll('#st-freq .chip').forEach((x) => x.classList.toggle('active', x === b));
      render();
    });
    render();
  }

  function tabDividends(body, d) {
    const divs = (d.dividends || []).slice().reverse();
    body.innerHTML = `<div class="grid cols-2">
      <div><h3 style="margin-top:0">Historique des dividendes (${E(d.quote.currency_raw || '')})</h3>
        ${divs.length ? `<div class="table-wrap"><table class="compact"><thead><tr><th>Date de détachement</th><th class="num">Montant</th></tr></thead>
        <tbody>${divs.map((x) => `<tr><td>${E(x.date)}</td><td class="num">${Fm.num(x.amount, 4)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aucun dividende versé.</p>'}</div>
      <div><h3 style="margin-top:0">Actualités</h3><div id="news">${loading()}</div></div></div>`;
    api('/api/news/' + encodeURIComponent(d.quote.symbol)).then((items) => {
      document.getElementById('news').innerHTML = items.length ? items.map((n) => `<div class="card" style="margin-bottom:8px">
        <a href="${E(n.link)}" target="_blank" rel="noopener"><b>${E(n.title)}</b></a>
        <div class="small muted">${E(n.publisher || '')} · ${n.date ? E(new Date(n.date).toLocaleString('fr-FR')) : ''}</div>
        ${n.summary ? `<div class="small">${E(n.summary)}</div>` : ''}</div>`).join('') : '<p class="muted">Aucune actualité.</p>';
    }).catch((e) => { document.getElementById('news').innerHTML = errorBox(e); });
  }

  // ------------------------------------------------------------------
  // Comparateur
  // ------------------------------------------------------------------

  const CMP_COLS = [['price', 'Cours', 'price'], ['change_pct', 'Var. jour', 'spct'], ['market_cap', 'Capitalisation', 'money'], ['pe', 'PER', 'x'],
    ['pb', 'P/B', 'x'], ['ps', 'P/S', 'x'], ['ev_ebitda', 'VE/EBITDA', 'x'], ['fcf_yield', 'Rdt FCF', 'pct'], ['dividend_yield', 'Rdt div.', 'pct'],
    ['gross_margin', 'Marge brute', 'pct'], ['operating_margin', 'Marge op.', 'pct'], ['net_margin', 'Marge nette', 'pct'], ['roe', 'ROE', 'pct'],
    ['roic', 'ROIC', 'pct'], ['debt_to_equity', 'D/E', 'x'], ['current_ratio', 'Liquidité gén.', 'x'], ['revenue_growth', 'Croiss. CA', 'pct'],
    ['total_return', 'Perf. période', 'spct'], ['cagr', 'TCAM', 'pct'], ['volatility', 'Volatilité', 'pct'], ['sharpe', 'Sharpe', 'num'], ['max_drawdown', 'Max DD', 'pct']];

  async function viewCompare(params) {
    const initial = (params.get('s') || store.get('compare', 'AAPL,MSFT,GOOGL')).toUpperCase();
    app.innerHTML = `<div class="hero"><h1>Comparateur</h1><p class="muted">Jusqu'à 8 symboles séparés par des virgules. Ratios du dernier exercice, performance et risque sur la période choisie.</p></div>
      <div class="card"><div class="form-grid">
        <label class="field" style="grid-column:span 2">Symboles<input id="cmp-s" type="text" value="${E(initial)}"></label>
        <label class="field">Période<select id="cmp-p">${[['6mo', '6 mois'], ['1y', '1 an'], ['3y', '3 ans'], ['5y', '5 ans'], ['10y', '10 ans']]
    .map(([k, l]) => `<option value="${k}" ${k === '1y' ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">&nbsp;<button class="btn primary" id="cmp-go">Comparer</button></label></div></div>
      <div id="cmp-out"></div>`;
    const run = async () => {
      destroyCharts();
      const s = document.getElementById('cmp-s').value.replace(/\s+/g, '');
      store.set('compare', s);
      const out = document.getElementById('cmp-out');
      out.innerHTML = loading('Analyse comparative en cours (quelques secondes par valeur)…');
      try {
        const r = await api(`/api/compare?symbols=${encodeURIComponent(s)}&period=${document.getElementById('cmp-p').value}`);
        const rows = r.rows;
        out.innerHTML = `<h3>Performance base 100</h3><div class="card"><div class="chart-box" style="height:340px" id="cmp-chart"></div></div>
          <h3>Tableau comparatif</h3><div class="table-wrap"><table class="compact"><thead><tr><th>Valeur</th>${CMP_COLS.map(([, l]) => `<th class="num">${E(l)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map((x) => (x.error ? `<tr><td>${E(x.symbol)}</td><td colspan="${CMP_COLS.length}" class="down">${E(x.error)}</td></tr>`
    : `<tr><td><a href="#/stock/${encodeURIComponent(x.symbol)}"><b>${E(x.symbol)}</b></a><div class="small muted">${E(x.name)}</div></td>${CMP_COLS.map(([k, , f]) => {
      const v = x[k];
      const txt = f === 'spct' ? `<span class="${Fm.cls(v)}">${Fm.signedPct(v)}</span>` : f === 'price' || f === 'money' ? Fm.by(f, v, x.currency) : Fm.by(f, v);
      return `<td class="num">${txt}</td>`;
    }).join('')}</tr>`)).join('')}</tbody></table></div>
          <p class="muted small">Montants dans la devise de cotation de chaque valeur. r_f = ${Fm.pct(r.rf, 3)} pour le ratio de Sharpe.</p>`;
        if (r.base100 && r.base100.time) {
          const ch = lwChart(document.getElementById('cmp-chart'));
          chartRegistry.push(ch);
          Object.keys(r.base100.series).forEach((k, i) => {
            ch.addLineSeries({ color: css(`--s${(i % 8) + 1}`), lineWidth: 2, title: k }).setData(lineData(r.base100.time, r.base100.series[k]));
          });
          ch.timeScale().fitContent();
        }
      } catch (e) { out.innerHTML = errorBox(e); }
    };
    document.getElementById('cmp-go').addEventListener('click', run);
    run();
  }

  // ------------------------------------------------------------------
  // Routeur
  // ------------------------------------------------------------------

  function route() {
    destroyCharts();
    const hash = location.hash.replace(/^#/, '') || '/';
    const [path, query] = hash.split('?');
    const parts = path.split('/').filter(Boolean);
    document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#/' + (parts[0] || '')));
    window.scrollTo(0, 0);
    if (parts[0] === 'stock' && parts[1]) viewStock(decodeURIComponent(parts[1]).toUpperCase(), parts[2] || 'summary');
    else if (parts[0] === 'compare') viewCompare(new URLSearchParams(query || ''));
    else if (parts[0] === 'calculators') window.Calculators.renderCalculators(app, parts[1]);
    else viewHome();
  }
  window.addEventListener('hashchange', route);
  route();
})();
