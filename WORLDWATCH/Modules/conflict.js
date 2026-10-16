
/* ============================================================
   WORLDWATCH // PHASE 13 // CONFLICT & SECURITY MONITOR
   FILE: modules/conflict.js

   GDELT DOC 2.0:
     News articles and coverage-volume timeline

   GDELT GEO 2.0:
     Locations mentioned in news coverage

   IMPORTANT:
   - GEO dots are NEWS-MENTIONED PLACES.
   - Dots are NOT confirmed incident locations.
   - The timeline shows MEDIA COVERAGE, not battle intensity.
   - GEO supports 7 days maximum; DOC supports 30 days.
   - Regional headline matching uses approximate keywords.

   Optional future home-server adapter:
     window.WORLDWATCH_CONFLICT_API = '/api/conflict';
   ============================================================ */

(() => {
  'use strict';

  const byId = id => document.getElementById(id);

  const DOC = 'https://api.gdeltproject.org/api/v2/doc/doc';
  const GEO = 'https://api.gdeltproject.org/api/v2/geo/geo';

  const SERVER = (
    typeof window.WORLDWATCH_CONFLICT_API === 'string'
  ) ? window.WORLDWATCH_CONFLICT_API.replace(/\/$/, '') : '';

  const DOC_URL = SERVER ? SERVER + '/articles' : DOC;
  const GEO_URL = SERVER ? SERVER + '/geo' : GEO;

  const REFRESH_MS = 10 * 60 * 1000;
  const CACHE_MS = 5 * 60 * 1000;
  const MIN_REQUEST_MS = 35 * 1000;

  /* ==========================================================
     01 - MONITORING TOPICS
     ========================================================== */

  const TOPIC = {

    conflict: {
      name: 'ARMED CONFLICT',
      q: '(airstrike OR shelling OR "missile strike" OR "armed clashes" OR bombardment)'
    },

    diplomacy: {
      name: 'DIPLOMACY',
      q: '(sanctions OR "peace talks" OR ceasefire OR diplomacy)'
    },

    maritime: {
      name: 'MARITIME SECURITY',
      q: '(piracy OR "shipping attack" OR "naval incident" OR "maritime security")'
    },

    unrest: {
      name: 'CIVIL UNREST',
      q: '(protest OR demonstrations OR "civil unrest")'
    }

  };

  /* ==========================================================
     02 - GEOGRAPHIC REGIONS

     Regional article searches are approximate keyword
     searches. Map results use a regional geographic
     search and coordinate screening.
     ========================================================== */

  const REGION = {

    global: {
      name: 'GLOBAL',
      q: '',
      box: () => true
    },

    americas: {
      name: 'AMERICAS',
      q: '(United States OR Mexico OR Colombia OR Venezuela OR Haiti OR Brazil OR Canada OR Cuba)',
      geo: 'near:15,-85,7000km',
      box: (lat, lon) =>
        lon < -30 && lon > -170 &&
        lat > -60 && lat < 85
    },

    europe: {
      name: 'EUROPE',
      q: '(Ukraine OR Russia OR Poland OR France OR Germany OR Britain OR Europe)',
      geo: 'near:52,20,2800km',
      box: (lat, lon) =>
        lat >= 35 && lat <= 73 &&
        lon >= -13 && lon <= 60
    },

    'middle-east': {
      name: 'MIDDLE EAST',
      q: '(Israel OR Gaza OR Iran OR Lebanon OR Syria OR Iraq OR Yemen OR Saudi)',
      geo: 'near:28,47,2800km',
      box: (lat, lon) =>
        lat >= 10 && lat <= 43 &&
        lon >= 28 && lon <= 65
    },

    'asia-pacific': {
      name: 'ASIA / PACIFIC',
      q: '(China OR Taiwan OR Japan OR Philippines OR Korea OR India OR Pakistan OR Myanmar)',
      geo: 'near:20,115,9000km',
      box: (lat, lon) =>
        lat >= -50 && lat <= 75 &&
        (lon >= 60 || lon <= -120)
    },

    africa: {
      name: 'AFRICA',
      q: '(Sudan OR Sahel OR Congo OR Somalia OR Nigeria OR Ethiopia OR Kenya)',
      geo: 'near:0,22,5200km',
      box: (lat, lon) =>
        lat >= -36 && lat <= 38 &&
        lon >= -20 && lon <= 54
    }

  };

  /* ==========================================================
     03 - MODULE STATE
     ========================================================== */

  const S = {

    started: false,

    region: 'global',
    topic: 'conflict',
    period: '24h',

    articles: [],
    points: [],
    series: [],

    articlesOK: false,
    geoOK: false,
    timelineOK: false,

    articlesError: '',
    geoError: '',
    timelineError: '',

    updated: null,

    busy: false,
    promise: null,

    lastAttempt: 0,
    pendingKey: '',
    loadedKey: '',
    generation: 0,

    map: null,
    layer: null,

    cache: new Map()

  };

  /* ==========================================================
     04 - UTILITIES
     ========================================================== */

  function el(tag, cls = '', value) {

    const e = document.createElement(tag);

    if (cls) {
      e.className = cls;
    }

    if (value !== undefined) {
      e.textContent = String(value);
    }

    return e;

  }

  function btn(label, fn, cls = '') {

    const b = el(
      'button',
      'ww-conf-btn ' + cls,
      label
    );

    b.type = 'button';

    b.addEventListener('click', fn);

    return b;

  }

  function clean(s) {
    return String(s ?? '').trim();
  }

  function safeURL(s) {

    try {

      const u = new URL(clean(s));

      return (
        u.protocol === 'https:' ||
        u.protocol === 'http:'
      ) ? u.href : '';

    } catch (_) {

      return '';

    }

  }

  function safeNum(s) {

    const n = Number(s);

    return Number.isFinite(n) ? n : null;

  }

  function utc(value) {

    const d = value instanceof Date
      ? value
      : new Date(value);

    return Number.isFinite(d.getTime())

      ? d.toISOString()
          .slice(0, 16)
          .replace('T', ' ') + 'Z'

      : '--';

  }

  function parseGdeltDate(value) {

    const v = clean(value);

    if (/^\d{14}$/.test(v)) {

      return new Date(
        v.slice(0, 4) + '-' +
        v.slice(4, 6) + '-' +
        v.slice(6, 8) + 'T' +
        v.slice(8, 10) + ':' +
        v.slice(10, 12) + ':' +
        v.slice(12, 14) + 'Z'
      );

    }

    if (/^\d{8}T\d{6}Z$/.test(v)) {

      return new Date(
        v.slice(0, 4) + '-' +
        v.slice(4, 6) + '-' +
        v.slice(6, 8) + 'T' +
        v.slice(9, 11) + ':' +
        v.slice(11, 13) + ':' +
        v.slice(13, 15) + 'Z'
      );

    }

    if (/^\d{8}$/.test(v)) {

      return new Date(
        v.slice(0, 4) + '-' +
        v.slice(4, 6) + '-' +
        v.slice(6, 8) + 'T00:00:00Z'
      );

    }

    return new Date(v);

  }

  function err(e) {

    if (e?.name === 'AbortError') {
      return 'REQUEST TIMEOUT';
    }

    if (e instanceof TypeError) {
      return 'NETWORK / CORS BLOCK';
    }

    return clean(
      e?.message || e
    ).slice(0, 110);

  }

  function key() {

    return [
      S.region,
      S.topic,
      S.period
    ].join('|');

  }

  function docQuery() {

    const r = REGION[S.region];

    return TOPIC[S.topic].q +
      (r.q ? ' ' + r.q : '');

  }

  function geoQuery() {

    return TOPIC[S.topic].q +
      (
        REGION[S.region].geo
          ? ' ' + REGION[S.region].geo
          : ''
      );

  }

  function docSpan() {
    return S.period;
  }

  function geoSpan() {

    return S.period === '30d'
      ? '7d'
      : S.period;

  }

  function apiURL(base, params) {

    const p = new URLSearchParams(params);

    return base + '?' + p.toString();

  }

  function qURL(mode) {

    return apiURL(DOC_URL, {

      query: docQuery(),

      mode,

      format: 'json',

      timespan: docSpan(),

      ...(
        mode === 'artlist'
          ? {
              maxrecords: 75,
              sort: 'datedesc'
            }
          : {}
      )

    });

  }

  function gURL() {

    return apiURL(GEO_URL, {

      query: geoQuery(),

      mode: 'pointdata',

      format: 'geojson',

      timespan: geoSpan(),

      maxpoints: 160

    });

  }

  /* ==========================================================
     05 - API CONNECTIONS
     ========================================================== */

  async function getJSON(url) {

    const ctrl = new AbortController();

    const t = setTimeout(
      () => ctrl.abort(),
      18000
    );

    try {

      const r = await fetch(url, {

        signal: ctrl.signal,

        cache: 'no-store',

        headers: {
          Accept: 'application/json'
        }

      });

      if (!r.ok) {

        throw Error(
          'HTTP ' + r.status
        );

      }

      const type = (
        r.headers.get('content-type') || ''
      ).toLowerCase();

      const raw = await r.text();

      if (
        type.includes('html') ||
        /^\s*</.test(raw)
      ) {

        throw Error(
          'SOURCE RETURNED HTML INSTEAD OF JSON'
        );

      }

      try {

        return JSON.parse(raw);

      } catch (_) {

        throw Error(
          'INVALID JSON FROM SOURCE'
        );

      }

    } finally {

      clearTimeout(t);

    }

  }

  async function fetchCached(url) {

    const c = S.cache.get(url);

    if (
      c &&
      Date.now() - c.when < CACHE_MS
    ) {

      return c.payload;

    }

    const payload = await getJSON(url);

    S.cache.set(url, {

      when: Date.now(),

      payload

    });

    return payload;

  }

  /* ==========================================================
     06 - ARTICLE NORMALIZATION
     ========================================================== */

  function normalizeArticles(payload) {

    if (!Array.isArray(payload?.articles)) {

      throw Error(
        'UNEXPECTED ARTICLE FORMAT'
      );

    }

    const seen = new Set();

    return payload.articles

      .map(a => ({

        title: clean(a.title),

        url: safeURL(a.url),

        source: clean(a.domain) ||
          'SOURCE UNKNOWN',

        date: parseGdeltDate(
          a.seendate
        ),

        language: clean(
          a.language
        ),

        sourcecountry: clean(
          a.sourcecountry
        )

      }))

      .filter(a => {

        if (
          !a.title ||
          !a.url ||
          seen.has(a.url)
        ) {

          return false;

        }

        seen.add(a.url);

        return true;

      })

      .sort(
        (a, b) => b.date - a.date
      )

      .slice(0, 75);

  }

  /* ==========================================================
     07 - TIMELINE NORMALIZATION
     ========================================================== */

  function normalizeTimeline(payload) {

    const entries =
      payload?.timeline?.[0]?.data;

    if (!Array.isArray(entries)) {

      throw Error(
        'UNEXPECTED TIMELINE FORMAT'
      );

    }

    return entries

      .map(p => ({

        date: parseGdeltDate(
          p.date
        ),

        value: safeNum(
          p.value
        )

      }))

      .filter(p =>

        Number.isFinite(
          p.date.getTime()
        ) &&

        p.value !== null &&

        p.value >= 0

      )

      .sort(
        (a, b) => a.date - b.date
      );

  }

  /* ==========================================================
     08 - GEOJSON NORMALIZATION

     Do not trust upstream HTML.
     Extract article links rather than injecting it.
     ========================================================== */

  function extractGeoLinks(html) {

    if (
      typeof html !== 'string' ||
      !html
    ) {

      return [];

    }

    const d = new DOMParser().parseFromString(
      html,
      'text/html'
    );

    return [
      ...d.querySelectorAll('a[href]')
    ]

      .slice(0, 5)

      .map(a => ({

        title: clean(
          a.textContent
        ),

        url: safeURL(
          a.getAttribute('href')
        )

      }))

      .filter(a =>

        a.title &&
        a.url

      );

  }

  function normalizeGeo(payload) {

    if (!Array.isArray(payload?.features)) {

      throw Error(
        'UNEXPECTED GEOJSON FORMAT'
      );

    }

    return payload.features

      .map(f => {

        const coords =
          f?.geometry?.coordinates;

        const p =
          f?.properties || {};

        if (
          f?.geometry?.type !== 'Point' ||
          !Array.isArray(coords)
        ) {

          return null;

        }

        const lon = safeNum(
          coords[0]
        );

        const lat = safeNum(
          coords[1]
        );

        if (

          lat === null ||
          lon === null ||
          Math.abs(lat) > 90 ||
          Math.abs(lon) > 180

        ) {

          return null;

        }

        const links = extractGeoLinks(

          p.html ||
          p.HTML ||
          ''

        );

        const direct = safeURL(
          p.url
        );

        if (
          direct &&
          !links.length
        ) {

          links.push({

            title: 'SOURCE ARTICLE',

            url: direct

          });

        }

        return {

          lat,

          lon,

          name: clean(

            p.name ||
            p.location ||
            p.title

          ) || 'UNNAMED LOCATION',

          mentions:
            safeNum(p.count) ?? 0,

          links

        };

      })

      .filter(Boolean)

      .sort(
        (a, b) =>
          b.mentions - a.mentions
      );

  }

  function regionalPoints() {

    return S.points.filter(
      p => REGION[S.region].box(
        p.lat,
        p.lon
      )
    );

  }

  /* ==========================================================
     09 - STATUS / SAFE EXTERNAL LINKS
     ========================================================== */

  function metric(id, val) {

    if (byId(id)) {

      byId(id).textContent =
        String(val);

    }

  }

  function external(label, url) {

    const u = safeURL(url);

    if (!u) {
      return null;
    }

    const a = el(
      'a',
      'ww-conf-link',
      label
    );

    a.href = u;

    a.target = '_blank';

    a.rel =
      'noopener noreferrer';

    return a;

  }

  function sourceStatus() {

    const total = [

      S.articlesOK,

      S.timelineOK,

      S.geoOK

    ].filter(Boolean).length;

    if (S.busy) {
      return 'SCANNING';
    }

    if (

      S.articlesError ||
      S.timelineError ||
      S.geoError

    ) {

      return total > 0
        ? 'STALE'
        : 'OFFLINE';

    }

    return total === 3

      ? 'ONLINE'

      : total > 0

        ? 'PARTIAL'

        : 'OFFLINE';

  }

  function updateStatus() {

    const total = [

      S.articlesOK,

      S.timelineOK,

      S.geoOK

    ].filter(Boolean).length;

    const label = sourceStatus();

    metric(
      'conflict-status',
      label
    );

    metric(

      'ww-conf-status',

      'STATUS// ' +
      label +
      ' | SOURCES// ' +
      total +
      '/3'

    );

    metric(

      'ww-conf-updated',

      'UPDATED// ' +
      utc(S.updated)

    );

    metric(

      'ww-conf-headline-count',

      S.articlesOK
        ? S.articles.length
        : '--'

    );

    metric(

      'ww-conf-geo-count',

      S.geoOK
        ? regionalPoints().length
        : '--'

    );

    metric(

      'ww-conf-period',

      S.period.toUpperCase()

    );

    metric(

      'ww-conf-coverage',

      'REPORTS// ' +
      TOPIC[S.topic].name +
      ' | REGION// ' +
      REGION[S.region].name +
      ' | HEADLINE WINDOW// ' +
      S.period.toUpperCase() +
      ' | MAP WINDOW// ' +
      geoSpan().toUpperCase()

    );

    const problems = [];

    if (S.articlesError) {

      problems.push(
        'HEADLINES: ' +
        S.articlesError
      );

    }

    if (S.timelineError) {

      problems.push(
        'TIMELINE: ' +
        S.timelineError
      );

    }

    if (S.geoError) {

      problems.push(
        'MAP: ' +
        S.geoError
      );

    }

    metric(

      'ww-conf-errors',

      problems.length

        ? problems.join(' | ')

        : S.busy

          ? 'REQUESTING SOURCE DATA'

          : 'NO ACTIVE SOURCE ERRORS'

    );

    if (
      window.WorldWatch
        ?.reportModuleStatus
    ) {

      window.WorldWatch
        .reportModuleStatus(

          'conflict',

          label === 'ONLINE'

            ? 'online'

            : label === 'SCANNING'

              ? 'standby'

              : (
                  label === 'PARTIAL' ||
                  label === 'STALE'
                )

                ? 'stale'

                : 'error',

          problems.join('; ')

        );

    }

  }

  /* ==========================================================
     10 - STYLES

     All styles are self-contained.
     styles.css does not need modification.
     ========================================================== */

  function installStyles() {

    if (byId('ww-conf-style')) {
      return;
    }

    const s = el('style');

    s.id = 'ww-conf-style';

    s.textContent = `

      #conflict-monitor .ww-conf-root {
        padding:9px;
        background:#07140c;
        color:#c5dccb;
        font:11px/1.45 Consolas,'Courier New',monospace;
        min-width:0;
      }

      #conflict-monitor .ww-conf-title {
        color:#e8bf62;
        font-weight:700;
        font-size:11px;
        margin:9px 0 5px;
      }

      #conflict-monitor .ww-conf-note {
        color:#8da895;
        font-size:10px;
        overflow-wrap:anywhere;
        margin:5px 0;
      }

      #conflict-monitor .ww-conf-row {
        display:flex;
        align-items:center;
        flex-wrap:wrap;
        gap:5px;
        margin:6px 0;
      }

      #conflict-monitor .ww-conf-btn,
      #conflict-monitor .ww-conf-select {
        border:1px solid #315b3e;
        background:#0a190f;
        color:#73db94;
        padding:5px 7px;
        font:10px Consolas,'Courier New',monospace;
        cursor:pointer;
      }

      #conflict-monitor .ww-conf-btn.active,
      #conflict-monitor .ww-conf-btn:hover,
      #conflict-monitor .ww-conf-select:focus {
        background:#173523;
        color:#b5ffca;
        border-color:#73db94;
      }

      #conflict-monitor .ww-conf-select {
        flex:1 1 140px;
        min-width:0;
      }

      #conflict-monitor .ww-conf-metrics {
        display:grid;
        grid-template-columns:repeat(3,minmax(0,1fr));
        gap:5px;
        margin:8px 0;
      }

      #conflict-monitor .ww-conf-metric {
        border:1px solid #315b3e;
        background:#091a10;
        padding:6px;
        min-width:0;
      }

      #conflict-monitor .ww-conf-metric small {
        display:block;
        color:#8da895;
        font-size:9px;
      }

      #conflict-monitor .ww-conf-metric strong {
        color:#73db94;
        font-size:13px;
      }

      #conflict-monitor .ww-conf-headline,
      #conflict-monitor .ww-conf-location {
        border-bottom:1px dashed #315b3e;
        padding:8px 0;
        overflow-wrap:anywhere;
      }

      #conflict-monitor .ww-conf-link {
        color:#a0ffb9;
        text-decoration:none;
      }

      #conflict-monitor .ww-conf-link:hover {
        text-decoration:underline;
        color:#fff3b0;
      }

      #conflict-monitor .ww-conf-meta {
        color:#8da895;
        font-size:9px;
        padding:3px 0;
      }

      #conflict-monitor .ww-conf-bars {
        display:flex;
        align-items:end;
        gap:2px;
        height:74px;
        background:#08150c;
        border:1px solid #315b3e;
        padding:4px;
        overflow:hidden;
      }

      #conflict-monitor .ww-conf-bar {
        background:#73db94;
        flex:1 1 2px;
        min-width:2px;
        max-width:18px;
        opacity:.75;
        align-self:flex-end;
      }

      #conflict-monitor .ww-conf-bar:hover {
        background:#e8bf62;
        opacity:1;
      }

      #conflict-monitor .ww-conf-chart-foot {
        display:flex;
        justify-content:space-between;
        color:#8da895;
        font-size:9px;
        margin:3px 0;
      }

      #conflict-monitor .ww-conf-alert {
        border-left:2px solid #e8bf62;
        padding:5px 7px;
        background:#1b190f;
        color:#dcc793;
        font-size:10px;
        margin:8px 0;
      }

      #conflict-monitor .ww-conf-err {
        color:#e8bf62;
        font-size:9px;
        overflow-wrap:anywhere;
        margin:6px 0;
      }

      #conflict-monitor .ww-conf-source {
        border-top:1px solid #315b3e;
        margin-top:8px;
        padding-top:7px;
        color:#8da895;
        font-size:9px;
      }

    `;

    document.head.append(s);

  }

  /* ==========================================================
     11 - BUILD CONFLICT PANEL
     ========================================================== */

  function installUI() {

    installStyles();

    const host = byId(
      'conflict-feed'
    );

    if (!host) {
      return;
    }

    host.replaceChildren();

    const root = el(
      'section',
      'ww-conf-root'
    );

    host.append(root);

    root.append(

      el(
        'div',
        'ww-conf-title',
        'OSINT// CONFLICT & SECURITY REPORTING'
      )

    );

    const status = el(

      'div',
      'ww-conf-note',
      'STATUS// INITIALIZING'

    );

    status.id = 'ww-conf-status';

    root.append(status);

    /* METRICS */

    const metrics = el(
      'div',
      'ww-conf-metrics'
    );

    [

      [
        'ww-conf-headline-count',
        'HEADLINES LOADED'
      ],

      [
        'ww-conf-geo-count',
        'MAP MENTIONS'
      ],

      [
        'ww-conf-period',
        'WINDOW'
      ]

    ].forEach(([id, label]) => {

      const cell = el(
        'div',
        'ww-conf-metric'
      );

      cell.append(

        el(
          'small',
          '',
          label
        )

      );

      const value = el(
        'strong',
        '',
        '--'
      );

      value.id = id;

      cell.append(value);

      metrics.append(cell);

    });

    root.append(metrics);

    /* TOPIC CONTROLS */

    root.append(

      el(
        'div',
        'ww-conf-title',
        'INTEL// TOPIC'
      )

    );

    const topics = el(
      'div',
      'ww-conf-row'
    );

    topics.id = 'ww-conf-topics';

    Object.entries(TOPIC).forEach(
      ([id, o]) => {

        const b = btn(

          '[' + o.name + ']',

          () => {

            if (S.topic === id) {
              return;
            }

            S.topic = id;

            setActive(
              topics,
              id
            );

            clearDisplay();

            void refresh(true);

          },

          id === S.topic
            ? 'active'
            : ''

        );

        b.dataset.key = id;

        topics.append(b);

      }
    );

    root.append(topics);

    /* TIME WINDOW */

    root.append(

      el(
        'div',
        'ww-conf-title',
        'TIMESPAN// REPORTING WINDOW'
      )

    );

    const periods = el(
      'div',
      'ww-conf-row'
    );

    periods.id = 'ww-conf-times';

    [

      ['24h', '24 HOURS'],

      ['7d', '7 DAYS'],

      ['30d', '30 DAYS']

    ].forEach(([id, label]) => {

      const b = btn(

        '[' + label + ']',

        () => {

          if (S.period === id) {
            return;
          }

          S.period = id;

          setActive(
            periods,
            id
          );

          clearDisplay();

          void refresh(true);

        },

        id === S.period
          ? 'active'
          : ''

      );

      b.dataset.key = id;

      periods.append(b);

    });

    root.append(periods);

    /* REGION SELECTION */

    root.append(

      el(
        'div',
        'ww-conf-title',
        'AREA// WORLDWATCH REGION'
      )

    );

    const regionRow = el(
      'div',
      'ww-conf-row'
    );

    const regionSelect = el(
      'select',
      'ww-conf-select'
    );

    regionSelect.id =
      'ww-conf-region';

    Object.entries(REGION).forEach(
      ([id, o]) => {

        const opt = el(
          'option',
          '',
          o.name
        );

        opt.value = id;

        regionSelect.append(opt);

      }
    );

    regionSelect.value =
      S.region;

    regionSelect.addEventListener(

      'change',

      () => changeRegion(
        regionSelect.value
      )

    );

    regionRow.append(
      regionSelect
    );

    regionRow.append(

      btn(
        '[ SCAN ]',
        () => void refresh(true)
      )

    );

    regionRow.append(

      btn(
        '[ VIEW MENTIONS ]',
        viewMentions
      )

    );

    root.append(regionRow);

    const coverage = el(
      'div',
      'ww-conf-note'
    );

    coverage.id =
      'ww-conf-coverage';

    root.append(coverage);

    /* INTERPRETATION WARNING */

    const alert = el(

      'div',

      'ww-conf-alert',

      'MAP DOTS = PLACES MENTIONED IN NEWS, NOT VERIFIED INCIDENT LOCATIONS. ' +
      'TIMELINE = NEWS COVERAGE VOLUME, NOT CONFLICT INTENSITY.'

    );

    root.append(alert);

    /* COVERAGE TIMELINE */

    root.append(

      el(
        'div',
        'ww-conf-title',
        'SIGNAL// MEDIA COVERAGE TREND'
      )

    );

    const timeline = el(
      'div'
    );

    timeline.id =
      'ww-conf-timeline';

    root.append(timeline);

    /* ARTICLES */

    root.append(

      el(
        'div',
        'ww-conf-title',
        'REPORTS// RECENT HEADLINES'
      )

    );

    const stories = el('div');

    stories.id =
      'ww-conf-stories';

    root.append(stories);

    /* GEOGRAPHIC MENTIONS */

    root.append(

      el(
        'div',
        'ww-conf-title',
        'GEO// MEDIA-MENTIONED LOCATIONS'
      )

    );

    const locations = el('div');

    locations.id =
      'ww-conf-locations';

    root.append(locations);

    /* DIAGNOSTICS */

    root.append(

      el(
        'div',
        'ww-conf-title',
        'SOURCE// DIAGNOSTICS'
      )

    );

    const upd = el(
      'div',
      'ww-conf-note'
    );

    upd.id =
      'ww-conf-updated';

    root.append(upd);

    const errors = el(
      'div',
      'ww-conf-err'
    );

    errors.id =
      'ww-conf-errors';

    root.append(errors);

    /* REFERENCE LINKS */

    const links = el(
      'div',
      'ww-conf-row'
    );

    [

      [
        '[ GDELT PROJECT ]',
        'https://www.gdeltproject.org/'
      ],

      [
        '[ STATE DEPT ADVISORIES ]',
        'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html'
      ],

      [
        '[ ACLED ]',
        'https://acleddata.com/'
      ]

    ].forEach(([label, url]) => {

      const a = external(
        label,
        url
      );

      if (a) {
        links.append(a);
      }

    });

    root.append(links);

    root.append(

      el(

        'div',

        'ww-conf-source',

        'SOURCE// GDELT DOC + GEO 2.0. AUTOMATED NEWS SEARCH; ' +
        'NO INCIDENT VERIFICATION OR CONFIDENCE SCORE. ' +
        'GEOGRAPHIC MATCHING IS APPROXIMATE. ' +
        'SOURCE ARTICLES MAY CONTAIN ERRORS.'

      )

    );

    /* ENABLE TACTICAL MAP OVERLAY */

    const box = byId(
      'layer-conflicts'
    );

    if (box) {

      box.disabled = false;

      box.checked = true;

      box.addEventListener(
        'change',
        syncLayer
      );

    }

    render();

  }

  /* ==========================================================
     12 - CONTROLS AND REGION SYNC
     ========================================================== */

  function setActive(parent, id) {

    parent.querySelectorAll(
      'button[data-key]'
    ).forEach(b => {

      b.classList.toggle(

        'active',

        b.dataset.key === id

      );

    });

  }

  function clearDisplay() {

    S.articles = [];
    S.points = [];
    S.series = [];

    S.articlesOK = false;
    S.timelineOK = false;
    S.geoOK = false;

    S.articlesError = '';
    S.geoError = '';
    S.timelineError = '';

    S.loadedKey = '';

    render();

    drawMap();

  }

  function changeRegion(id) {

    if (
      !REGION[id] ||
      S.region === id
    ) {

      return;

    }

    S.region = id;

    if (byId('ww-conf-region')) {

      byId('ww-conf-region').value =
        id;

    }

    clearDisplay();

    void refresh(true);

  }

  function wireRegionNav() {

    document.addEventListener(

      'click',

      e => {

        const button =
          e.target.closest(
            '[data-region]'
          );

        if (

          button &&
          REGION[
            button.dataset.region
          ]

        ) {

          changeRegion(
            button.dataset.region
          );

        }

      }

    );

  }

  /* ==========================================================
     13 - RENDER HEADLINE LIST
     ========================================================== */

  function renderStories() {

    const host = byId(
      'ww-conf-stories'
    );

    if (!host) {
      return;
    }

    host.replaceChildren();

    if (!S.articlesOK) {

      host.append(

        el(

          'div',

          'ww-conf-note',

          S.articlesError

            ? 'NEWSWIRE// ' +
              S.articlesError

            : 'AWAITING ARTICLE SEARCH'

        )

      );

      return;

    }

    if (!S.articles.length) {

      host.append(

        el(

          'div',

          'ww-conf-note',

          'NO HEADLINES MATCH THE SELECTED QUERY.'

        )

      );

      return;

    }

    host.append(

      el(

        'div',

        'ww-conf-note',

        'GDELT ARTICLE SEARCH// ' +
        S.articles.length +
        ' RESULTS (NOT AN INCIDENT COUNT).'

      )

    );

    S.articles
      .slice(0, 32)
      .forEach(a => {

        const item = el(
          'div',
          'ww-conf-headline'
        );

        const link = external(
          a.title,
          a.url
        );

        if (link) {
          item.append(link);
        }

        item.append(

          el(

            'div',

            'ww-conf-meta',

            a.source.toUpperCase() +
            ' | ' +
            utc(a.date) +
            ' | ' +
            (
              a.sourcecountry ||
              'COUNTRY UNKNOWN'
            )

          )

        );

        host.append(item);

      });

  }

  /* ==========================================================
     14 - RENDER REPORTING TIMELINE

     TimelineVol = share of GDELT news coverage.
     This is not a count of military incidents.
     ========================================================== */

  function renderTimeline() {

    const host = byId(
      'ww-conf-timeline'
    );

    if (!host) {
      return;
    }

    host.replaceChildren();

    if (!S.timelineOK) {

      host.append(

        el(

          'div',

          'ww-conf-note',

          S.timelineError

            ? 'TIMELINE// ' +
              S.timelineError

            : 'AWAITING REPORTING TIMELINE'

        )

      );

      return;

    }

    if (!S.series.length) {

      host.append(

        el(

          'div',

          'ww-conf-note',

          'NO REPORTING-VOLUME DATA RETURNED.'

        )

      );

      return;

    }

    const max = Math.max(

      ...S.series.map(
        p => p.value
      ),

      0.000001

    );

    const chart = el(
      'div',
      'ww-conf-bars'
    );

    const data = S.series;

    const step = Math.max(

      1,

      Math.ceil(
        data.length / 72
      )

    );

    for (
      let i = 0;
      i < data.length;
      i += step
    ) {

      const batch = data.slice(
        i,
        i + step
      );

      const value =

        batch.reduce(
          (sum, p) =>
            sum + p.value,
          0
        ) / batch.length;

      const bar = el(
        'div',
        'ww-conf-bar'
      );

      bar.style.height =

        Math.max(

          2,

          Math.round(
            100 * value / max
          )

        ) + '%';

      bar.title =

        utc(
          batch[
            batch.length - 1
          ].date
        ) +

        ' | ' +

        value.toFixed(3) +

        '% OF GDELT NEWS COVERAGE';

      chart.append(bar);

    }

    host.append(chart);

    const foot = el(
      'div',
      'ww-conf-chart-foot'
    );

    foot.append(

      el(
        'span',
        '',
        utc(data[0].date)
      )

    );

    foot.append(

      el(
        'span',
        '',
        'PEAK ' +
        max.toFixed(3) +
        '%'
      )

    );

    foot.append(

      el(

        'span',

        '',

        utc(
          data[
            data.length - 1
          ].date
        )

      )

    );

    host.append(foot);

    host.append(

      el(

        'div',

        'ww-conf-note',

        'SOURCE MEASURE// SHARE (%) OF GDELT-MONITORED ARTICLES MATCHING QUERY. ' +
        'NOT VERIFIED INCIDENTS.'

      )

    );

  }

  /* ==========================================================
     15 - GEO REPORTING / MAP POPUPS
     ========================================================== */

  function pointDetails(p) {

    const root = el('div');

    root.append(

      el(
        'strong',
        '',
        p.name
      )

    );

    root.append(

      el(

        'div',

        'ww-conf-note',

        'MEDIA-MENTIONED PLACE // NOT INCIDENT GEOLOCATION'

      )

    );

    root.append(

      el(

        'div',

        'ww-conf-meta',

        p.lat.toFixed(3) +
        ', ' +
        p.lon.toFixed(3) +
        ' | GDELT MENTIONS: ' +
        p.mentions

      )

    );

    for (
      const a of p.links.slice(0, 3)
    ) {

      const row = el('div');

      const link = external(
        a.title,
        a.url
      );

      if (link) {
        row.append(link);
      }

      root.append(row);

    }

    return root;

  }

  function renderLocations() {

    const host = byId(
      'ww-conf-locations'
    );

    if (!host) {
      return;
    }

    host.replaceChildren();

    if (!S.geoOK) {

      host.append(

        el(

          'div',

          'ww-conf-note',

          S.geoError

            ? 'GEO// ' +
              S.geoError

            : 'AWAITING GEO REPORTING'

        )

      );

      return;

    }

    const data = regionalPoints();

    host.append(

      el(

        'div',

        'ww-conf-note',

        'REGION// ' +
        REGION[S.region].name +
        ' | ' +
        data.length +
        ' LOCATIONS IN ' +
        geoSpan().toUpperCase() +
        ' MEDIA WINDOW.'

      )

    );

    if (!data.length) {

      host.append(

        el(

          'div',

          'ww-conf-note',

          'NO MAPPED LOCATION MENTIONS IN CURRENT RESULTS.'

        )

      );

      return;

    }

    data.slice(0, 22).forEach(p => {

      const row = el(
        'div',
        'ww-conf-location'
      );

      row.append(

        btn(
          '[ LOCATE ]',
          () => locate(p)
        )

      );

      row.append(
        ' ' + p.name
      );

      row.append(

        el(

          'div',

          'ww-conf-meta',

          'NEWS MENTIONS// ' +
          p.mentions

        )

      );

      host.append(row);

    });

  }

  function render() {

    updateStatus();

    renderTimeline();

    renderStories();

    renderLocations();

  }

  /* ==========================================================
     16 - TACTICAL MAP LAYER
     ========================================================== */

  function syncLayer() {

    if (
      !S.map ||
      !S.layer
    ) {

      return;

    }

    const enabled = Boolean(
      byId('layer-conflicts')
        ?.checked
    );

    if (

      enabled &&
      !S.map.hasLayer(S.layer)

    ) {

      S.layer.addTo(
        S.map
      );

    }

    if (

      !enabled &&
      S.map.hasLayer(S.layer)

    ) {

      S.map.removeLayer(
        S.layer
      );

    }

    metric(

      'map-active-layers',

      document.querySelectorAll(
        '[data-map-layer]:checked'
      ).length

    );

  }

  function drawMap() {

    if (

      !S.map ||
      !S.layer ||
      !window.L

    ) {

      return;

    }

    S.layer.clearLayers();

    for (
      const p of regionalPoints()
        .slice(0, 160)
    ) {

      const radius = Math.max(

        4,

        Math.min(

          10,

          4 + Math.log1p(
            p.mentions
          )

        )

      );

      L.circleMarker(

        [
          p.lat,
          p.lon
        ],

        {

          radius,

          weight: 1.5,

          color: '#e8bf62',

          fillColor: '#e8bf62',

          fillOpacity: 0.38,

          opacity: 0.85

        }

      )

        .bindTooltip(
          p.name +
          ' // NEWS MENTION'
        )

        .bindPopup(
          pointDetails(p)
        )

        .addTo(
          S.layer
        );

    }

    syncLayer();

  }

  function locate(p) {

    if (!S.map) {
      return;
    }

    const toggle = byId(
      'layer-conflicts'
    );

    if (toggle) {
      toggle.checked = true;
    }

    syncLayer();

    S.map.flyTo(

      [
        p.lat,
        p.lon
      ],

      5,

      {
        duration: 0.8
      }

    );

    L.popup()

      .setLatLng([
        p.lat,
        p.lon
      ])

      .setContent(
        pointDetails(p)
      )

      .openOn(S.map);

  }

  function viewMentions() {

    const data = regionalPoints();

    if (
      !S.map ||
      !data.length
    ) {

      window.WorldWatch?.notify(

        'CONFLICT// NO GEO MENTIONS TO DISPLAY',

        'warning'

      );

      return;

    }

    const toggle = byId(
      'layer-conflicts'
    );

    if (toggle) {
      toggle.checked = true;
    }

    syncLayer();

    if (data.length === 1) {

      locate(data[0]);

    } else {

      S.map.fitBounds(

        L.latLngBounds(

          data.map(
            p => [
              p.lat,
              p.lon
            ]
          )

        ),

        {

          padding: [
            35,
            35
          ],

          maxZoom: 7,

          animate: true

        }

      );

    }

  }

  function mapHook() {

    if (!window.L?.Map) {
      return;
    }

    L.Map.addInitHook(

      function () {

        if (

          this.getContainer()?.id !==
          'world-map'

        ) {

          return;

        }

        S.map = this;

        S.layer = L.layerGroup();

        drawMap();

      }

    );

  }

  /* ==========================================================
     17 - FETCH THREE GDELT DATA SOURCES
     ========================================================== */

  async function refresh(manual = false) {

    if (S.promise) {
      return S.promise;
    }

    const now = Date.now();

    if (

      now - S.lastAttempt <
      MIN_REQUEST_MS

    ) {

      if (manual) {

        window.WorldWatch?.notify(

          'CONFLICT// SOURCE COOLDOWN ' +

          Math.ceil(

            (
              MIN_REQUEST_MS -
              (now - S.lastAttempt)
            ) / 1000

          ) +

          's',

          'warning'

        );

      }

      return;

    }

    const sequence = ++S.generation;

    const queryKey = key();

    S.pendingKey = queryKey;

    S.lastAttempt = now;

    S.busy = true;

    S.articlesError = '';
    S.timelineError = '';
    S.geoError = '';

    updateStatus();

    S.promise = (
      async () => {

        const results =
          await Promise.allSettled([

            fetchCached(
              qURL('artlist')
            ),

            fetchCached(
              qURL('timelinevol')
            ),

            fetchCached(
              gURL()
            )

          ]);

        if (

          sequence !== S.generation ||
          queryKey !== key()

        ) {

          return;

        }

        /* ARTICLES */

        if (
          results[0].status ===
          'fulfilled'
        ) {

          try {

            S.articles =
              normalizeArticles(
                results[0].value
              );

            S.articlesOK = true;

          } catch (e) {

            S.articlesError = err(e);

            S.articlesOK = false;

          }

        } else {

          S.articlesError = err(
            results[0].reason
          );

          S.articlesOK = false;

        }

        /* TIMELINE */

        if (
          results[1].status ===
          'fulfilled'
        ) {

          try {

            S.series =
              normalizeTimeline(
                results[1].value
              );

            S.timelineOK = true;

          } catch (e) {

            S.timelineError = err(e);

            S.timelineOK = false;

          }

        } else {

          S.timelineError = err(
            results[1].reason
          );

          S.timelineOK = false;

        }

        /* GEOJSON */

        if (
          results[2].status ===
          'fulfilled'
        ) {

          try {

            S.points =
              normalizeGeo(
                results[2].value
              );

            S.geoOK = true;

          } catch (e) {

            S.geoError = err(e);

            S.geoOK = false;

          }

        } else {

          S.geoError = err(
            results[2].reason
          );

          S.geoOK = false;

        }

        if (

          S.articlesOK ||
          S.timelineOK ||
          S.geoOK

        ) {

          S.updated = new Date();

        }

        S.loadedKey = queryKey;

        drawMap();

      }
    )();

    try {

      await S.promise;

    } finally {

      S.promise = null;

      S.busy = false;

      if (
        S.pendingKey !== key()
      ) {

        // Re-scan the new selection if the user
        // changed it during the previous request.

        S.lastAttempt = 0;

        void refresh(false);

      }

      render();

    }

  }

  /* ==========================================================
     18 - START THE MODULE
     ========================================================== */

  function start() {

    if (

      S.started ||
      !window.WorldWatch

    ) {

      return;

    }

    S.started = true;

    /* FOLLOW CURRENT WORLDWATCH REGION */

    const current =
      document.querySelector(
        '[data-region].active'
      );

    if (

      current &&
      REGION[
        current.dataset.region
      ]

    ) {

      S.region =
        current.dataset.region;

    }

    installUI();

    /* REGISTER MAP HOOK BEFORE map.js */

    mapHook();

    wireRegionNav();

    /* REGISTER WITH WORLDWATCH CONTROLLER */

    window.WorldWatch.registerModule(

      'conflict',

      {
        refresh
      }

    );

    /* AUTOMATIC REFRESH */

    window.setInterval(

      () => {

        if (!document.hidden) {

          void refresh();

        }

        render();

      },

      REFRESH_MS

    );

    /* REFRESH AFTER RETURNING TO TAB */

    document.addEventListener(

      'visibilitychange',

      () => {

        if (

          !document.hidden &&

          Date.now() -
          S.lastAttempt >
          REFRESH_MS

        ) {

          void refresh();

        }

      }

    );

    void refresh();

  }

  start();

})();
