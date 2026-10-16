
/* ============================================================
   WORLDWATCH // AIR - AVIATION MONITOR
   FILE: modules/aviation.js

   PRIMARY SOURCE: ADSB.lol
   ALTERNATE SOURCE: Airplanes.live

   Regional ADS-B aircraft surveillance.
   Not comprehensive global air traffic coverage.

   No API key.
   Requires direct browser access to public APIs.
   ============================================================ */

'use strict';

(() => {

  /* ==========================================================
     01 - CONFIGURATION
     ========================================================== */

  const $ = id =>
    document.getElementById(id);

  const PRESETS = {

    nwfl: {
      label: 'NW FL / EGLIN',
      lat: 30.48,
      lon: -86.50
    },

    nyc: {
      label: 'NEW YORK',
      lat: 40.71,
      lon: -73.96
    },

    la: {
      label: 'LOS ANGELES',
      lat: 34.05,
      lon: -118.24
    },

    london: {
      label: 'LONDON',
      lat: 51.47,
      lon: -0.45
    },

    dubai: {
      label: 'DUBAI',
      lat: 25.20,
      lon: 55.36
    },

    tokyo: {
      label: 'TOKYO',
      lat: 35.55,
      lon: 139.78
    }

  };

  const PROVIDERS = [

    {
      name: 'ADSB.LOL',
      base: 'https://api.adsb.lol/v2/point/'
    },

    {
      name: 'AIRPLANES.LIVE',
      base: 'https://api.airplanes.live/v2/point/'
    }

  ];

  const COLORS = {

    green: '#73db94',
    amber: '#e8bf62',
    red: '#e84949',
    muted: '#8da895',
    blue: '#70b7d5'

  };

  const AUTO_MS = 90000;

  const MIN_MS = 30000;

  const AGE_LIMIT = 120;

  const STALE_MS = 4 * 60000;

  const MAX_MARKERS = 300;

  /* ==========================================================
     02 - STATE
     ========================================================== */

  const S = {

    started: false,

    map: null,

    layer: null,

    center: {
      ...PRESETS.nwfl
    },

    radius: 150,

    planes: [],

    total: 0,

    selected: null,

    filter: 'all',

    search: '',

    provider: '',

    lastGood: null,

    lastAttempt: 0,

    pending: null,

    error: '',

    blockedUntil: 0

  };

  /* ==========================================================
     03 - UTILITIES
     ========================================================== */

  function n(value) {

    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {
      return null;
    }

    const num = Number(value);

    return Number.isFinite(num)
      ? num
      : null;

  }

  function coords(lat, lon) {

    return (
      lat !== null &&
      lon !== null &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180
    );

  }

  function utc(date) {

    return date &&
      Number.isFinite(date.getTime())

      ? date.toISOString()
          .slice(0, 19)
          .replace('T', ' ') + 'Z'

      : '--';

  }

  function el(tag, className, value) {

    const element =
      document.createElement(tag);

    if (className) {
      element.className = className;
    }

    if (value !== undefined) {
      element.textContent = String(value);
    }

    return element;

  }

  function set(id, value) {

    const element = $(id);

    if (element) {
      element.textContent = String(value);
    }

  }

  function age(plane) {

    const elapsed = S.lastGood

      ? Math.max(
          0,
          (
            Date.now() -
            S.lastGood.getTime()
          ) / 1000
        )

      : 0;

    return plane.seenPos + elapsed;

  }

  function fresh(plane) {

    return (
      coords(
        plane.lat,
        plane.lon
      ) &&
      age(plane) <= AGE_LIMIT
    );

  }

  function isEmergency(plane) {

    const special = [
      '7500',
      '7600',
      '7700'
    ];

    return (

      special.includes(
        plane.squawk
      ) ||

      (
        plane.emergency &&
        ![
          'none',
          'no emergency',
          ''
        ].includes(
          plane.emergency.toLowerCase()
        )
      )

    );

  }

  /* ==========================================================
     04 - NORMALIZE PROVIDER AIRCRAFT RECORDS
     ========================================================== */

  function toPlane(raw) {

    if (
      !raw ||
      typeof raw !== 'object'
    ) {
      return null;
    }

    const hex = String(
      raw.hex || ''
    ).trim().toUpperCase();

    if (
      !/^[A-Z0-9~]{3,12}$/.test(hex)
    ) {
      return null;
    }

    const lat = n(raw.lat);
    const lon = n(raw.lon);

    if (!coords(lat, lon)) {
      return null;
    }

    const seen = n(
      raw.seen_pos
    );

    if (
      seen === null ||
      seen < 0 ||
      seen > AGE_LIMIT
    ) {
      return null;
    }

    const altitude = n(
      raw.alt_baro
    );

    const geometricAltitude = n(
      raw.alt_geom
    );

    const plane = {

      hex,

      lat,

      lon,

      callsign: String(
        raw.flight || ''
      ).trim().slice(0, 24),

      registration: String(
        raw.r || ''
      ).trim().slice(0, 24),

      aircraftType: String(
        raw.t || ''
      ).trim().slice(0, 16),

      altitude:
        altitude !== null

          ? altitude

          : geometricAltitude,

      ground:
        typeof raw.alt_baro === 'string' &&
        raw.alt_baro.toLowerCase() === 'ground',

      speed: n(
        raw.gs
      ),

      heading: n(
        raw.track
      ),

      squawk: String(
        raw.squawk || ''
      ).trim().slice(0, 6),

      verticalRate: n(
        raw.baro_rate
      ),

      seenPos: seen,

      military:
        (
          Number(
            raw.dbFlags || 0
          ) & 1
        ) === 1,

      emergency: String(
        raw.emergency || ''
      ).trim().slice(0, 32)

    };

    plane.distress = isEmergency(
      plane
    );

    return plane;

  }

  /* ==========================================================
     05 - MODULE HEALTH
     ========================================================== */

  function status() {

    const old =

      S.lastGood &&

      Date.now() -
        S.lastGood.getTime() >
        STALE_MS;

    let label;
    let kind;

    if (!S.lastGood) {

      label = S.pending
        ? 'SCANNING'
        : 'OFFLINE';

      kind = S.pending
        ? 'standby'
        : 'error';

    } else if (
      old ||
      S.error
    ) {

      label = 'STALE';
      kind = 'stale';

    } else {

      label = 'ONLINE';
      kind = 'online';

    }

    set(
      'aviation-status',
      label
    );

    set(
      'ww-air-status',
      label
    );

    const indicator =
      $('ww-air-status');

    if (indicator) {

      indicator.style.color =

        kind === 'online'

          ? COLORS.green

          : kind === 'error'

            ? COLORS.red

            : COLORS.amber;

    }

    window.WorldWatch?.reportModuleStatus(

      'aviation',

      kind,

      S.error

    );

  }

  /* ==========================================================
     06 - STYLES
     ========================================================== */

  function installStyles() {

    if (
      $('ww-aviation-style')
    ) {
      return;
    }

    const style = el(
      'style'
    );

    style.id =
      'ww-aviation-style';

    style.textContent = `

      #aviation-panel .ww-air-root {
        font: 11px/1.45 Consolas,
          'Courier New', monospace;
        color: #c5dccb;
        min-width: 0;
      }

      #aviation-panel .ww-air-head {
        font-weight: bold;
        color: #e8bf62;
        margin: 5px 0;
      }

      #aviation-panel .ww-air-metrics {
        display: grid;
        grid-template-columns:
          repeat(3, minmax(0,1fr));
        gap: 4px;
        margin: 6px 0;
      }

      #aviation-panel .ww-air-metric {
        padding: 5px;
        background: #081a0f;
        border: 1px solid #315b3e;
        min-width: 0;
      }

      #aviation-panel .ww-air-metric small {
        display: block;
        color: #8da895;
        font-size: 9px;
      }

      #aviation-panel .ww-air-metric strong {
        color: #73db94;
        font-size: 13px;
        overflow-wrap: anywhere;
      }

      #aviation-panel .ww-air-line {
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
        align-items: center;
        margin: 5px 0;
      }

      #aviation-panel .ww-air-button,
      #aviation-panel .ww-air-select,
      #aviation-panel .ww-air-input {
        border: 1px solid #315b3e;
        background: #07160d;
        color: #c5dccb;
        padding: 5px;
        font: 10px Consolas, monospace;
        max-width: 100%;
        min-width: 0;
      }

      #aviation-panel .ww-air-button {
        cursor: pointer;
        color: #73db94;
        white-space: nowrap;
      }

      #aviation-panel .ww-air-button:hover,
      #aviation-panel .ww-air-button.active {
        color: #a0ffb9;
        border-color: #73db94;
        background: #173523;
      }

      #aviation-panel .ww-air-select {
        flex: 1 1 110px;
      }

      #aviation-panel .ww-air-input {
        width: 100%;
        box-sizing: border-box;
      }

      #aviation-panel .ww-air-note {
        color: #8da895;
        font-size: 10px;
        margin: 5px 0;
        overflow-wrap: anywhere;
      }

      #aviation-panel .ww-air-list {
        margin-top: 6px;
      }

      #aviation-panel .ww-air-entry {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
        padding: 5px 0;
        border-bottom: 1px dashed #315b3e;
      }

      #aviation-panel .ww-air-entry.selected {
        background: #173523;
      }

      #aviation-panel .ww-air-name {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
      }

      #aviation-panel .ww-air-name strong {
        color: #a0ffb9;
      }

      #aviation-panel .ww-air-sub {
        color: #8da895;
        font-size: 9px;
      }

      #aviation-panel .ww-air-alert {
        color: #e84949 !important;
      }

      #aviation-panel .ww-air-links {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
      }

      #aviation-panel .ww-air-links a {
        color: #73db94;
        font-size: 10px;
      }

      #aviation-panel .ww-air-diagnostic {
        border-top: 1px solid #315b3e;
        padding-top: 6px;
        margin-top: 8px;
        font-size: 9px;
        color: #8da895;
        overflow-wrap: anywhere;
      }

    `;

    document.head.appendChild(
      style
    );

  }

  /* ==========================================================
     07 - UI HELPERS
     ========================================================== */

  function button(
    label,
    handler,
    extraClass = ''
  ) {

    const b = el(

      'button',

      'ww-air-button ' + extraClass,

      label

    );

    b.type = 'button';

    b.addEventListener(
      'click',
      handler
    );

    return b;

  }

  function paintFilters(host) {

    const types = [
      'all',
      'mil',
      'emergency',
      'high'
    ];

    host.querySelectorAll(
      'button'
    ).forEach((b, index) => {

      b.classList.toggle(

        'active',

        types[index] === S.filter

      );

    });

  }

  /* ==========================================================
     08 - BUILD AVIATION PANEL
     ========================================================== */

  function createUI() {

    installStyles();

    const host =
      $('aviation-panel')
        ?.querySelector(
          '.panel-content'
        );

    if (!host) {
      return;
    }

    host.replaceChildren();

    const root = el(
      'div',
      'ww-air-root'
    );

    root.append(

      el(
        'div',
        'ww-air-head',
        'AIRSPACE// ADS-B SURVEILLANCE'
      )

    );

    const top = el(
      'div',
      'ww-air-line'
    );

    top.append(
      el('strong', '', 'STATUS// ')
    );

    const state = el(
      'strong',
      '',
      'STANDBY'
    );

    state.id = 'ww-air-status';

    top.append(state);
    root.append(top);

    /* Counters */

    const metrics = el(
      'div',
      'ww-air-metrics'
    );

    for (
      const [id, label] of [

        [
          'ww-air-count',
          'TRACKED'
        ],

        [
          'ww-air-mil',
          'MIL TAG'
        ],

        [
          'ww-air-emergency',
          'EMERGENCY'
        ]

      ]
    ) {

      const metric = el(
        'div',
        'ww-air-metric'
      );

      metric.append(
        el('small', '', label)
      );

      const value = el(
        'strong',
        '',
        '--'
      );

      value.id = id;

      metric.append(value);

      metrics.append(metric);

    }

    root.append(metrics);

    /* Scan area */

    root.append(

      el(
        'div',
        'ww-air-head',
        'SCAN// AREA OF INTEREST'
      )

    );

    const scan = el(
      'div',
      'ww-air-line'
    );

    const area = el(
      'select',
      'ww-air-select'
    );

    area.id = 'ww-air-area';

    area.setAttribute(
      'aria-label',
      'Surveillance region'
    );

    for (
      const [key, preset] of
      Object.entries(PRESETS)
    ) {

      const option = el(
        'option',
        '',
        preset.label
      );

      option.value = key;

      area.append(option);

    }

    const mapOption = el(
      'option',
      '',
      'CURRENT MAP CENTER'
    );

    mapOption.value = 'map';

    area.append(mapOption);

    area.value = 'nwfl';

    scan.append(area);

    /* Scan radius */

    const radius = el(
      'select',
      'ww-air-select'
    );

    radius.id = 'ww-air-radius';

    radius.setAttribute(
      'aria-label',
      'Scan radius'
    );

    for (
      const value of [
        50, 100, 150, 250
      ]
    ) {

      const option = el(
        'option',
        '',
        value + ' NM'
      );

      option.value = value;

      radius.append(option);

    }

    radius.value = '150';

    scan.append(radius);
    root.append(scan);

    /* Controls */

    const actions = el(
      'div',
      'ww-air-line'
    );

    actions.append(

      button(
        '[ SCAN ]',
        () => void refresh(true)
      ),

      button(
        '[ VIEW ZONE ]',
        viewZone
      )

    );

    root.append(actions);

    const metadata = el(
      'div',
      'ww-air-note',
      'Awaiting network connection...'
    );

    metadata.id = 'ww-air-meta';

    root.append(metadata);

    /* Filtering */

    root.append(

      el(
        'div',
        'ww-air-head',
        'TRACKS// FILTER'
      )

    );

    const filters = el(
      'div',
      'ww-air-line'
    );

    for (
      const [key, label] of [

        ['all', 'ALL'],

        ['mil', 'MIL TAGGED'],

        ['emergency', 'EMERGENCY'],

        ['high', 'HIGH ALT']

      ]
    ) {

      filters.append(

        button(

          '[' + label + ']',

          () => {

            S.filter = key;

            paintFilters(filters);

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

    /* Search */

    const search = el(
      'input',
      'ww-air-input'
    );

    search.id = 'ww-air-search';

    search.type = 'search';

    search.placeholder =
      'FLIGHT / REG / TYPE / HEX';

    search.setAttribute(
      'aria-label',
      'Search aircraft'
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

    /* Aircraft list */

    const list = el(
      'div',
      'ww-air-list'
    );

    list.id = 'ww-air-list';

    root.append(list);

    /* Diagnostics */

    root.append(

      el(
        'div',
        'ww-air-head',
        'SOURCE// DIAGNOSTICS'
      )

    );

    const diagnostics = el(
      'div',
      'ww-air-diagnostic',
      'Connecting...'
    );

    diagnostics.id = 'ww-air-diag';

    root.append(diagnostics);

    /* External links remain new-tab */

    const links = el(
      'div',
      'ww-air-links'
    );

    for (
      const [label, url] of [

        [
          '[ ADSB.LOL ]',
          'https://globe.adsb.lol/'
        ],

        [
          '[ AIRPLANES.LIVE ]',
          'https://globe.airplanes.live/'
        ],

        [
          '[ SOURCE DOCS ]',
          'https://api.adsb.lol/docs'
        ]

      ]
    ) {

      const a = el(
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

    host.append(root);

    /* Enable existing AIRCRAFT map checkbox */

    const layer =
      $('layer-aviation');

    if (layer) {

      layer.disabled = false;
      layer.checked = true;

      layer.addEventListener(
        'change',
        syncLayer
      );

    }

  }

  /* ==========================================================
     09 - FILTER AND SORT AIRCRAFT
     ========================================================== */

  function visiblePlanes() {

    const matches =
      S.planes.filter(plane => {

        if (!fresh(plane)) {
          return false;
        }

        if (
          S.filter === 'mil' &&
          !plane.military
        ) {
          return false;
        }

        if (
          S.filter === 'emergency' &&
          !plane.distress
        ) {
          return false;
        }

        if (
          S.filter === 'high' &&
          (
            plane.altitude === null ||
            plane.altitude < 30000
          )
        ) {
          return false;
        }

        if (
          S.search &&
          ![
            plane.callsign,
            plane.registration,
            plane.aircraftType,
            plane.hex
          ].join(' ')
            .toLowerCase()
            .includes(S.search)
        ) {
          return false;
        }

        return true;

      });

    matches.sort(

      (a, b) =>

        Number(b.distress) -
        Number(a.distress) ||

        Number(b.military) -
        Number(a.military) ||

        (
          (b.altitude ?? -1) -
          (a.altitude ?? -1)
        )

    );

    return matches;

  }

  /* ==========================================================
     10 - COUNTERS / DIAGNOSTICS
     ========================================================== */

  function updateReadout() {

    const current =
      S.planes.filter(fresh);

    set(
      'ww-air-count',
      current.length
    );

    set(
      'ww-air-mil',
      current.filter(
        x => x.military
      ).length
    );

    set(
      'ww-air-emergency',
      current.filter(
        x => x.distress
      ).length
    );

    const ago = S.lastGood

      ? Math.round(

          (
            Date.now() -
            S.lastGood.getTime()
          ) / 1000

        )

      : null;

    set(

      'ww-air-meta',

      `ZONE// ${S.center.label} | ` +

      `${S.radius} NM | ` +

      `SOURCE// ${S.provider || 'NONE'} | ` +

      `UPDATED// ${utc(S.lastGood)}` +

      (
        ago !== null

          ? ` (${ago}s AGO)`

          : ''
      )

    );

    const attribution =

      S.provider === 'ADSB.LOL'

        ? 'ADSB.LOL CONTRIBUTORS (ODbL)'

        : 'PUBLIC ADS-B COMMUNITY DATA';

    set(

      'ww-air-diag',

      `PLOTTABLE// ${current.length} | ` +

      `SOURCE REPORTS// ${S.total} | ` +

      `POSITION AGE LIMIT// ${AGE_LIMIT}s | ` +

      (
        S.error

          ? `ISSUE// ${S.error}`

          : `SOURCE// ${S.provider || 'PENDING'}`
      ) +

      ` | ${attribution} | ` +

      'COVERAGE IS INCOMPLETE.'

    );

    status();

  }

  /* ==========================================================
     11 - AIRCRAFT LIST
     ========================================================== */

  function drawList() {

    const list =
      $('ww-air-list');

    if (!list) {
      return;
    }

    list.replaceChildren();

    const matches =
      visiblePlanes();

    list.append(

      el(

        'div',

        'ww-air-note',

        `FILTERED// ${matches.length} | ` +

        `SHOWING// ${Math.min(matches.length, 60)} | ` +

        'CLICK [ LOCATE ]'

      )

    );

    for (
      const plane of matches.slice(0, 60)
    ) {

      const row = el(

        'div',

        'ww-air-entry' +
        (
          S.selected === plane.hex

            ? ' selected'

            : ''
        )

      );

      const left = el(
        'div',
        'ww-air-name'
      );

      const name = el(

        'strong',

        plane.distress
          ? 'ww-air-alert'
          : '',

        plane.callsign ||
        plane.registration ||
        plane.hex

      );

      left.append(name);

      const extras = [];

      if (
        plane.registration &&
        plane.registration !== plane.callsign
      ) {

        extras.push(
          plane.registration
        );

      }

      if (plane.aircraftType) {

        extras.push(
          plane.aircraftType
        );

      }

      if (plane.military) {

        extras.push(
          'MIL TAG'
        );

      }

      if (plane.distress) {

        extras.push(

          'ALERT ' +

          (
            plane.squawk ||
            plane.emergency
          )

        );

      }

      left.append(

        el(

          'div',

          'ww-air-sub',

          extras.join(' // ') ||
          'ICAO ' + plane.hex

        )

      );

      const altitude =

        plane.ground

          ? 'GROUND'

          : plane.altitude !== null

            ? plane.altitude.toLocaleString(
                'en-US'
              ) + ' FT'

            : 'ALT --';

      const speed =

        plane.speed !== null

          ? plane.speed.toFixed(0) + ' KT'

          : 'SPD --';

      left.append(

        el(

          'div',

          'ww-air-sub',

          altitude +

          ' | ' +

          speed +

          ' | ' +

          Math.round(
            age(plane)
          ) + 's OLD'

        )

      );

      row.append(

        left,

        button(

          '[ LOCATE ]',

          () => locate(plane.hex)

        )

      );

      list.append(row);

    }

    if (!matches.length) {

      list.append(

        el(

          'div',

          'ww-air-note',

          S.error

            ? 'DATA UNAVAILABLE OR STALE. CHECK SOURCE DIAGNOSTICS.'

            : 'NO AIRCRAFT MATCH CURRENT FILTER OR POSITION AGE LIMIT.'

        )

      );

    }

  }

  /* ==========================================================
     12 - AIRCRAFT DETAIL POPUP
     ========================================================== */

  function detail(plane) {

    const outer = el(
      'div'
    );

    outer.append(

      el(

        'strong',

        '',

        plane.callsign ||
        plane.registration ||
        plane.hex

      )

    );

    for (
      const [label, value] of [

        [
          'ICAO HEX',
          plane.hex
        ],

        [
          'REGISTRATION',
          plane.registration || '--'
        ],

        [
          'TYPE',
          plane.aircraftType || '--'
        ],

        [
          'POSITION',
          plane.lat.toFixed(4) +
          ', ' +
          plane.lon.toFixed(4)
        ],

        [
          'ALTITUDE',

          plane.ground

            ? 'GROUND'

            : plane.altitude === null

              ? '--'

              : plane.altitude.toLocaleString(
                  'en-US'
                ) + ' FT'
        ],

        [
          'GROUND SPEED',

          plane.speed === null

            ? '--'

            : plane.speed.toFixed(0) + ' KT'
        ],

        [
          'COURSE',

          plane.heading === null

            ? '--'

            : plane.heading.toFixed(0) + '°'
        ],

        [
          'VERT RATE',

          plane.verticalRate === null

            ? '--'

            : plane.verticalRate + ' FT/MIN'
        ],

        [
          'SQUAWK',
          plane.squawk || '--'
        ],

        [
          'SOURCE AGE',
          Math.round(age(plane)) + 's'
        ],

        [
          'MIL TAG',

          plane.military

            ? 'SOURCE TAGGED'

            : 'NOT TAGGED'
        ],

        [
          'EMERGENCY',

          plane.distress

            ? 'FLAGGED'

            : 'NONE REPORTED'
        ]

      ]
    ) {

      outer.append(

        el(

          'div',

          '',

          label + '// ' + value

        )

      );

    }

    outer.append(

      el(

        'div',

        '',

        'SOURCE// ' + S.provider

      )

    );

    return outer;

  }

  /* ==========================================================
     13 - MAP LAYER CONTROLS
     ========================================================== */

  function syncLayer() {

    if (
      !S.map ||
      !S.layer
    ) {
      return;
    }

    const on = Boolean(
      $('layer-aviation')?.checked
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

    set(

      'map-active-layers',

      document.querySelectorAll(
        '[data-map-layer]:checked'
      ).length

    );

  }

  /* ==========================================================
     14 - DRAW AIRCRAFT ON GLOBAL MAP
     ========================================================== */

  function drawMap() {

    if (
      !S.map ||
      !S.layer ||
      !window.L
    ) {
      return;
    }

    S.layer.clearLayers();

    /* Surveillance radius */

    L.circle(

      [
        S.center.lat,
        S.center.lon
      ],

      {

        radius:
          S.radius * 1852,

        color: COLORS.blue,

        weight: 1,

        opacity: 0.55,

        fill: false,

        dashArray: '5 7',

        interactive: false

      }

    ).addTo(
      S.layer
    );

    /* Aircraft position markers */

    const aircraft =
      visiblePlanes()
        .slice(0, MAX_MARKERS);

    for (
      const plane of aircraft
    ) {

      const color =

        plane.distress

          ? COLORS.red

          : plane.military

            ? COLORS.amber

            : COLORS.green;

      L.circleMarker(

        [
          plane.lat,
          plane.lon
        ],

        {

          radius:
            plane.hex === S.selected
              ? 8
              : 5,

          weight:
            plane.hex === S.selected
              ? 3
              : 1.5,

          color,

          fillColor: color,

          fillOpacity: 0.7

        }

      )

        .bindPopup(
          detail(plane)
        )

        .addTo(
          S.layer
        );

    }

    syncLayer();

  }

  /* ==========================================================
     15 - MAP CONTROLS
     ========================================================== */

  function viewZone() {

    if (!S.map) {

      window.WorldWatch?.notify(

        'AIR// MAP NOT READY',

        'warning'

      );

      return;

    }

    if (
      $('layer-aviation')
    ) {

      $('layer-aviation').checked = true;

    }

    syncLayer();

    S.map.flyTo(

      [
        S.center.lat,
        S.center.lon
      ],

      S.radius > 180
        ? 6
        : 7,

      {
        duration: 0.8
      }

    );

    drawMap();

  }

  function locate(hex) {

    const plane =
      S.planes.find(

        x =>
          x.hex === hex &&
          fresh(x)

      );

    if (
      !plane ||
      !S.map
    ) {

      window.WorldWatch?.notify(

        'AIR// CURRENT POSITION UNAVAILABLE',

        'warning'

      );

      return;

    }

    S.selected =
      plane.hex;

    if (
      $('layer-aviation')
    ) {

      $('layer-aviation').checked = true;

    }

    drawMap();

    drawList();

    S.map.flyTo(

      [
        plane.lat,
        plane.lon
      ],

      9,

      {
        duration: 0.8
      }

    );

    L.popup()

      .setLatLng(
        [
          plane.lat,
          plane.lon
        ]
      )

      .setContent(
        detail(plane)
      )

      .openOn(
        S.map
      );

  }

  /* ==========================================================
     16 - NETWORK FETCH
     ========================================================== */

  async function getJSON(url) {

    const controller =
      new AbortController();

    const timer = setTimeout(

      () => controller.abort(),

      13000

    );

    try {

      const response =
        await fetch(

          url,

          {

            signal:
              controller.signal,

            cache:
              'no-store'

          }

        );

      if (!response.ok) {

        const error = Error(
          'HTTP ' + response.status
        );

        error.status =
          response.status;

        throw error;

      }

      const data =
        await response.json();

      if (
        !data ||
        !Array.isArray(data.ac)
      ) {

        throw Error(
          'UNEXPECTED AIRCRAFT PAYLOAD'
        );

      }

      return data;

    } finally {

      clearTimeout(timer);

    }

  }

  /* ==========================================================
     17 - GET SELECTED SURVEILLANCE ZONE
     ========================================================== */

  function requestedZone() {

    const area =
      $('ww-air-area')?.value ||
      'nwfl';

    const selectedRadius =
      Number(
        $('ww-air-radius')?.value ||
        150
      );

    const radius =

      [
        50,
        100,
        150,
        250
      ].includes(
        selectedRadius
      )

        ? selectedRadius

        : 150;

    if (
      area === 'map'
    ) {

      const center =
        S.map?.getCenter();

      if (
        center &&
        coords(
          center.lat,
          center.lng
        )
      ) {

        return {

          center: {

            label:
              'MAP CENTER',

            lat:
              center.lat,

            lon:
              center.lng

          },

          radius

        };

      }

      throw Error(
        'MAP CENTER UNAVAILABLE'
      );

    }

    return {

      center: {

        ...(
          PRESETS[area] ||
          PRESETS.nwfl
        )

      },

      radius

    };

  }

  /* ==========================================================
     18 - REFRESH AIRCRAFT DATA

     Try ADSB.lol first.
     Fall back to Airplanes.live on network errors.

     Respect rate limits.
     Do not route around a 403 or 429.
     ========================================================== */

  async function refresh(
    manual = false
  ) {

    if (S.pending) {
      return S.pending;
    }

    const now =
      Date.now();

    if (
      now < S.blockedUntil
    ) {

      S.error =

        'RATE-LIMIT COOLDOWN UNTIL ' +

        utc(
          new Date(
            S.blockedUntil
          )
        );

      updateReadout();

      return;

    }

    const remaining =

      MIN_MS -
      (
        now -
        S.lastAttempt
      );

    if (
      remaining > 0
    ) {

      if (
        manual
      ) {

        window.WorldWatch?.notify(

          'AIR// NEXT SCAN IN ' +

          Math.ceil(
            remaining / 1000
          ) + 's',

          'warning'

        );

      }

      return;

    }

    let zone;

    try {

      zone =
        requestedZone();

    } catch (error) {

      S.error =
        error.message;

      updateReadout();

      return;

    }

    const changed =

      S.center.lat !== zone.center.lat ||

      S.center.lon !== zone.center.lon ||

      S.radius !== zone.radius;

    S.center =
      zone.center;

    S.radius =
      zone.radius;

    /* Never display aircraft from another scan area. */

    if (changed) {

      S.planes = [];

      S.total = 0;

      S.lastGood = null;

      S.provider = '';

      S.selected = null;

    }

    S.lastAttempt = now;

    S.error = '';

    set(
      'aviation-status',
      'SCANNING'
    );

    set(
      'ww-air-status',
      'SCANNING'
    );

    S.pending = (
      async () => {

        const errors = [];

        const lat =
          S.center.lat.toFixed(4);

        const lon =
          S.center.lon.toFixed(4);

        for (
          const provider of PROVIDERS
        ) {

          try {

            const url =

              provider.base +

              lat + '/' +

              lon + '/' +

              S.radius;

            const response =
              await getJSON(url);

            const records =
              new Map();

            for (
              const raw of response.ac
            ) {

              const plane =
                toPlane(raw);

              if (plane) {

                records.set(
                  plane.hex,
                  plane
                );

              }

            }

            S.planes = [
              ...records.values()
            ];

            S.total =
              response.ac.length;

            S.provider =
              provider.name;

            S.lastGood =
              new Date();

            S.error = '';

            if (
              !S.planes.some(
                p => p.hex === S.selected
              )
            ) {

              S.selected = null;

            }

            drawMap();

            return;

          } catch (error) {

            const message =

              error.name === 'AbortError'

                ? 'TIMEOUT'

                : error instanceof TypeError

                  ? 'NETWORK / CORS BLOCK'

                  : error.message;

            errors.push(

              provider.name +

              ' ' +

              message

            );

            if (

              error.status === 429 ||

              error.status === 403

            ) {

              S.blockedUntil =

                Date.now() +

                5 * 60000;

              break;

            }

          }

        }

        /* All attempted providers failed. */

        S.error =

          errors.join(' | ');

        if (
          S.lastGood
        ) {

          S.error +=

            ' | SHOWING LAST SUCCESSFUL DATA';

        }

        drawMap();

      }
    )();

    try {

      await S.pending;

    } finally {

      S.pending = null;

      updateReadout();

      drawList();

    }

  }

  /* ==========================================================
     19 - INSTALL MAP HOOK

     Must run before map.js creates Leaflet map.
     ========================================================== */

  function installMapHook() {

    if (
      !window.L?.Map
    ) {
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

        S.layer =
          L.layerGroup();

        syncLayer();

        drawMap();

        console.log(

          '[WORLDWATCH][AIR] ' +

          'Aircraft overlay connected'

        );

      }

    );

  }

  /* ==========================================================
     20 - MODULE INITIALIZATION
     ========================================================== */

  function start() {

    if (
      S.started ||
      !window.WorldWatch
    ) {
      return;
    }

    S.started = true;

    createUI();

    installMapHook();

    WorldWatch.registerModule(

      'aviation',

      {
        refresh
      }

    );

    document.addEventListener(

      'worldwatch:layers-changed',

      syncLayer

    );

    /* Automatic scan approximately every 90 seconds. */

    setInterval(

      () => {

        if (document.hidden) {
          return;
        }

        void refresh();

        /* Expire old position markers. */

        if (

          S.lastGood &&

          Date.now() -
            S.lastGood.getTime() >
            STALE_MS

        ) {

          updateReadout();

          drawList();

          drawMap();

        }

      },

      AUTO_MS

    );

    /* Refresh after returning to the dashboard. */

    document.addEventListener(

      'visibilitychange',

      () => {

        if (
          !document.hidden
        ) {

          void refresh();

        }

      }

    );

    void refresh();

    console.log(

      '[WORLDWATCH][AIR] ' +

      'Aviation monitor initialized'

    );

  }

  /* ==========================================================
     21 - START

     Runs while deferred scripts are processed,
     before map.js initializes Leaflet.
     ========================================================== */

  start();

})();
