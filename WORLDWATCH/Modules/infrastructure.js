
/* ============================================================
 WORLDWATCH // PHASE 14 // INFRASTRUCTURE OPERATIONS
 FILE: modules/infrastructure.js

 DATA:
  - Cloudflare Status and GitHub Status: actual provider statuses
  - GDELT DOC: infrastructure news and coverage trend
  - GDELT GEO: places mentioned in related reporting

 MAP POINTS ARE NEWS-MENTIONED PLACES, NOT VERIFIED OUTAGES.
 Cloudflare/GitHub status does not measure global internet health.

 OPTIONAL HOME-SERVER PROXY (not yet implemented):
 window.WORLDWATCH_INFRA_API = '/api/infra';
 Expected GET paths beneath it:
   /gdelt/doc?{original GDELT DOC query}
   /gdelt/geo?{original GDELT GEO query}
   /status/cloudflare  (Statuspage summary JSON)
   /status/github      (Statuspage summary JSON)
 Keep the proxy authenticated and respect provider API terms.
 ============================================================ */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const DOC = 'https://api.gdeltproject.org/api/v2/doc/doc';
  const GEO = 'https://api.gdeltproject.org/api/v2/geo/geo';
  const PROXY = typeof window.WORLDWATCH_INFRA_API === 'string'
    ? window.WORLDWATCH_INFRA_API.replace(/\/$/, '') : '';
  const AUTO_MS = 12 * 60 * 1000;
  const CACHE_MS = 6 * 60 * 1000;
  const MANUAL_COOLDOWN_MS = 45 * 1000;
  const LIMIT_POINTS = 120;

  const TOPICS = {
    power: { label: 'POWER GRID', query: '("power outage" OR blackout OR "grid failure" OR "rolling blackouts")' },
    network: { label: 'INTERNET / TELECOM', query: '("internet outage" OR "network disruption" OR "telecom outage" OR "submarine cable")' },
    transport: { label: 'TRANSPORT', query: '("rail disruption" OR "port closure" OR "airport shutdown" OR "shipping disruption")' },
    energy: { label: 'ENERGY', query: '("pipeline outage" OR "refinery fire" OR "oil terminal" OR "gas supply disruption")' }
  };

  const REGIONS = {
    global: { label: 'GLOBAL', words: '', near: '', box: () => true },
    americas: { label: 'AMERICAS', words: '("United States" OR Canada OR Mexico OR Brazil OR Venezuela OR Haiti)', near: 'near:15,-85,7000km', box: (a,b) => a > -60 && a < 85 && b < -30 && b > -170 },
    europe: { label: 'EUROPE', words: '(Europe OR Ukraine OR Russia OR Germany OR France OR Britain)', near: 'near:52,20,2800km', box: (a,b) => a >= 35 && a <= 73 && b >= -13 && b <= 60 },
    'middle-east': { label: 'MIDDLE EAST', words: '(Iran OR Israel OR Yemen OR Syria OR Iraq OR Saudi OR Lebanon)', near: 'near:28,47,2800km', box: (a,b) => a >= 10 && a <= 43 && b >= 28 && b <= 65 },
    'asia-pacific': { label: 'ASIA / PACIFIC', words: '(China OR Japan OR Taiwan OR Philippines OR India OR Pakistan OR Australia)', near: 'near:20,115,9000km', box: (a,b) => a >= -50 && a <= 75 && (b >= 60 || b <= -120) },
    africa: { label: 'AFRICA', words: '(Africa OR Nigeria OR Sudan OR Somalia OR Ethiopia OR Kenya OR Congo)', near: 'near:0,22,5200km', box: (a,b) => a >= -36 && a <= 38 && b >= -20 && b <= 54 }
  };

  const PROVIDERS = [
    { id: 'cloudflare', name: 'CLOUDFLARE', url: 'https://www.cloudflarestatus.com/api/v2/summary.json', page: 'https://www.cloudflarestatus.com/' },
    { id: 'github', name: 'GITHUB', url: 'https://www.githubstatus.com/api/v2/summary.json', page: 'https://www.githubstatus.com/' }
  ];

  const S = {
    started: false, map: null, layer: null,
    region: 'global', topic: 'power', period: '24h',
    articles: [], points: [], trend: [],
    articlesOk: false, geoOk: false, trendOk: false,
    articleError: '', geoError: '', trendError: '',
    providerState: {}, providerError: {},
    updated: null, fetching: false, generation: 0,
    lastAttempt: 0, timer: null, cache: new Map(),
    current: null
  };

  function elem(tag, cls, txt) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (txt !== undefined) node.textContent = String(txt);
    return node;
  }
  function put(id, txt) { if ($(id)) $(id).textContent = String(txt); }
  function button(label, fn, className = '') {
    const b = elem('button', 'ww-inf-button ' + className, label);
    b.type = 'button'; b.addEventListener('click', fn); return b;
  }
  function link(label, url) {
    let checked;
    try { checked = new URL(url); } catch (_) { return null; }
    if (!['https:', 'http:'].includes(checked.protocol)) return null;
    const a = elem('a', 'ww-inf-link', label);
    a.href = checked.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }
  function validNum(x) {
    if (x === null || x === undefined || x === '') return null;
    const n = Number(x); return Number.isFinite(n) ? n : null;
  }
  function dateValue(v) {
    const s = String(v || '');
    if (/^\d{14}$/.test(s)) return new Date(s.replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/, '$1-$2-$3T$4:$5:$6Z'));
    if (/^\d{8}T\d{6}Z$/.test(s)) return new Date(s.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z'));
    return new Date(s);
  }
  function utc(v) {
    const d = v instanceof Date ? v : dateValue(v);
    return d && Number.isFinite(d.getTime()) ? d.toISOString().slice(0,16).replace('T',' ') + 'Z' : '--';
  }
  function safeError(e) {
    if (e?.name === 'AbortError') return 'TIMEOUT';
    if (e instanceof TypeError) return 'NETWORK / CORS / POLICY';
    return String(e?.message || e).slice(0, 95);
  }
  const selectedKey = () => [S.topic, S.region, S.period].join('|');
  const geoSpan = () => S.period === '30d' ? '7d' : S.period;
  const queryDoc = () => TOPICS[S.topic].query + (REGIONS[S.region].words ? ' ' + REGIONS[S.region].words : '');
  const queryGeo = () => TOPICS[S.topic].query + (REGIONS[S.region].near ? ' ' + REGIONS[S.region].near : '');
  const apiURL = (base, params) => base + '?' + new URLSearchParams(params).toString();
  function gdeltURL(mode) {
    return apiURL(PROXY ? PROXY + '/gdelt/doc' : DOC, {
      query: queryDoc(), mode, format: 'json', timespan: S.period,
      ...(mode === 'artlist' ? { maxrecords: 60, sort: 'datedesc' } : {})
    });
  }
  function geoURL() {
    return apiURL(PROXY ? PROXY + '/gdelt/geo' : GEO, {
      query: queryGeo(), mode: 'pointdata', format: 'geojson',
      timespan: geoSpan(), maxpoints: 120
    });
  }

  async function fetchJSON(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 18000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!r.ok) throw Error('HTTP ' + r.status);
      const raw = await r.text();
      if (/^\s*</.test(raw)) throw Error('HTML RETURNED, NOT JSON');
      try { return JSON.parse(raw); } catch (_) { throw Error('INVALID JSON RESPONSE'); }
    } finally { clearTimeout(timer); }
  }
  async function cachedJSON(url) {
    const c = S.cache.get(url);
    if (c && Date.now() - c.when < CACHE_MS) return c.data;
    const data = await fetchJSON(url);
    S.cache.set(url, { when: Date.now(), data });
    if (S.cache.size > 75) S.cache.delete(S.cache.keys().next().value);
    return data;
  }

  function parseArticles(payload) {
    if (!Array.isArray(payload?.articles)) throw Error('UNEXPECTED ARTICLES FORMAT');
    const seen = new Set();
    return payload.articles.map(item => {
      const url = String(item.url || '');
      const a = link('', url);
      return a ? {
        title: String(item.title || '').trim(), url: a.href,
        source: String(item.domain || 'SOURCE UNKNOWN'), date: dateValue(item.seendate),
        sourceCountry: String(item.sourcecountry || '')
      } : null;
    }).filter(item => {
      if (!item?.title || seen.has(item.url)) return false;
      seen.add(item.url); return true;
    }).sort((a,b) => b.date - a.date).slice(0,60);
  }
  function parseTrend(payload) {
    const rows = payload?.timeline?.[0]?.data;
    if (!Array.isArray(rows)) throw Error('UNEXPECTED TIMELINE FORMAT');
    return rows.map(item => ({ time: dateValue(item.date), value: validNum(item.value) }))
      .filter(p => Number.isFinite(p.time.getTime()) && p.value !== null && p.value >= 0)
      .sort((a,b) => a.time - b.time);
  }
  function parseGeo(payload) {
    if (!Array.isArray(payload?.features)) throw Error('UNEXPECTED GEOJSON FORMAT');
    return payload.features.map(f => {
      const c = f?.geometry?.coordinates, p = f?.properties || {};
      if (f?.geometry?.type !== 'Point' || !Array.isArray(c)) return null;
      const lat = validNum(c[1]), lon = validNum(c[0]);
      if (lat === null || lon === null || Math.abs(lat)>90 || Math.abs(lon)>180) return null;
      let sourceURL = String(p.url || '');
      // The GEO API frequently stores article anchors in the popup HTML.
      if (!sourceURL && typeof p.html === 'string') {
        const documentFragment = new DOMParser().parseFromString(p.html, 'text/html');
        sourceURL = documentFragment.querySelector('a[href]')?.getAttribute('href') || '';
      }
      const validated = link('', sourceURL);
      return {
        name: String(p.name || p.location || 'UNNAMED PLACE'),
        lat, lon, count: Math.max(0, validNum(p.count) || 0),
        url: validated?.href || ''
      };
    }).filter(Boolean).sort((a,b) => b.count - a.count);
  }
  function visiblePoints() {
    return S.points.filter(p => REGIONS[S.region].box(p.lat, p.lon));
  }

  function installStyles() {
    if ($('ww-inf-style')) return;
    const style = elem('style'); style.id = 'ww-inf-style';
    style.textContent = `
      #infrastructure-panel .ww-inf-root{padding:9px;min-width:0;color:#bed9c6;font:11px/1.5 Consolas,'Courier New',monospace}
      #infrastructure-panel .ww-inf-title{color:#e8bf62;font-weight:700;margin:9px 0 5px}
      #infrastructure-panel .ww-inf-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0}
      #infrastructure-panel .ww-inf-button,#infrastructure-panel .ww-inf-select{border:1px solid #315b3e;background:#091a10;color:#7fdda0;font:10px Consolas,'Courier New',monospace;padding:5px 8px;cursor:pointer}
      #infrastructure-panel .ww-inf-button:hover,#infrastructure-panel .ww-inf-button.active{border-color:#73db94;background:#173523;color:#b3ffc8}
      #infrastructure-panel .ww-inf-select{min-width:150px;flex:1 1 140px}
      #infrastructure-panel .ww-inf-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin:8px 0}
      #infrastructure-panel .ww-inf-metric{background:#091a10;border:1px solid #315b3e;padding:6px;min-width:0}
      #infrastructure-panel .ww-inf-metric small{display:block;color:#8da895;font-size:9px}
      #infrastructure-panel .ww-inf-metric strong{display:block;color:#a0ffb9;font-size:13px;overflow-wrap:anywhere}
      #infrastructure-panel .ww-inf-service{border:1px solid #315b3e;background:#08160e;padding:7px;margin:5px 0}
      #infrastructure-panel .ww-inf-service strong{color:#a0ffb9}
      #infrastructure-panel .ww-inf-service.warn{border-color:#80632a}
      #infrastructure-panel .ww-inf-service.warn strong{color:#e8bf62}
      #infrastructure-panel .ww-inf-service.offline{border-color:#874848}
      #infrastructure-panel .ww-inf-service.offline strong{color:#ee9292}
      #infrastructure-panel .ww-inf-item{border-bottom:1px dashed #315b3e;padding:7px 0;overflow-wrap:anywhere}
      #infrastructure-panel .ww-inf-link{color:#a0ffb9;text-decoration:none;overflow-wrap:anywhere}
      #infrastructure-panel .ww-inf-link:hover{text-decoration:underline;color:#fff3b0}
      #infrastructure-panel .ww-inf-note,#infrastructure-panel .ww-inf-meta{font-size:10px;color:#8da895;margin:5px 0;overflow-wrap:anywhere}
      #infrastructure-panel .ww-inf-warning{font-size:10px;border-left:2px solid #e8bf62;padding:6px;background:#211b0d;color:#dec895;margin:8px 0}
      #infrastructure-panel .ww-inf-bars{height:76px;display:flex;align-items:end;gap:2px;background:#08160e;border:1px solid #315b3e;padding:4px}
      #infrastructure-panel .ww-inf-bar{flex:1;min-width:2px;max-width:20px;background:#80b6c7;align-self:flex-end}
      #infrastructure-panel .ww-inf-bar:hover{background:#e8bf62}
      #infrastructure-panel .ww-inf-error{color:#e8bf62;font-size:10px;overflow-wrap:anywhere}
      #infrastructure-panel .ww-inf-source{font-size:9px;color:#8da895;border-top:1px solid #315b3e;margin-top:9px;padding-top:7px}
    `;
    document.head.append(style);
  }

  function addMetric(parent, id, label) {
    const c = elem('div', 'ww-inf-metric');
    c.append(elem('small','',label));
    const value = elem('strong','', '--'); value.id = id; c.append(value); parent.append(c);
  }
  function makeControls(container, choices, initial, onchange) {
    choices.forEach(([k,label]) => {
      const b = button('[' + label + ']', () => {
        if (k === initial()) return;
        onchange(k);
        [...container.querySelectorAll('button')].forEach(x => x.classList.toggle('active', x.dataset.key === k));
      }, k === initial() ? 'active' : '');
      b.dataset.key = k; container.append(b);
    });
  }
  function setupLayerButton() {
    if ($('layer-infrastructure')) return;
    const toolbar = document.querySelector('#map-panel .map-layer-controls');
    if (!toolbar) return;
    const label = elem('label','layer-toggle');
    const toggle = elem('input'); toggle.type = 'checkbox';
    toggle.id = 'layer-infrastructure'; toggle.dataset.mapLayer = 'infrastructure'; toggle.checked = true;
    label.append(toggle, elem('span','','INFRA'));
    const last = $('layer-maritime')?.closest('label');
    if (last) last.after(label); else toolbar.append(label);
    toggle.addEventListener('change', syncLayer);
  }
  function buildUI() {
    installStyles(); setupLayerButton();
    const host = $('infrastructure-feed'); if (!host) return;
    host.replaceChildren();
    const root = elem('div','ww-inf-root'); host.append(root);
    root.append(elem('div','ww-inf-title','INFRA// GLOBAL INFRASTRUCTURE OPERATIONS'));
    const status = elem('div','ww-inf-note','STATUS// INITIALIZING'); status.id = 'ww-inf-state'; root.append(status);
    const meters = elem('div','ww-inf-metrics');
    addMetric(meters,'ww-inf-health','PROVIDER STATUS');
    addMetric(meters,'ww-inf-stories-num','HEADLINES');
    addMetric(meters,'ww-inf-points-num','MAP MENTIONS');
    root.append(meters);
    root.append(elem('div','ww-inf-title','SECTOR// MONITOR'));
    const topics = elem('div','ww-inf-row'); root.append(topics);
    makeControls(topics, Object.entries(TOPICS).map(([id,x]) => [id,x.label]), () => S.topic,
      key => { S.topic = key; selectionChanged(); });
    root.append(elem('div','ww-inf-title','TIMESPAN// REPORTING'));
    const periods = elem('div','ww-inf-row'); root.append(periods);
    makeControls(periods,[['24h','24H'],['7d','7D'],['30d','30D']], () => S.period,
      key => { S.period = key; selectionChanged(); });
    root.append(elem('div','ww-inf-title','AREA// WORLDWATCH REGION'));
    const zone = elem('div','ww-inf-row'); root.append(zone);
    const select = elem('select','ww-inf-select'); select.id = 'ww-inf-region';
    Object.entries(REGIONS).forEach(([id,x]) => { const o = elem('option','',x.label); o.value = id; select.append(o); });
    select.value = S.region;
    select.addEventListener('change', () => chooseRegion(select.value));
    zone.append(select);
    zone.append(button('[ SCAN ]', () => void refresh(true)));
    zone.append(button('[ VIEW MENTIONS ]', viewMentions));
    const windowNote = elem('div','ww-inf-note'); windowNote.id = 'ww-inf-window'; root.append(zone,windowNote);
    root.append(elem('div','ww-inf-warning',
      'SERVICE STATUS = EACH PROVIDER\'S OWN PLATFORM. ' +
      'MAP DOTS = PLACES MENTIONED IN INFRASTRUCTURE NEWS, NOT VERIFIED OUTAGE LOCATIONS. ' +
      'REPORTING VOLUME DOES NOT MEASURE SERVICE IMPACT.'));
    root.append(elem('div','ww-inf-title','NET// PROVIDER STATUS'));
    const providers = elem('div'); providers.id = 'ww-inf-providers'; root.append(providers);
    root.append(elem('div','ww-inf-title','SIGNAL// MEDIA COVERAGE TREND'));
    const timeline = elem('div'); timeline.id = 'ww-inf-timeline'; root.append(timeline);
    root.append(elem('div','ww-inf-title','WIRE// INFRASTRUCTURE REPORTING'));
    const news = elem('div'); news.id = 'ww-inf-news'; root.append(news);
    root.append(elem('div','ww-inf-title','GEO// NEWS-MENTIONED LOCATIONS'));
    const places = elem('div'); places.id = 'ww-inf-places'; root.append(places);
    root.append(elem('div','ww-inf-title','SOURCE// DIAGNOSTICS'));
    const diagnostics = elem('div','ww-inf-error'); diagnostics.id = 'ww-inf-diag'; root.append(diagnostics);
    root.append(elem('div','ww-inf-title','EXTERNAL// OPERATIONS CENTERS'));
    const links = elem('div','ww-inf-row');
    [
      ['[ RADAR OUTAGES ]','https://radar.cloudflare.com/outage-center'],
      ['[ RIPESTAT ]','https://stat.ripe.net/'],
      ['[ IODA ]','https://ioda.inetintel.cc.gatech.edu/'],
      ['[ US GRID OUTAGES ]','https://poweroutage.us/'],
      ['[ EIA ]','https://www.eia.gov/'],
      ['[ GDELT ]','https://www.gdeltproject.org/']
    ].forEach(([label,url]) => { const a = link(label,url); if (a) links.append(a); });
    root.append(links);
    root.append(elem('div','ww-inf-source',
      'STATUS// Cloudflare Status + GitHub Status (individual provider self-reports). ' +
      'NEWS/GEO/TREND// GDELT Project. External portals are references, not live API feeds. ' +
      'No measured worldwide grid/internet uptime or verified outage counts are claimed.'));
    render();
  }

  function resetNews() {
    S.articles = []; S.points = []; S.trend = [];
    S.articlesOk = false; S.geoOk = false; S.trendOk = false;
    S.articleError = ''; S.geoError = ''; S.trendError = '';
    render(); drawMap();
  }
  function chooseRegion(id) {
    if (!REGIONS[id] || id === S.region) return;
    S.region = id; if ($('ww-inf-region')) $('ww-inf-region').value = id;
    selectionChanged();
  }
  function selectionChanged() {
    ++S.generation; resetNews();
    // Debounce rapid changes, obey the upstream request cooldown.
    scheduleRefresh(600);
  }
  function scheduleRefresh(wait = 0) {
    clearTimeout(S.timer);
    const cooldown = Math.max(0, MANUAL_COOLDOWN_MS - (Date.now() - S.lastAttempt));
    const delay = Math.max(wait, cooldown);
    S.timer = setTimeout(() => void refresh(false), delay);
    if (delay > 1500) put('ww-inf-state','NEW SELECTION// SOURCE COOLDOWN ' + Math.ceil(delay / 1000) + 's');
  }

  function renderProviders() {
    const host = $('ww-inf-providers'); if (!host) return;
    host.replaceChildren();
    PROVIDERS.forEach(p => {
      const state = S.providerState[p.id];
      const issue = S.providerError[p.id];
      const card = elem('div','ww-inf-service');
      if (issue) card.classList.add('offline');
      else if (state && state.indicator !== 'none') card.classList.add('warn');
      card.append(elem('strong','',p.name + '// ' + (issue ? 'UNAVAILABLE' : state ? state.label : 'CHECKING')));
      if (state) {
        card.append(elem('div','ww-inf-meta','UPDATED// ' + utc(state.time) +
          ' | UNRESOLVED INCIDENTS// ' + state.incidents.length));
        state.incidents.slice(0,3).forEach(i => {
          const row = elem('div','ww-inf-note',i.name + ' // ' + i.status);
          const l = link(' [ DETAILS ↗ ]',i.url || p.page);
          if (l) row.append(l); card.append(row);
        });
      }
      if (issue) card.append(elem('div','ww-inf-error',issue));
      card.append(link('[ PROVIDER STATUS ↗ ]',p.page));
      host.append(card);
    });
  }
  function renderTrend() {
    const host = $('ww-inf-timeline'); if (!host) return;
    host.replaceChildren();
    if (!S.trendOk) { host.append(elem('div','ww-inf-note', S.trendError || 'AWAITING COVERAGE DATA')); return; }
    if (!S.trend.length) { host.append(elem('div','ww-inf-note','NO COVERAGE DATA MATCHED')); return; }
    const max = Math.max(...S.trend.map(p => p.value),0.000001);
    const bars = elem('div','ww-inf-bars');
    const step = Math.max(1,Math.ceil(S.trend.length / 65));
    for (let i=0;i<S.trend.length;i+=step) {
      const group = S.trend.slice(i,i+step);
      const avg = group.reduce((sum,p) => sum + p.value,0)/group.length;
      const b = elem('div','ww-inf-bar');
      b.style.height = Math.max(2,Math.round(100 * avg / max)) + '%';
      b.title = utc(group[group.length-1].time) + ' // ' + avg.toFixed(3) + '% OF GDELT COVERAGE';
      bars.append(b);
    }
    host.append(bars);
    host.append(elem('div','ww-inf-note',
      utc(S.trend[0].time) + ' → ' + utc(S.trend[S.trend.length-1].time) +
      ' // PEAK ' + max.toFixed(3) + '% OF MONITORED NEWS'));
  }
  function renderStories() {
    const host = $('ww-inf-news'); if (!host) return;
    host.replaceChildren();
    if (!S.articlesOk) { host.append(elem('div','ww-inf-note', S.articleError || 'AWAITING ARTICLES')); return; }
    if (!S.articles.length) { host.append(elem('div','ww-inf-note','NO MATCHING HEADLINES')); return; }
    S.articles.slice(0,22).forEach(a => {
      const row = elem('div','ww-inf-item');
      const l = link(a.title,a.url); if (l) row.append(l);
      row.append(elem('div','ww-inf-meta',a.source.toUpperCase() + ' // ' + utc(a.date) +
        (a.sourceCountry ? ' // '+a.sourceCountry : '')));
      host.append(row);
    });
  }
  function pointDetails(p) {
    const root = elem('div'); root.append(elem('strong','',p.name));
    root.append(elem('div','', 'MEDIA-MENTIONED PLACE // NOT A VERIFIED OUTAGE'));
    root.append(elem('div','', 'GDELT MENTIONS// ' + p.count));
    if (p.url) { const l = link('[ SOURCE ARTICLE ↗ ]',p.url); if (l) root.append(l); }
    return root;
  }
  function renderPlaces() {
    const host = $('ww-inf-places'); if (!host) return;
    host.replaceChildren();
    if (!S.geoOk) { host.append(elem('div','ww-inf-note', S.geoError || 'AWAITING GEO MENTIONS')); return; }
    const pts = visiblePoints();
    host.append(elem('div','ww-inf-note','GEO// ' + pts.length + ' MENTIONED PLACES // ' + geoSpan().toUpperCase()));
    if (!pts.length) { host.append(elem('div','ww-inf-note','NO MATCHING LOCATION MENTIONS')); return; }
    pts.slice(0,18).forEach(p => {
      const row = elem('div','ww-inf-item');
      row.append(button('[ LOCATE ]',()=>locate(p)));
      row.append(elem('span','', ' ' + p.name + ' (' + p.count + ' MENTIONS)'));
      host.append(row);
    });
  }
  function render() {
    const checked = PROVIDERS.filter(p => Boolean(S.providerState[p.id])).length;
    const online = [S.articlesOk,S.geoOk,S.trendOk].filter(Boolean).length;
    const status = (checked + online === 0) ? (S.fetching ? 'CHECKING' : 'OFFLINE')
      : (checked === PROVIDERS.length && online === 3) ? 'ONLINE' : 'PARTIAL';
    put('ww-inf-state','STATUS// ' + status + ' | PROVIDERS// ' + checked + '/2 | NEWS FEEDS// ' + online + '/3');
    put('infrastructure-status',status);
    put('infrastructure-updated',S.updated ? utc(S.updated) : '--:--Z');
    put('ww-inf-health',checked + '/2');
    put('ww-inf-stories-num',S.articlesOk ? S.articles.length : '--');
    put('ww-inf-points-num',S.geoOk ? visiblePoints().length : '--');
    put('ww-inf-window','SECTOR// ' + TOPICS[S.topic].label +
      ' | REGION// ' + REGIONS[S.region].label +
      ' | NEWS// ' + S.period.toUpperCase() +
      ' | MAP// ' + geoSpan().toUpperCase());
    const errors = [
      S.providerError.cloudflare && 'CLOUDFLARE: ' + S.providerError.cloudflare,
      S.providerError.github && 'GITHUB: ' + S.providerError.github,
      S.articleError && 'HEADLINES: ' + S.articleError,
      S.trendError && 'TREND: ' + S.trendError,
      S.geoError && 'MAP: ' + S.geoError
    ].filter(Boolean);
    put('ww-inf-diag',errors.length ? errors.join(' | ') : S.fetching ? 'FETCHING SOURCE DATA' : 'NO SOURCE ERRORS');
    renderProviders(); renderTrend(); renderStories(); renderPlaces();
    // Report module health only. Do not overwrite the controller's global status.
    if (window.WorldWatch?.reportModuleStatus) {
      const moduleStatus = status === 'ONLINE' ? 'online' : status === 'CHECKING' ? 'standby'
        : status === 'PARTIAL' ? 'stale' : 'error';
      window.WorldWatch.reportModuleStatus('infrastructure',moduleStatus,errors.join('; '));
    }
  }

  function syncLayer() {
    if (!S.layer || !S.map) return;
    const visible = Boolean($('layer-infrastructure')?.checked);
    if (visible && !S.map.hasLayer(S.layer)) S.layer.addTo(S.map);
    if (!visible && S.map.hasLayer(S.layer)) S.map.removeLayer(S.layer);
    put('map-active-layers',document.querySelectorAll('[data-map-layer]:checked').length);
  }
  function drawMap() {
    if (!S.map || !S.layer || !window.L) return;
    S.layer.clearLayers();
    visiblePoints().slice(0,LIMIT_POINTS).forEach(p => {
      const radius = Math.max(4,Math.min(10,4 + Math.log1p(p.count)));
      L.circleMarker([p.lat,p.lon],{
        radius,color:'#80b6c7',fillColor:'#80b6c7',fillOpacity:.37,weight:1.5
      }).bindTooltip(p.name + ' // INFRA NEWS MENTION')
        .bindPopup(pointDetails(p)).addTo(S.layer);
    });
    syncLayer();
  }
  function locate(p) {
    if (!S.map || !window.L) return;
    if ($('layer-infrastructure')) $('layer-infrastructure').checked = true;
    syncLayer(); S.map.flyTo([p.lat,p.lon],6,{duration:.8});
    L.popup().setLatLng([p.lat,p.lon]).setContent(pointDetails(p)).openOn(S.map);
  }
  function viewMentions() {
    const pts = visiblePoints();
    if (!S.map || !pts.length || !window.L) {
      window.WorldWatch?.notify('INFRA// NO MAP MENTIONS AVAILABLE','warning'); return;
    }
    if ($('layer-infrastructure')) $('layer-infrastructure').checked = true;
    syncLayer();
    if (pts.length === 1) return locate(pts[0]);
    S.map.fitBounds(L.latLngBounds(pts.map(p => [p.lat,p.lon])),{
      padding:[35,35],maxZoom:7,animate:true
    });
  }
  function mapHook() {
    if (!window.L?.Map) return;
    L.Map.addInitHook(function() {
      if (this.getContainer()?.id !== 'world-map') return;
      S.map = this; S.layer = L.layerGroup(); drawMap();
    });
  }

  async function loadProvider(p) {
    try {
      const target = PROXY ? PROXY + '/status/' + p.id : p.url;
      const raw = await cachedJSON(target);
      if (!raw?.status || !Array.isArray(raw?.incidents)) throw Error('UNEXPECTED STATUS FORMAT');
      S.providerState[p.id] = {
        indicator: String(raw.status.indicator || 'unknown'),
        label: String(raw.status.description || 'STATUS UNKNOWN'),
        time: raw.page?.updated_at || new Date().toISOString(),
        incidents: raw.incidents.filter(i => i?.status !== 'resolved' && i?.status !== 'postmortem')
          .map(i => ({ name: String(i.name||'INCIDENT'), status: String(i.status||''), url: String(i.shortlink||'') }))
      };
      S.providerError[p.id] = '';
      S.updated = new Date();
    } catch(e) {
      S.providerError[p.id] = safeError(e);
      // No longer treat old provider status as live if a request fails.
      delete S.providerState[p.id];
    }
    render();
  }
  async function loadGdelt(url, type, generation, configKey) {
    try {
      const raw = await cachedJSON(url);
      if (generation !== S.generation || configKey !== selectedKey()) return;
      if (type === 'articles') { S.articles = parseArticles(raw); S.articlesOk = true; S.articleError = ''; }
      if (type === 'trend') { S.trend = parseTrend(raw); S.trendOk = true; S.trendError = ''; }
      if (type === 'geo') { S.points = parseGeo(raw); S.geoOk = true; S.geoError = ''; drawMap(); }
      S.updated = new Date();
    } catch(e) {
      if (generation !== S.generation || configKey !== selectedKey()) return;
      if (type === 'articles') { S.articlesOk = false; S.articleError = safeError(e); }
      if (type === 'trend') { S.trendOk = false; S.trendError = safeError(e); }
      if (type === 'geo') { S.geoOk = false; S.geoError = safeError(e); }
    }
    if (generation === S.generation) render();
  }
  const delay = ms => new Promise(resolve => setTimeout(resolve,ms));

  async function refresh(manual = false) {
    if (S.current) {
      if (manual) window.WorldWatch?.notify('INFRA// REQUEST IN PROGRESS','warning');
      return S.current;
    }
    const wait = MANUAL_COOLDOWN_MS - (Date.now() - S.lastAttempt);
    if (wait > 0) {
      if (manual) window.WorldWatch?.notify('INFRA// REQUEST COOLDOWN ' + Math.ceil(wait / 1000) + 's','warning');
      scheduleRefresh(wait); return;
    }
    S.lastAttempt = Date.now();
    const sequence = ++S.generation;
    const config = selectedKey();
    const articleURL = gdeltURL('artlist');
    const trendURL = gdeltURL('timelinevol');
    const mapURL = geoURL();
    S.fetching = true; render();
    S.current = (async () => {
      // Provider health is independent of the selected news topic/region.
      const health = Promise.allSettled(PROVIDERS.map(loadProvider));
      await loadGdelt(articleURL,'articles',sequence,config);
      await delay(900);
      if (sequence === S.generation) await loadGdelt(trendURL,'trend',sequence,config);
      await delay(900);
      if (sequence === S.generation) await loadGdelt(mapURL,'geo',sequence,config);
      await health;
    })();
    try { await S.current; }
    finally {
      S.current = null; S.fetching = false; render();
      if (sequence !== S.generation) scheduleRefresh(1000);
    }
  }

  function start() {
    if (S.started || !window.WorldWatch) return;
    S.started = true;
    const active = document.querySelector('[data-region].active');
    if (active && REGIONS[active.dataset.region]) S.region = active.dataset.region;
    buildUI();
    mapHook(); // MUST run before modules/map.js initializes Leaflet.
    document.addEventListener('click', e => {
      const b = e.target.closest('button[data-region]');
      if (b && REGIONS[b.dataset.region]) chooseRegion(b.dataset.region);
    });
    window.WorldWatch.registerModule('infrastructure',{refresh});
    setInterval(() => { if (!document.hidden) void refresh(); },AUTO_MS);
    document.addEventListener('visibilitychange',() => {
      if (!document.hidden && Date.now() - S.lastAttempt > AUTO_MS) void refresh();
    });
    void refresh();
  }
  start();
})();
