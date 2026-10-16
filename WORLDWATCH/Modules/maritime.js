
/* ============================================================
   WORLDWATCH // SEA - MARITIME OPERATIONS
   FILE: modules/maritime.js

   Default feed:
     Fintraffic / Digitraffic AIS (Finnish waters)

   Positions:
     https://meri.digitraffic.fi/api/ais/v1/locations

   Vessel metadata:
     https://meri.digitraffic.fi/api/ais/v1/vessels/{mmsi}

   Optional future home-server endpoint:

     window.WORLDWATCH_MARITIME_API =
       '/api/maritime/vessels';

   That server must return:
     {vessels:[{mmsi,lat,lon,reportedAt,...}]}

   The home server should keep private AIS credentials
   out of browser JavaScript.

   Advisory information only.
   Not for navigation or collision avoidance.
   ============================================================ */

'use strict';

(() => {

  /* ==========================================================
     01 - CONFIGURATION
     ========================================================== */

  const $ = id =>
    document.getElementById(id);

  const FINTRAFFIC =
    'https://meri.digitraffic.fi/api/ais/v1';

  const BACKEND =
    typeof window.WORLDWATCH_MARITIME_API === 'string'

      ? window.WORLDWATCH_MARITIME_API.trim()

      : '';

  const AUTO_MS = 120000;
  const MIN_MS = 90000;
  const MAX_FIX_AGE_MS = 30 * 60000;
  const HEALTH_AGE_MS = 8 * 60000;
  const DETAIL_CACHE_MS = 12 * 3600000;
  const MAX_MARKERS = 350;

  const COLOR = {

    moving: '#73db94',
    moored: '#e8bf62',
    anchored: '#70b7d5',
    unknown: '#8da895',
    selected: '#fff3b0'

  };

  /* ==========================================================
     02 - GEOGRAPHIC COVERAGE

     The default Fintraffic feed covers Finnish waterways.

     A future authenticated home-server adapter can
     provide worldwide or Gulf Coast coverage.
     ========================================================== */

  const FINNISH_ZONES = {

    helsinki: {
      label: 'HELSINKI / GULF OF FINLAND',
      lat: 60.17,
      lon: 24.94,
      radius: 90
    },

    turku: {
      label: 'TURKU / ARCHIPELAGO',
      lat: 60.44,
      lon: 22.27,
      radius: 90
    },

    kotka: {
      label: 'KOTKA / EASTERN GULF',
      lat: 60.46,
      lon: 26.94,
      radius: 95
    },

    vaasa: {
      label: 'VAASA / BOTHNIAN SEA',
      lat: 63.10,
      lon: 21.62,
      radius: 100
    },

    oulu: {
      label: 'OULU / BOTHNIAN BAY',
      lat: 65.01,
      lon: 25.47,
      radius: 100
    }

  };

  const HOME_ZONES = {

    nwfl: {
      label: 'NW FL / PENSACOLA',
      lat: 30.25,
      lon: -87.05,
      radius: 100
    },

    tampa: {
      label: 'TAMPA BAY',
      lat: 27.69,
      lon: -82.75,
      radius: 100
    },

    neworleans: {
      label: 'NEW ORLEANS / GULF',
      lat: 29.75,
      lon: -89.94,
      radius: 140
    },

    norfolk: {
      label: 'HAMPTON ROADS',
      lat: 36.87,
      lon: -76.22,
      radius: 100
    },

    gibraltar: {
      label: 'STRAIT OF GIBRALTAR',
      lat: 35.97,
      lon: -5.61,
      radius: 100
    },

    singapore: {
      label: 'STRAIT OF SINGAPORE',
      lat: 1.24,
      lon: 103.86,
      radius: 90
    }

  };

  const ZONES =
    BACKEND ? HOME_ZONES : FINNISH_ZONES;

  const DEFAULT_ZONE =
    BACKEND ? 'nwfl' : 'helsinki';

  /* ==========================================================
     03 - AIS NAVIGATION STATUS DEFINITIONS
     ========================================================== */

  const NAV = {

    0: 'UNDER WAY / ENGINE',
    1: 'AT ANCHOR',
    2: 'NOT UNDER COMMAND',
    3: 'RESTRICTED MANEUVERING',
    4: 'CONSTRAINED BY DRAUGHT',
    5: 'MOORED',
    6: 'AGROUND',
    7: 'FISHING',
    8: 'UNDER WAY / SAIL',
    15: 'NOT DEFINED'

  };

  /* ==========================================================
     04 - STATE
     ========================================================== */

  const S = {

    started: false,

    map: null,

    layer: null,

    zone: DEFAULT_ZONE,

    center: ZONES[DEFAULT_ZONE],

    radius: ZONES[DEFAULT_ZONE].radius,

    vessels: [],

    selected: null,

    filter: 'all',

    search: '',

    metadata: new Map(),

    lastGood: null,

    sourceTime: null,

    attempt: 0,

    pending: null,

    error: '',

    cooldown: 0,

    source: BACKEND
      ? 'HOME AIS ADAPTER'
      : 'FINTRAFFIC / DIGITRAFFIC',

    detailBusy: new Set()

  };

  /* ==========================================================
     05 - UTILITIES
     ========================================================== */

  const num = x =>

    x === null ||
    x === undefined ||
    x === ''

      ? null

      : (
          Number.isFinite(Number(x))
            ? Number(x)
            : null
        );

  const goodCoord = (lat, lon) =>

    lat !== null &&
    lon !== null &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180;

  const text = x =>
    String(x ?? '').trim();

  const timeUTC = d =>

    d instanceof Date &&
    Number.isFinite(d.getTime())

      ? d.toISOString()
          .slice(0, 19)
          .replace('T', ' ') + 'Z'

      : '--';

  const make = (tag, cls, content) => {

    const e = document.createElement(tag);

    if (cls) {
      e.className = cls;
    }

    if (content !== undefined) {
      e.textContent = String(content);
    }

    return e;

  };

  function put(id, value) {

    if ($(id)) {
      $(id).textContent = String(value);
    }

  }

  function button(label, click, cls = '') {

    const b = make(
      'button',
      'ww-sea-button ' + cls,
      label
    );

    b.type = 'button';

    b.addEventListener(
      'click',
      click
    );

    return b;

  }

  function statusName(code) {

    return NAV[code] || 'UNKNOWN';

  }

  function category(v) {

    if (v.nav === 1) {
      return 'anchored';
    }

    if (v.nav === 5) {
      return 'moored';
    }

    if ((v.speed ?? 0) > 0.5) {
      return 'moving';
    }

    return 'unknown';

  }

  function ageMs(v) {

    return Date.now() - v.reported.getTime();

  }

  function fresh(v) {

    return (
      ageMs(v) >= -60000 &&
      ageMs(v) <= MAX_FIX_AGE_MS
    );

  }

  function errorMessage(error) {

    if (error?.name === 'AbortError') {
      return 'TIMEOUT';
    }

    if (error instanceof TypeError) {
      return 'NETWORK / CORS BLOCK';
    }

    return String(
      error?.message || error
    ).slice(0, 100);

  }

  /* ==========================================================
     06 - NORMALIZE AIS DATA

     Fintraffic uses GeoJSON:
       geometry.coordinates = [longitude, latitude]

     timestampExternal is Unix milliseconds.
     The AIS "timestamp" field alone is NOT Unix time.
     ========================================================== */

  function normalize(item) {

    const p =
      item?.properties || item || {};

    const coord =
      item?.geometry?.coordinates;

    const lat = num(
      Array.isArray(coord)
        ? coord[1]
        : (p.lat ?? p.latitude)
    );

    const lon = num(
      Array.isArray(coord)
        ? coord[0]
        : (p.lon ?? p.longitude)
    );

    const mmsi = text(
      p.mmsi ?? item?.mmsi
    );

    if (
      !/^\d{9}$/.test(mmsi) ||
      !goodCoord(lat, lon)
    ) {
      return null;
    }

    const millis = num(
      p.timestampExternal ??
      p.lastSeenMs ??
      p.reportedMs
    );

    const date =
      millis !== null

        ? new Date(millis)

        : new Date(
            p.lastSeen ??
            p.reportedAt ??
            p.updatedAt ??
            NaN
          );

    if (
      !Number.isFinite(date.getTime())
    ) {
      return null;
    }

    const v = {

      mmsi,

      lat,

      lon,

      reported: date,

      speed: num(p.sog ?? p.speed),

      course: num(p.cog ?? p.course),

      heading: num(p.heading),

      nav: num(p.navStat ?? p.navStatus),

      name: text(p.name ?? p.shipName),

      callSign: text(
        p.callSign ?? p.callsign
      ),

      imo: text(p.imo),

      destination: text(p.destination),

      shipType: num(
        p.type ?? p.shipType
      )

    };

    const meta = S.metadata.get(mmsi);

    if (meta) {
      Object.assign(v, meta);
    }

    return v;

  }

  function parseResponse(data) {

    let raw;

    if (Array.isArray(data?.features)) {

      raw = data.features;

    } else if (Array.isArray(data?.vessels)) {

      raw = data.vessels;

    } else if (Array.isArray(data)) {

      raw = data;

    } else {

      throw Error(
        'UNEXPECTED AIS RESPONSE'
      );

    }

    const byId = new Map();

    raw.forEach(item => {

      const v = normalize(item);

      if (v) {
        byId.set(v.mmsi, v);
      }

    });

    return {

      vessels: [
        ...byId.values()
      ],

      total: raw.length

    };

  }

  /* ==========================================================
     07 - API FETCH

     Browsers manage Accept-Encoding automatically.
     Digitraffic-User identifies our application.
     ========================================================== */

  async function getJSON(url) {

    const ctrl = new AbortController();

    const timer = setTimeout(
      () => ctrl.abort(),
      15000
    );

    try {

      const response = await fetch(

        url,

        {

          signal: ctrl.signal,

          cache: 'no-store',

          headers: BACKEND

            ? {}

            : {
                'Digitraffic-User':
                  'WorldWatch/SEA'
              }

        }

      );

      if (!response.ok) {

        const e = Error(
          'HTTP ' + response.status
        );

        e.status = response.status;

        throw e;

      }

      return await response.json();

    } finally {

      clearTimeout(timer);

    }

  }

  /* ==========================================================
     08 - OPTIONAL VESSEL METADATA

     Only retrieve identity information for a selected
     vessel, rather than requesting every vessel's
     details during each position refresh.
     ========================================================== */

  async function loadDetails(mmsi) {

    if (
      BACKEND ||
      S.detailBusy.has(mmsi) ||
      S.metadata.has(mmsi)
    ) {
      return;
    }

    const key = 'WW_SEA_META_' + mmsi;

    try {

      const cached = JSON.parse(
        sessionStorage.getItem(key) ||
        'null'
      );

      if (
        cached &&
        Date.now() - cached.when <
          DETAIL_CACHE_MS
      ) {

        S.metadata.set(
          mmsi,
          cached.details
        );

        render();
        drawMap();

        return;

      }

    } catch (_) {}

    S.detailBusy.add(mmsi);

    try {

      const raw = await getJSON(
        FINTRAFFIC + '/vessels/' + mmsi
      );

      const p = raw?.properties || raw;

      const details = {

        name: text(p?.name),

        callSign: text(p?.callSign),

        destination: text(p?.destination),

        imo: text(p?.imo),

        shipType: num(p?.type)

      };

      S.metadata.set(
        mmsi,
        details
      );

      try {

        sessionStorage.setItem(

          key,

          JSON.stringify({

            when: Date.now(),

            details

          })

        );

      } catch (_) {}

      S.vessels.forEach(v => {

        if (v.mmsi === mmsi) {
          Object.assign(v, details);
        }

      });

      render();
      drawMap();

    } catch (e) {

      put(
        'ww-sea-detail',
        'VESSEL IDENTITY// ' +
        errorMessage(e)
      );

    } finally {

      S.detailBusy.delete(mmsi);

    }

  }

  /* ==========================================================
     09 - PANEL STYLES
     ========================================================== */

  function installStyles() {

    if ($('ww-sea-style')) {
      return;
    }

    const style = make('style');

    style.id = 'ww-sea-style';

    style.textContent = `

      #maritime-panel .ww-sea-root {
        font:11px/1.5 Consolas,'Courier New',monospace;
        color:#c5dccb;
        min-width:0;
      }

      #maritime-panel .ww-sea-title {
        font-weight:bold;
        color:#e8bf62;
        margin:6px 0;
      }

      #maritime-panel .ww-sea-metrics {
        display:grid;
        grid-template-columns:repeat(3,minmax(0,1fr));
        gap:4px;
        margin:6px 0;
      }

      #maritime-panel .ww-sea-metric {
        background:#081a0f;
        border:1px solid #315b3e;
        padding:5px;
        min-width:0;
      }

      #maritime-panel .ww-sea-metric small {
        display:block;
        color:#8da895;
        font-size:9px;
      }

      #maritime-panel .ww-sea-metric strong {
        color:#73db94;
        font-size:13px;
        overflow-wrap:anywhere;
      }

      #maritime-panel .ww-sea-row {
        display:flex;
        gap:5px;
        flex-wrap:wrap;
        align-items:center;
        margin:6px 0;
      }

      #maritime-panel .ww-sea-select,
      #maritime-panel .ww-sea-search,
      #maritime-panel .ww-sea-button {
        background:#07160d;
        border:1px solid #315b3e;
        color:#c5dccb;
        padding:5px;
        font:10px Consolas,'Courier New',monospace;
      }

      #maritime-panel .ww-sea-select {
        flex:1 1 140px;
        min-width:0;
      }

      #maritime-panel .ww-sea-search {
        width:100%;
        box-sizing:border-box;
      }

      #maritime-panel .ww-sea-button {
        color:#73db94;
        cursor:pointer;
        white-space:nowrap;
      }

      #maritime-panel .ww-sea-button:hover,
      #maritime-panel .ww-sea-button.active {
        color:#a0ffb9;
        border-color:#73db94;
        background:#173523;
      }

      #maritime-panel .ww-sea-note {
        color:#8da895;
        font-size:10px;
        margin:5px 0;
        overflow-wrap:anywhere;
      }

      #maritime-panel .ww-sea-vessel {
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:5px;
        padding:6px 0;
        border-bottom:1px dashed #315b3e;
      }

      #maritime-panel .ww-sea-vessel.selected {
        background:#173523;
      }

      #maritime-panel .ww-sea-name {
        min-width:0;
        flex:1;
        overflow-wrap:anywhere;
      }

      #maritime-panel .ww-sea-name strong {
        color:#a0ffb9;
      }

      #maritime-panel .ww-sea-sub {
        font-size:9px;
        color:#8da895;
      }

      #maritime-panel .ww-sea-detail {
        padding:7px;
        border:1px solid #315b3e;
        background:#081a0f;
        margin:8px 0;
      }

      #maritime-panel .ww-sea-links {
        display:flex;
        gap:8px;
        flex-wrap:wrap;
        margin:8px 0;
      }

      #maritime-panel .ww-sea-links a {
        font-size:10px;
        color:#73db94;
      }

      #maritime-panel .ww-sea-credit {
        font-size:9px;
        color:#8da895;
        border-top:1px solid #315b3e;
        padding-top:7px;
        margin-top:9px;
        line-height:1.6;
      }

      #maritime-panel .ww-sea-credit a {
        color:#73db94;
      }

    `;

    document.head.append(style);

  }

  /* ==========================================================
     10 - CONSTRUCT PANEL
     ========================================================== */

  function buildUI() {

    installStyles();

    const host = $('maritime-panel')
      ?.querySelector('.panel-content');

    if (!host) {
      return;
    }

    host.replaceChildren();

    const root = make(
      'div',
      'ww-sea-root'
    );

    host.append(root);

    root.append(

      make(

        'div',

        'ww-sea-title',

        'AIS// VESSEL SURVEILLANCE'

      )

    );

    const line = make(
      'div',
      'ww-sea-note'
    );

    line.id = 'ww-sea-state';

    root.append(line);

    /* METRICS */

    const metrics = make(
      'div',
      'ww-sea-metrics'
    );

    for (
      const [id, label] of [

        ['count', 'VISIBLE'],

        ['moving', 'UNDER WAY'],

        ['stopped', 'STOPPED']

      ]
    ) {

      const box = make(
        'div',
        'ww-sea-metric'
      );

      box.append(

        make(
          'small',
          '',
          label
        )

      );

      const val = make(
        'strong',
        '',
        '--'
      );

      val.id = 'ww-sea-' + id;

      box.append(val);

      metrics.append(box);

    }

    root.append(metrics);

    /* REGION SELECTION */

    root.append(

      make(

        'div',

        'ww-sea-title',

        'REGION// AIS COVERAGE'

      )

    );

    const areaRow = make(
      'div',
      'ww-sea-row'
    );

    const area = make(
      'select',
      'ww-sea-select'
    );

    area.id = 'ww-sea-area';

    area.setAttribute(
      'aria-label',
      'Select AIS coverage region'
    );

    for (
      const [key, val] of Object.entries(ZONES)
    ) {

      const opt = make(
        'option',
        '',
        val.label
      );

      opt.value = key;

      area.append(opt);

    }

    area.value = S.zone;

    areaRow.append(area);

    areaRow.append(

      button(

        '[ SCAN ]',

        () => void refresh(true)

      )

    );

    areaRow.append(

      button(

        '[ VIEW ZONE ]',

        viewZone

      )

    );

    root.append(areaRow);

    const note = make(
      'div',
      'ww-sea-note'
    );

    note.id = 'ww-sea-meta';

    root.append(note);

    /* FILTER CONTROLS */

    root.append(

      make(

        'div',

        'ww-sea-title',

        'CONTACTS// FILTER'

      )

    );

    const filters = make(
      'div',
      'ww-sea-row'
    );

    for (
      const [key, label] of [

        ['all', 'ALL'],

        ['moving', 'MOVING'],

        ['anchored', 'ANCHORED'],

        ['moored', 'MOORED']

      ]
    ) {

      filters.append(

        button(

          '[' + label + ']',

          () => {

            S.filter = key;

            filters
              .querySelectorAll('button')
              .forEach(b => {

                b.classList.toggle(

                  'active',

                  b.textContent === '[' + label + ']'

                );

              });

            drawList();
            drawMap();

          },

          key === 'all'
            ? 'active'
            : ''

        )

      );

    }

    root.append(filters);

    /* SEARCH */

    const search = make(
      'input',
      'ww-sea-search'
    );

    search.type = 'search';

    search.placeholder =
      'SEARCH MMSI / NAME / DESTINATION';

    search.setAttribute(
      'aria-label',
      'Search ships by MMSI name or destination'
    );

    search.addEventListener(
      'input',
      () => {

        S.search =
          search.value
            .trim()
            .toLowerCase();

        drawList();
        drawMap();

      }
    );

    root.append(search);

    /* SELECTED VESSEL DETAILS */

    const selected = make(

      'div',

      'ww-sea-detail',

      'SELECT VESSEL// NONE'

    );

    selected.id = 'ww-sea-detail';

    root.append(selected);

    /* VESSEL LIST */

    const list = make('div');

    list.id = 'ww-sea-list';

    root.append(list);

    /* DIAGNOSTICS */

    root.append(

      make(

        'div',

        'ww-sea-title',

        'SOURCE// DIAGNOSTICS'

      )

    );

    const diag = make(
      'div',
      'ww-sea-note'
    );

    diag.id = 'ww-sea-diag';

    root.append(diag);

    /* EXTERNAL TRACKERS */

    const links = make(
      'div',
      'ww-sea-links'
    );

    for (
      const [label, url] of [

        [
          '[ VESSELFINDER ]',
          'https://www.vesselfinder.com/'
        ],

        [
          '[ MARINETRAFFIC ]',
          'https://www.marinetraffic.com/'
        ],

        [
          '[ FINTRAFFIC AIS ]',
          'https://www.digitraffic.fi/en/marine-traffic/'
        ]

      ]
    ) {

      const a = make(
        'a',
        '',
        label
      );

      a.href = url;

      a.target = '_blank';

      a.rel = 'noopener noreferrer';

      links.append(a);

    }

    root.append(links);

    /* SOURCE ATTRIBUTION */

    const credit = make(
      'div',
      'ww-sea-credit'
    );

    if (!BACKEND) {

      credit.append(
        'DATA// Fintraffic / digitraffic.fi. Licensed '
      );

      const a = make(
        'a',
        '',
        'CC BY 4.0'
      );

      a.href =
        'https://creativecommons.org/licenses/by/4.0/';

      a.target = '_blank';

      a.rel = 'noopener noreferrer';

      credit.append(

        a,

        '. WORLDWATCH filters, categorizes and maps positions.'

      );

    } else {

      credit.textContent =
        'SOURCE// HOME SERVER AIS ADAPTER. ' +
        'Verify upstream attribution and redistribution terms.';

    }

    credit.append(

      make(

        'div',

        '',

        'ADVISORY ONLY // NOT FOR NAVIGATION OR COLLISION AVOIDANCE.'

      )

    );

    root.append(credit);

    /* ENABLE GLOBAL MAP LAYER */

    const layer = $('layer-maritime');

    if (layer) {

      layer.disabled = false;

      layer.checked = true;

      layer.addEventListener(
        'change',
        syncLayer
      );

    }

    updateReadout();

    drawList();

  }

  /* ==========================================================
     11 - VESSEL FILTERING
     ========================================================== */

  function filtered() {

    return S.vessels

      .filter(v => {

        if (!fresh(v)) {
          return false;
        }

        if (
          S.filter !== 'all' &&
          category(v) !== S.filter
        ) {
          return false;
        }

        if (

          S.search &&

          ![
            v.mmsi,
            v.name,
            v.callSign,
            v.imo,
            v.destination
          ].join(' ')
            .toLowerCase()
            .includes(S.search)

        ) {
          return false;
        }

        return true;

      })

      .sort((a, b) => {

        if (a.mmsi === S.selected) {
          return -1;
        }

        if (b.mmsi === S.selected) {
          return 1;
        }

        return (
          (b.speed ?? -1) -
          (a.speed ?? -1)
        );

      });

  }

  /* ==========================================================
     12 - COUNTERS AND STATUS
     ========================================================== */

  function updateReadout() {

    const good =
      S.vessels.filter(fresh);

    put(
      'ww-sea-count',
      good.length
    );

    put(

      'ww-sea-moving',

      good.filter(
        v => category(v) === 'moving'
      ).length

    );

    put(

      'ww-sea-stopped',

      good.filter(

        v => [
          'moored',
          'anchored'
        ].includes(category(v))

      ).length

    );

    const stale =

      !S.lastGood ||

      Date.now() -
        S.lastGood.getTime() >
        HEALTH_AGE_MS;

    const label =

      S.pending

        ? 'SCANNING'

        : S.error

          ? (
              S.lastGood
                ? 'STALE'
                : 'OFFLINE'
            )

          : stale

            ? 'STALE'

            : 'ONLINE';

    put(

      'ww-sea-state',

      'STATUS// ' +
      label +
      ' | ' +
      S.source

    );

    put(
      'maritime-status',
      label
    );

    put(

      'ww-sea-meta',

      `AREA// ${S.center.label} | ` +
      `${S.radius} KM | ` +
      `UPDATED// ${timeUTC(S.lastGood)}`

    );

    put(

      'ww-sea-diag',

      `SOURCE// ${S.source} | ` +

      `REPORTS// ${S.vessels.length} | ` +

      `FRESH// ${good.length} | ` +

      `POSITION LIMIT// 30 MIN | ` +

      (
        S.error

          ? 'ISSUE// ' + S.error

          : 'LAST SUCCESS// ' + timeUTC(S.lastGood)
      )

    );

    window.WorldWatch?.reportModuleStatus(

      'maritime',

      label === 'ONLINE'

        ? 'online'

        : label === 'SCANNING'

          ? 'standby'

          : label === 'STALE'

            ? 'stale'

            : 'error',

      S.error

    );

  }

  /* ==========================================================
     13 - DETAIL DISPLAY
     ========================================================== */

  function detailElement(v) {

    const div = make('div');

    div.append(

      make(

        'strong',

        '',

        v.name || 'MMSI ' + v.mmsi

      )

    );

    for (
      const [label, value] of [

        ['MMSI', v.mmsi],

        ['CALL SIGN', v.callSign || '--'],

        ['IMO', v.imo || '--'],

        ['DESTINATION', v.destination || '--'],

        [
          'POSITION',

          v.lat.toFixed(4) +
          ' / ' +
          v.lon.toFixed(4)
        ],

        [
          'SPEED',

          v.speed === null

            ? '--'

            : v.speed.toFixed(1) + ' KNOTS'
        ],

        [
          'COURSE',

          v.course === null ||
          v.course >= 360

            ? '--'

            : v.course.toFixed(0) + '°'
        ],

        [
          'NAV STATE',
          statusName(v.nav)
        ],

        [
          'AIS FIX',
          timeUTC(v.reported)
        ],

        [
          'POSITION AGE',

          Math.max(
            0,
            Math.floor(ageMs(v) / 60000)
          ) + ' MIN'
        ]

      ]
    ) {

      div.append(

        make(

          'div',

          '',

          label + '// ' + value

        )

      );

    }

    return div;

  }

  /* ==========================================================
     14 - VESSEL CONTACT LIST
     ========================================================== */

  function drawList() {

    const list =
      $('ww-sea-list');

    if (!list) {
      return;
    }

    list.replaceChildren();

    const vessels =
      filtered();

    list.append(

      make(

        'div',

        'ww-sea-note',

        `MATCHES// ${vessels.length} | ` +

        `SHOWING// ${Math.min(vessels.length, 65)} | ` +

        '[ LOCATE ] TO CENTER MAP'

      )

    );

    for (
      const v of vessels.slice(0, 65)
    ) {

      const row = make(

        'div',

        'ww-sea-vessel' +

        (
          v.mmsi === S.selected
            ? ' selected'
            : ''
        )

      );

      const left = make(
        'div',
        'ww-sea-name'
      );

      left.append(

        make(

          'strong',

          '',

          v.name || 'MMSI ' + v.mmsi

        )

      );

      left.append(

        make(

          'div',

          'ww-sea-sub',

          `${category(v).toUpperCase()} | ` +

          `${
            v.speed === null
              ? '--'
              : v.speed.toFixed(1)
          } KT | ` +

          `${
            Math.max(
              0,
              Math.floor(ageMs(v) / 60000)
            )
          } MIN OLD`

        )

      );

      row.append(

        left,

        button(

          '[ LOCATE ]',

          () => locate(v.mmsi)

        )

      );

      list.append(row);

    }

    if (!vessels.length) {

      list.append(

        make(

          'div',

          'ww-sea-note',

          S.error

            ? 'AIS DATA UNAVAILABLE / BLOCKED'

            : 'NO FRESH VESSELS MATCH. ' +
              'THIS FEED ONLY COVERS THE SELECTED REGION.'

        )

      );

    }

    const sel = S.vessels.find(
      v => v.mmsi === S.selected
    );

    const target = $('ww-sea-detail');

    if (target) {

      target.replaceChildren();

      if (sel && fresh(sel)) {

        target.append(
          detailElement(sel)
        );

      } else {

        target.textContent =
          'SELECT VESSEL// NONE';

      }

    }

  }

  function render() {

    updateReadout();

    drawList();

  }

  /* ==========================================================
     15 - LEAFLET MAP LAYER
     ========================================================== */

  function syncLayer() {

    if (
      !S.map ||
      !S.layer
    ) {
      return;
    }

    const on = Boolean(
      $('layer-maritime')?.checked
    );

    if (
      on &&
      !S.map.hasLayer(S.layer)
    ) {

      S.layer.addTo(
        S.map
      );

    }

    if (
      !on &&
      S.map.hasLayer(S.layer)
    ) {

      S.map.removeLayer(
        S.layer
      );

    }

    put(

      'map-active-layers',

      document.querySelectorAll(
        '[data-map-layer]:checked'
      ).length

    );

  }

  /* ==========================================================
     16 - DRAW AIS CONTACTS
     ========================================================== */

  function drawMap() {

    if (
      !S.layer ||
      !S.map ||
      !window.L
    ) {
      return;
    }

    S.layer.clearLayers();

    /* SURVEILLANCE BOUNDARY */

    L.circle(

      [
        S.center.lat,
        S.center.lon
      ],

      {

        radius: S.radius * 1000,

        weight: 1,

        color: '#70b7d5',

        dashArray: '6 6',

        opacity: 0.55,

        fill: false,

        interactive: false

      }

    ).addTo(S.layer);

    /* VESSEL POSITION MARKERS */

    for (
      const v of filtered().slice(0, MAX_MARKERS)
    ) {

      const chosen =
        v.mmsi === S.selected;

      const color = chosen

        ? COLOR.selected

        : COLOR[category(v)];

      L.circleMarker(

        [
          v.lat,
          v.lon
        ],

        {

          radius: chosen ? 8 : 5,

          color,

          fillColor: color,

          fillOpacity: 0.7,

          weight: chosen ? 3 : 1.5

        }

      )

        .bindPopup(detailElement(v))

        .addTo(S.layer);

    }

    syncLayer();

  }

  /* ==========================================================
     17 - VIEW SELECTED AREA
     ========================================================== */

  function viewZone() {

    if (!S.map) {
      return;
    }

    if ($('layer-maritime')) {

      $('layer-maritime').checked = true;

    }

    syncLayer();

    drawMap();

    S.map.flyTo(

      [
        S.center.lat,
        S.center.lon
      ],

      S.radius > 110
        ? 6
        : 7,

      {
        duration: 0.8
      }

    );

  }

  /* ==========================================================
     18 - LOCATE VESSEL
     ========================================================== */

  function locate(mmsi) {

    const v = S.vessels.find(

      x =>

        x.mmsi === mmsi &&
        fresh(x)

    );

    if (
      !v ||
      !S.map
    ) {

      window.WorldWatch?.notify(

        'SEA// VESSEL POSITION UNAVAILABLE',

        'warning'

      );

      return;

    }

    S.selected = mmsi;

    if ($('layer-maritime')) {

      $('layer-maritime').checked = true;

    }

    drawMap();

    drawList();

    S.map.flyTo(

      [
        v.lat,
        v.lon
      ],

      10,

      {
        duration: 0.8
      }

    );

    L.popup()

      .setLatLng([
        v.lat,
        v.lon
      ])

      .setContent(
        detailElement(v)
      )

      .openOn(S.map);

    void loadDetails(mmsi);

  }

  /* ==========================================================
     19 - REFRESH DATA

     Requests are rate-limited.
     The default provider is regional, not worldwide.

     A server-side source can be configured later.
     ========================================================== */

  async function refresh(manual = false) {

    if (S.pending) {
      return S.pending;
    }

    const now = Date.now();

    if (
      now < S.cooldown
    ) {

      S.error =
        'SOURCE COOLDOWN UNTIL ' +
        timeUTC(new Date(S.cooldown));

      render();

      return;

    }

    if (
      now - S.attempt < MIN_MS
    ) {

      if (manual) {

        window.WorldWatch?.notify(

          'SEA// NEXT REFRESH IN ' +

          Math.ceil(

            (
              MIN_MS -
              (now - S.attempt)
            ) / 1000

          ) + 's',

          'warning'

        );

      }

      return;

    }

    /* READ REGION SELECTION */

    const requested =
      $('ww-sea-area')?.value ||
      DEFAULT_ZONE;

    const zone =
      ZONES[requested] ||
      ZONES[DEFAULT_ZONE];

    if (
      S.zone !== requested
    ) {

      S.zone = requested;

      S.center = zone;

      S.radius = zone.radius;

      S.vessels = [];

      S.lastGood = null;

      S.selected = null;

      S.error = '';

    }

    S.attempt = now;

    S.error = '';

    S.pending = (
      async () => {

        try {

          const query = BACKEND

            ? new URLSearchParams({

                lat: String(zone.lat),

                lon: String(zone.lon),

                radiusKm: String(zone.radius)

              })

            : new URLSearchParams({

                latitude: String(zone.lat),

                longitude: String(zone.lon),

                radius: String(zone.radius)

              });

          const url =

            (
              BACKEND ||
              FINTRAFFIC + '/locations'
            ) +

            '?' +

            query.toString();

          const payload =
            await getJSON(url);

          const parsed =
            parseResponse(payload);

          S.vessels =
            parsed.vessels;

          S.lastGood =
            new Date();

          S.sourceTime = new Date(

            payload.dataUpdatedTime ||
            payload.updatedAt ||
            Date.now()

          );

          if (

            !S.vessels.some(
              v => v.mmsi === S.selected
            )

          ) {

            S.selected = null;

          }

          drawMap();

        } catch (e) {

          S.error =
            errorMessage(e);

          if (
            e.status === 403 ||
            e.status === 429
          ) {

            S.cooldown =
              Date.now() + 5 * 60000;

          }

          /* Preserve true report timestamps.
             Do not relabel old positions as live. */

          console.warn(

            '[WORLDWATCH][SEA]',

            S.error

          );

        }

      }
    )();

    render();

    try {

      await S.pending;

    } finally {

      S.pending = null;

      render();

      drawMap();

    }

  }

  /* ==========================================================
     20 - ATTACH OVERLAY TO EXISTING MAP
     ========================================================== */

  function installMapHook() {

    if (
      !window.L?.Map
    ) {
      return;
    }

    L.Map.addInitHook(

      function() {

        if (

          this.getContainer()?.id !==
          'world-map'

        ) {
          return;
        }

        S.map = this;

        S.layer = L.layerGroup();

        syncLayer();

        drawMap();

        console.log(

          '[WORLDWATCH][SEA] AIS overlay connected'

        );

      }

    );

  }

  /* ==========================================================
     21 - START MODULE
     ========================================================== */

  function start() {

    if (
      S.started ||
      !window.WorldWatch
    ) {
      return;
    }

    S.started = true;

    buildUI();

    installMapHook();

    WorldWatch.registerModule(

      'maritime',

      {
        refresh
      }

    );

    document.addEventListener(

      'worldwatch:layers-changed',

      syncLayer

    );

    /* AUTO REFRESH */

    setInterval(

      () => {

        if (!document.hidden) {

          void refresh();

        }

        render();

        drawMap();

      },

      AUTO_MS

    );

    /* RESUME WHEN TAB IS REVISITED */

    document.addEventListener(

      'visibilitychange',

      () => {

        if (!document.hidden) {

          void refresh();

        }

      }

    );

    void refresh();

    console.log(

      '[WORLDWATCH][SEA] Maritime monitor initialized'

    );

  }

  /* Runs before map.js initializes Leaflet. */

  start();

})();
