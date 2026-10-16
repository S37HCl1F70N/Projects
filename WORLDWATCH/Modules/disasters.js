
/* ============================================================
   WORLDWATCH v1.0 // DISASTER GLOBAL EMERGENCY MONITOR

   SOURCE A: NASA EONET v3 natural-event records
   SOURCE B: GDACS disaster-event map reports

   MAP:
   Attached to existing Leaflet map via initialization hook.

   No API key.
   No changes to map.js or script.js.

   IMPORTANT:
   EONET records are not emergency warnings.
   ============================================================ */

'use strict';

(() => {

  /* ==========================================================
     01 - CONFIGURATION
     ========================================================== */

  const SOURCES = {

    eonet:
      'https://eonet.gsfc.nasa.gov/api/v3/events' +
      '?status=open&days=45&limit=250',

    gdacs:
      'https://www.gdacs.org/gdacsapi/api/events/' +
      'geteventlist/MAP?eventtypes=FL%2CWF%2CVO%2CDR'

  };

  const COLORS = {

    fire: '#f28c52',

    flood: '#70b7d5',

    volcano: '#e84949',

    landslide: '#e8bf62',

    drought: '#d4ac67',

    storm: '#9cb7ff',

    other: '#73db94'

  };

  const S = {

    initialized: false,

    map: null,

    fires: null,

    hazards: null,

    eonet: [],

    gdacs: [],

    items: [],

    filter: 'all',

    lastSuccess: null,

    request: null,

    sourceStatus: {
      eonet: 'PENDING',
      gdacs: 'PENDING'
    }

  };

  /* ==========================================================
     02 - UTILITIES
     ========================================================== */

  const $ = id => document.getElementById(id);

  function text(id, value) {

    const el = $(id);

    if (el) {
      el.textContent = String(value);
    }

  }

  function timestamp(date) {

    return date
      ? date.toISOString()
          .slice(0, 16)
          .replace('T', ' ') + 'Z'
      : 'UNKNOWN';

  }

  function dateOf(value) {

    if (
      value == null ||
      value === ''
    ) {
      return null;
    }

    const valueDate = new Date(value);

    return Number.isFinite(valueDate.getTime())
      ? valueDate
      : null;

  }

  function clean(value) {

    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);

  }

  function safeUrl(value, source) {

    try {

      const u = new URL(value);

      if (u.protocol !== 'https:') {
        return null;
      }

      const expected =
        source === 'NASA EONET'
          ? 'eonet.gsfc.nasa.gov'
          : 'gdacs.org';

      if (
        u.hostname === expected ||
        u.hostname.endsWith('.' + expected)
      ) {
        return u.href;
      }

    } catch (_) {}

    return null;

  }

  function escapeHtml(value) {

    return String(value ?? '').replace(
      /[&<>"']/g,
      c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[c])
    );

  }

  async function fetchJSON(url) {

    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      16000
    );

    try {

      const response = await fetch(
        url,
        {
          signal: controller.signal,
          cache: 'no-store'
        }
      );

      if (!response.ok) {
        throw Error(
          'HTTP ' + response.status
        );
      }

      const data = await response.json();

      if (data?.error) {
        throw Error('API ERROR');
      }

      return data;

    } finally {

      clearTimeout(timer);

    }

  }

  /* ==========================================================
     03 - HAZARD CLASSIFICATION

     Colors represent hazard types, except GDACS
     red/orange alert markers, which reflect the
     source's explicit alert classifications.
     ========================================================== */

  function classify(category) {

    const c = String(
      category || ''
    ).toLowerCase();

    if (
      c.includes('wildfire') ||
      c === 'wf'
    ) {
      return 'fire';
    }

    if (
      c.includes('flood') ||
      c === 'fl'
    ) {
      return 'flood';
    }

    if (
      c.includes('volcan') ||
      c === 'vo'
    ) {
      return 'volcano';
    }

    if (c.includes('landslide')) {
      return 'landslide';
    }

    if (
      c.includes('drought') ||
      c === 'dr'
    ) {
      return 'drought';
    }

    if (c.includes('storm')) {
      return 'storm';
    }

    return 'other';

  }

  /* ==========================================================
     04 - GEOGRAPHIC POSITION EXTRACTION

     NASA may provide Point or Polygon locations.

     For polygons, the bounding-box center is used
     as an APPROXIMATE locator, not the precise
     hazard position or extent.
     ========================================================== */

  function centerOfGeometry(geometry) {

    if (
      !geometry ||
      !geometry.coordinates
    ) {
      return null;
    }

    if (geometry.type === 'Point') {

      const c = geometry.coordinates;

      const lon = Number(c?.[0]);

      const lat = Number(c?.[1]);

      return (
        Number.isFinite(lon) &&
        Number.isFinite(lat) &&
        Math.abs(lon) <= 180 &&
        Math.abs(lat) <= 90
      )
        ? {
            lat,
            lon,
            approximate: false
          }
        : null;

    }

    let minLat = Infinity;

    let maxLat = -Infinity;

    let minLon = Infinity;

    let maxLon = -Infinity;

    function walk(node) {

      if (!Array.isArray(node)) {
        return;
      }

      if (
        node.length >= 2 &&
        typeof node[0] === 'number' &&
        typeof node[1] === 'number'
      ) {

        const lon = node[0];

        const lat = node[1];

        if (
          Math.abs(lat) <= 90 &&
          Math.abs(lon) <= 180
        ) {

          minLat = Math.min(
            minLat,
            lat
          );

          maxLat = Math.max(
            maxLat,
            lat
          );

          minLon = Math.min(
            minLon,
            lon
          );

          maxLon = Math.max(
            maxLon,
            lon
          );

        }

      } else {

        node.forEach(walk);

      }

    }

    walk(geometry.coordinates);

    if (!Number.isFinite(minLat)) {
      return null;
    }

    return {

      lat: (minLat + maxLat) / 2,

      lon: (minLon + maxLon) / 2,

      approximate: true

    };

  }

  /* ==========================================================
     05 - NASA EONET PARSER
     ========================================================== */

  function parseEONET(data) {

    if (!Array.isArray(data?.events)) {

      throw Error(
        'Invalid EONET event format'
      );

    }

    const result = [];

    for (const event of data.events) {

      const category =
        event.categories?.[0]?.id ||
        'other';

      const kind = classify(category);

      /* Other modules already cover these. */

      if (
        category === 'earthquakes' ||
        category === 'severeStorms'
      ) {
        continue;
      }

      const observations =
        Array.isArray(event.geometry)
          ? event.geometry
          : [];

      const latest = [
        ...observations
      ].sort(
        (a, b) =>

          (
            dateOf(b.date)?.getTime() ||
            0
          ) -

          (
            dateOf(a.date)?.getTime() ||
            0
          )
      )[0];

      const point =
        centerOfGeometry(latest);

      if (!point) {
        continue;
      }

      result.push({

        id:
          'EONET-' +
          clean(event.id),

        source:
          'NASA EONET',

        title:
          clean(
            event.title ||
            'Unnamed natural event'
          ),

        kind,

        lat: point.lat,

        lon: point.lon,

        approximate:
          point.approximate,

        date:
          dateOf(latest?.date),

        alert: null,

        url:
          safeUrl(
            event.link,
            'NASA EONET'
          ) ||
          'https://eonet.gsfc.nasa.gov/',

        detail:
          'OPEN EVENT RECORD ' +
          '(NOT AN OFFICIAL WARNING)'

      });

    }

    return result;

  }

  /* ==========================================================
     06 - GDACS DISASTER PARSER
     ========================================================== */

  function parseGDACS(data) {

    const features =
      Array.isArray(data?.features)
        ? data.features
        : Array.isArray(data)
          ? data
          : null;

    if (!features) {

      throw Error(
        'Invalid GDACS GeoJSON'
      );

    }

    const result = [];

    const seen = new Set();

    for (const feature of features) {

      const p =
        feature.properties || {};

      const type = clean(
        p.eventtype ||
        p.eventType ||
        ''
      ).toUpperCase();

      if (
        ![
          'FL',
          'WF',
          'VO',
          'DR'
        ].includes(type)
      ) {
        continue;
      }

      const key =
        type + '-' +
        clean(
          p.eventid ||
          feature.id ||
          p.eventname ||
          ''
        );

      if (seen.has(key)) {
        continue;
      }

      const point =
        centerOfGeometry(
          feature.geometry
        );

      if (!point) {
        continue;
      }

      const date = dateOf(

        p.datemodified ||

        p.todate ||

        p.fromdate ||

        p.date

      );

      /* Avoid presenting archived GDACS events
         as current reports. */

      if (
        !date ||
        Date.now() - date.getTime() >
          30 * 86400000 ||
        date.getTime() >
          Date.now() + 86400000
      ) {
        continue;
      }

      const alert = clean(
        p.alertlevel ||
        p.alertLevel ||
        'UNSPECIFIED'
      ).toUpperCase();

      const id = String(
        p.eventid || ''
      ).trim();

      const link =
        /^\d+$/.test(id)
          ? 'https://www.gdacs.org/report.aspx' +
            '?eventtype=' + type +
            '&eventid=' + id
          : 'https://www.gdacs.org/';

      result.push({

        id:
          'GDACS-' + key,

        source:
          'GDACS',

        title: clean(

          p.eventname ||

          p.name ||

          type + ' disaster report'

        ),

        kind: classify(type),

        lat: point.lat,

        lon: point.lon,

        approximate:
          point.approximate,

        date,

        alert,

        url: link,

        detail:
          'GDACS EVENT / ALERT REPORT'

      });

      seen.add(key);

    }

    return result;

  }

  /* ==========================================================
     07 - MAP POPUP DETAILS
     ========================================================== */

  function drawPopup(item) {

    const color =
      COLORS[item.kind] ||
      COLORS.other;

    return (

      '<div class="ww-quake-popup">' +

        '<strong style="color:' +
          color +
        '">' +

          'DISASTER// ' +
          escapeHtml(
            item.kind.toUpperCase()
          ) +

        '</strong>' +

        '<p>' +
          escapeHtml(item.title) +
        '</p>' +

        '<div>SOURCE// ' +
          escapeHtml(item.source) +
        '</div>' +

        '<div>POSITION// ' +

          item.lat.toFixed(3) +

          ', ' +

          item.lon.toFixed(3) +

          (
            item.approximate
              ? ' (APPROXIMATE)'
              : ''
          ) +

        '</div>' +

        '<div>OBSERVED/UPDATED// ' +
          timestamp(item.date) +
        '</div>' +

        (
          item.alert
            ? '<div>GDACS ALERT// ' +
              escapeHtml(item.alert) +
              '</div>'
            : ''
        ) +

        '<div>' +
          escapeHtml(item.detail) +
        '</div>' +

        '<p>' +

          '<a href="' +
            escapeHtml(item.url) +
          '" target="_blank" ' +
          'rel="noopener noreferrer">' +

            '[ SOURCE REPORT ]' +

          '</a>' +

        '</p>' +

      '</div>'

    );

  }

  /* ==========================================================
     08 - MAP LAYER MANAGEMENT
     ========================================================== */

  function groupEnabled(id) {

    return Boolean(
      $(id)?.checked
    );

  }

  function syncMapLayers() {

    if (!S.map) {
      return;
    }

    const groups = [

      [
        S.fires,
        groupEnabled('layer-fires')
      ],

      [
        S.hazards,
        groupEnabled('layer-disasters')
      ]

    ];

    for (const [layer, show] of groups) {

      if (!layer) {
        continue;
      }

      if (
        show &&
        !S.map.hasLayer(layer)
      ) {

        S.map.addLayer(layer);

      }

      if (
        !show &&
        S.map.hasLayer(layer)
      ) {

        S.map.removeLayer(layer);

      }

    }

    const counter =
      $('map-active-layers');

    if (counter) {

      counter.textContent =
        document.querySelectorAll(
          '[data-map-layer]:checked'
        ).length;

    }

  }

  /* ==========================================================
     09 - DRAW DISASTER MAP MARKERS
     ========================================================== */

  function renderMap() {

    if (
      !S.map ||
      !S.fires ||
      !S.hazards
    ) {
      return;
    }

    S.fires.clearLayers();

    S.hazards.clearLayers();

    for (const item of S.items) {

      let color =
        COLORS[item.kind] ||
        COLORS.other;

      if (
        item.source === 'GDACS' &&
        item.alert === 'RED'
      ) {

        color = '#e84949';

      } else if (
        item.source === 'GDACS' &&
        item.alert === 'ORANGE'
      ) {

        color = '#f28c52';

      }

      const marker = L.circleMarker(
        [item.lat, item.lon],
        {

          radius:
            item.source === 'GDACS'
              ? 9
              : 6,

          color,

          fillColor: color,

          fillOpacity: 0.35,

          weight:
            item.source === 'GDACS'
              ? 2
              : 1.5

        }
      );

      marker.bindTooltip(
        'DISASTER// ' + item.title
      );

      marker.bindPopup(
        drawPopup(item),
        {
          maxWidth: 320
        }
      );

      const target =
        item.kind === 'fire'
          ? S.fires
          : S.hazards;

      marker.addTo(target);

    }

    syncMapLayers();

  }

  /* ==========================================================
     10 - LOCATE EVENT
     ========================================================== */

  function locate(item) {

    if (!S.map) {

      window.open(
        item.url,
        '_blank',
        'noopener,noreferrer'
      );

      return;

    }

    const id =
      item.kind === 'fire'
        ? 'layer-fires'
        : 'layer-disasters';

    const checkbox = $(id);

    if (checkbox) {
      checkbox.checked = true;
    }

    syncMapLayers();

    S.map.flyTo(
      [item.lat, item.lon],

      Math.max(
        5,
        S.map.getZoom()
      ),

      {
        duration: 0.65
      }
    );

    L.popup({
      maxWidth: 320
    })

      .setLatLng(
        [item.lat, item.lon]
      )

      .setContent(
        drawPopup(item)
      )

      .openOn(S.map);

  }

  /* ==========================================================
     11 - DISASTER SIDEBAR
     ========================================================== */

  function renderFeed() {

    const feed =
      $('disaster-feed');

    if (!feed) {
      return;
    }

    feed.replaceChildren();

    const selected = S.items.filter(
      item => {

        if (S.filter === 'all') {
          return true;
        }

        if (S.filter === 'other') {

          return ![
            'fire',
            'flood',
            'volcano'
          ].includes(item.kind);

        }

        return item.kind === S.filter;

      }
    );

    text(
      'disaster-count',
      selected.length
    );

    text(
      'disaster-updated',

      S.lastSuccess
        ? timestamp(S.lastSuccess)
        : '--'
    );

    if (!selected.length) {

      const empty =
        document.createElement('p');

      empty.className =
        'waiting-message';

      empty.textContent =
        'No matching reports in returned feeds. ' +
        'This does not mean no hazards exist.';

      feed.append(empty);

      return;

    }

    for (
      const item of selected.slice(0, 30)
    ) {

      const row =
        document.createElement('div');

      row.className =
        'event-item';

      const heading =
        document.createElement('div');

      heading.className =
        'event-title';

      heading.style.color =
        COLORS[item.kind] ||
        COLORS.other;

      heading.textContent =
        item.kind.toUpperCase() +
        '// ' +
        item.title;

      const meta =
        document.createElement('div');

      meta.className =
        'event-meta';

      meta.textContent =
        item.source +
        ' // ' +
        timestamp(item.date) +

        (
          item.alert
            ? ' // ' + item.alert
            : ''
        );

      const button =
        document.createElement('button');

      button.className =
        'quake-locate-button';

      button.type = 'button';

      button.textContent =
        '[ LOCATE ]';

      button.addEventListener(
        'click',
        () => locate(item)
      );

      row.append(
        heading,
        meta,
        button
      );

      feed.append(row);

    }

    if (selected.length > 30) {

      const more =
        document.createElement('p');

      more.className =
        'event-meta';

      more.textContent =
        'DISPLAY// 30 OF ' +
        selected.length +
        ' MATCHING REPORTS';

      feed.append(more);

    }

  }

  /* ==========================================================
     12 - COMBINE NASA AND GDACS RESULTS
     ========================================================== */

  function mergeData() {

    /*
      Keep both agency records.

      NASA and GDACS may describe the same
      occurrence using different classifications
      and observation timestamps.
    */

    S.items = [
      ...S.gdacs,
      ...S.eonet
    ].sort(
      (a, b) =>

        (
          b.date?.getTime() ||
          0
        ) -

        (
          a.date?.getTime() ||
          0
        )
    );

    renderFeed();

    renderMap();

  }

  /* ==========================================================
     13 - REFRESH DISASTER FEEDS
     ========================================================== */

  async function refresh() {

    if (S.request) {
      return S.request;
    }

    S.request = (async () => {

      text(
        'disaster-status',
        'UPDATING'
      );

      const [
        eonet,
        gdacs
      ] = await Promise.allSettled([

        fetchJSON(
          SOURCES.eonet
        ),

        fetchJSON(
          SOURCES.gdacs
        )

      ]);

      const faults = [];

      let successes = 0;

      /* NASA RESULT */

      if (
        eonet.status === 'fulfilled'
      ) {

        try {

          S.eonet = parseEONET(
            eonet.value
          );

          S.sourceStatus.eonet =
            'ONLINE';

          successes++;

        } catch (error) {

          faults.push(
            'NASA: ' + error.message
          );

          S.sourceStatus.eonet =
            'ERROR';

        }

      } else {

        S.sourceStatus.eonet =
          'ERROR';

        faults.push(

          'NASA: ' +

          (
            eonet.reason?.message ||
            'FETCH FAILED'
          )

        );

      }

      /* GDACS RESULT */

      if (
        gdacs.status === 'fulfilled'
      ) {

        try {

          S.gdacs = parseGDACS(
            gdacs.value
          );

          S.sourceStatus.gdacs =
            'ONLINE';

          successes++;

        } catch (error) {

          faults.push(
            'GDACS: ' + error.message
          );

          S.sourceStatus.gdacs =
            'ERROR';

        }

      } else {

        S.sourceStatus.gdacs =
          'ERROR';

        faults.push(

          'GDACS: ' +

          (
            gdacs.reason?.message ||
            'FETCH FAILED'
          )

        );

      }

      text(

        'disaster-source-status',

        'NASA// ' +
        S.sourceStatus.eonet +

        ' | GDACS// ' +
        S.sourceStatus.gdacs

      );

      if (successes) {

        S.lastSuccess =
          new Date();

        mergeData();

        text(

          'disaster-status',

          faults.length
            ? 'PARTIAL'
            : 'ONLINE'

        );

        WorldWatch.reportModuleStatus(

          'disasters',

          'online',

          faults.join(' | ')

        );

        text(

          'disaster-diagnostic',

          faults.length
            ? faults.join(' | ')
            : 'LIVE SOURCES// REPORTING. ' +
              'NO AUTOMATIC WARNING INFERENCE.'

        );

      } else {

        text(

          'disaster-status',

          S.lastSuccess
            ? 'STALE'
            : 'OFFLINE'

        );

        text(

          'disaster-diagnostic',

          faults.join(' | ')

        );

        WorldWatch.reportModuleStatus(

          'disasters',

          S.lastSuccess
            ? 'stale'
            : 'error',

          faults.join(' | ')

        );

        if (!S.lastSuccess) {

          const feed =
            $('disaster-feed');

          if (feed) {

            feed.textContent =
              'OFFLINE// NASA AND GDACS ' +
              'UNAVAILABLE. CHECK NETWORK / F12.';

          }

        }

      }

      if (faults.length) {

        console.warn(

          '[WORLDWATCH][DISASTER]',

          faults.join(' | ')

        );

      }

    })();

    try {

      await S.request;

    } finally {

      S.request = null;

    }

  }

  /* ==========================================================
     14 - INSTALL DISASTER CONTROLS
     ========================================================== */

  function setupControls() {

    /* Enable existing FIRES map toggle */

    const fire =
      $('layer-fires');

    if (fire) {

      fire.disabled = false;

      fire.checked = true;

      fire.addEventListener(
        'change',
        syncMapLayers
      );

    }

    /* Add DISASTERS toggle */

    const controls =
      document.querySelector(
        '.map-layer-controls'
      );

    if (
      controls &&
      !$('layer-disasters')
    ) {

      const label =
        document.createElement('label');

      label.className =
        'layer-toggle';

      const input =
        document.createElement('input');

      input.type = 'checkbox';

      input.id =
        'layer-disasters';

      input.dataset.mapLayer =
        'disasters';

      input.checked = true;

      input.addEventListener(
        'change',
        syncMapLayers
      );

      const title =
        document.createElement('span');

      title.textContent =
        'DISASTERS';

      label.append(
        input,
        title
      );

      controls.append(
        label
      );

    }

    /* Event count in header */

    const heading =
      document.querySelector(
        '#disaster-monitor .event-category-header'
      );

    if (
      heading &&
      !$('disaster-count')
    ) {

      const counter =
        document.createElement('span');

      counter.className =
        'event-meta';

      counter.innerHTML =
        'EVENTS// ' +
        '<span id="disaster-count">0</span>';

      heading.append(
        counter
      );

    }

    /* Category filters */

    const panel =
      $('disaster-monitor');

    if (
      panel &&
      !$('disaster-controls')
    ) {

      const toolbar =
        document.createElement('div');

      toolbar.id =
        'disaster-controls';

      toolbar.className =
        'panel-toolbar';

      toolbar.style.cssText =
        'display:flex;' +
        'flex-wrap:wrap;' +
        'gap:3px;' +
        'padding:6px';

      const selections = [

        ['all', 'ALL'],

        ['fire', 'FIRES'],

        ['flood', 'FLOODS'],

        ['volcano', 'VOLCANO'],

        ['other', 'OTHER']

      ];

      for (
        const [key, label] of selections
      ) {

        const btn =
          document.createElement('button');

        btn.className =
          'filter-button' +
          (
            key === 'all'
              ? ' active'
              : ''
          );

        btn.type = 'button';

        btn.textContent =
          label;

        btn.dataset.disasterFilter =
          key;

        btn.addEventListener(
          'click',
          () => {

            S.filter = key;

            for (
              const other of
              toolbar.querySelectorAll(
                'button[data-disaster-filter]'
              )
            ) {

              other.classList.toggle(

                'active',

                other.dataset.disasterFilter ===
                  key

              );

            }

            renderFeed();

          }
        );

        toolbar.append(
          btn
        );

      }

      heading.after(
        toolbar
      );

      /* Source diagnostics */

      const status =
        document.createElement('div');

      status.style.cssText =
        'padding:6px 10px;' +
        'font-size:10px;' +
        'line-height:1.6;' +
        'color:#8da895;' +
        'overflow-wrap:anywhere';

      status.innerHTML = `

        <div id="disaster-source-status">
          NASA// PENDING | GDACS// PENDING
        </div>

        <div id="disaster-diagnostic">
          DATA// INITIALIZING
        </div>

        <div>
          SYNC//
          <span id="disaster-updated">--</span>
        </div>

        <a href="https://eonet.gsfc.nasa.gov/"
           target="_blank"
           rel="noopener noreferrer">
          [ NASA EONET ]
        </a>

        &nbsp;

        <a href="https://www.gdacs.org/"
           target="_blank"
           rel="noopener noreferrer">
          [ GDACS ]
        </a>

      `;

      panel.append(
        status
      );

    }

  }

  /* ==========================================================
     15 - CONNECT TO EXISTING LEAFLET MAP

     IMPORTANT:
     This module must load BEFORE modules/map.js.

     The hook captures the map at creation time,
     avoiding changes to the functioning map.js.
     ========================================================== */

  function installMapHook() {

    if (
      !window.L ||
      !L.Map
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

        S.fires =
          L.layerGroup();

        S.hazards =
          L.layerGroup();

        syncMapLayers();

        renderMap();

        console.log(
          '[WORLDWATCH][DISASTER] ' +
          'Connected to tactical map.'
        );

      }
    );

  }

  /* ==========================================================
     16 - INITIALIZATION
     ========================================================== */

  function initialize() {

    if (
      S.initialized ||
      !window.WorldWatch
    ) {
      return;
    }

    S.initialized = true;

    setupControls();

    installMapHook();

    document.addEventListener(

      'worldwatch:layers-changed',

      syncMapLayers

    );

    WorldWatch.registerModule(

      'disasters',

      {
        refresh
      }

    );

    void refresh();

    console.log(
      '[WORLDWATCH][DISASTER] ' +
      'Global emergency module initialized.'
    );

  }

  /* ==========================================================
     17 - START

     Deferred scripts execute in document order.

     Initialize immediately so the Leaflet hook
     exists before map.js constructs the map.
     ========================================================== */

  initialize();

})();
