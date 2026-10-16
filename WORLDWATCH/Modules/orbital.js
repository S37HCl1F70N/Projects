
/* ============================================================
   WORLDWATCH v1.0 // SPACE / ORBITAL OPERATIONS

   LIVE ISS:
     Where The ISS At API

   ORBITAL ELEMENTS:
     CelesTrak TLE data

   ORBITAL CALCULATIONS:
     satellite.js 4.1.3 (SGP4)

   MAP:
     Attaches to existing Leaflet tactical map

   No API keys.
   All times UTC.

   FILE:
     modules/orbital.js
   ============================================================ */

'use strict';

(() => {

  /* ==========================================================
     01 - CONFIGURATION
     ========================================================== */

  const ISS_API =
    'https://api.wheretheiss.at/v1/satellites/25544';

  const CELESTRAK =
    'https://celestrak.org/NORAD/elements/gp.php?GROUP=';

  const CACHE_MS =
    2 * 60 * 60 * 1000;

  const LIVE_MS =
    60 * 1000;

  const FRESH_MS =
    3 * 60 * 1000;

  const GROUPS = {

    stations: 'STATIONS',

    amateur: 'AMATEUR',

    weather: 'WEATHER'

  };

  const C = {

    green: '#73db94',

    amber: '#e8bf62',

    blue: '#70b7d5',

    muted: '#8da895',

    red: '#e84949'

  };

  /* ==========================================================
     02 - STATE
     ========================================================== */

  const S = {

    started: false,

    map: null,

    layer: null,

    selected: 25544,

    group: 'stations',

    catalog: {
      stations: [],
      amateur: [],
      weather: []
    },

    states: {
      stations: 'PENDING',
      amateur: 'PENDING',
      weather: 'PENDING'
    },

    iss: null,

    issError: '',

    catalogError: '',

    lastFix: null,

    catalogBusy: null,

    liveBusy: null,

    tick: null,

    liveTimer: null,

    wasLive: false,

    search: '',

    mapUpdate: 0

  };

  /* ==========================================================
     03 - DOM UTILITIES
     ========================================================== */

  const $ = id =>
    document.getElementById(id);

  function node(tag, cls, txt) {

    const e = document.createElement(tag);

    if (cls) {
      e.className = cls;
    }

    if (txt !== undefined) {
      e.textContent = String(txt);
    }

    return e;

  }

  function set(id, value) {

    if ($(id)) {
      $(id).textContent = String(value);
    }

  }

  function utc(date) {

    return date &&
      Number.isFinite(date.getTime())

      ? date.toISOString()
          .slice(0, 19)
          .replace('T', ' ') + 'Z'

      : '--';

  }

  function number(value) {

    const n = Number(value);

    return Number.isFinite(n)
      ? n
      : null;

  }

  function validGeo(lat, lon) {

    return lat !== null &&
      lon !== null &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180;

  }

  function errText(error) {

    if (error?.name === 'AbortError') {
      return 'TIMEOUT';
    }

    if (error instanceof TypeError) {
      return 'FETCH / CORS / NETWORK BLOCK';
    }

    return String(
      error?.message || error
    ).slice(0, 90);

  }

  /* ==========================================================
     04 - LOCAL CACHE HELPERS

     Storage is optional. Errors do not stop
     the rest of the module.
     ========================================================== */

  function safeStorageGet(key) {

    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }

  }

  function safeStorageSet(key, value) {

    try {
      localStorage.setItem(key, value);
    } catch (_) {}

  }

  /* ==========================================================
     05 - FETCH DATA
     ========================================================== */

  async function fetchText(url) {

    const ac = new AbortController();

    const timer = setTimeout(
      () => ac.abort(),
      12000
    );

    try {

      const r = await fetch(url, {

        signal: ac.signal,

        cache: 'no-store'

      });

      if (!r.ok) {
        throw Error(
          'HTTP ' + r.status
        );
      }

      return await r.text();

    } finally {

      clearTimeout(timer);

    }

  }

  async function fetchJSON(url) {

    const raw = await fetchText(url);

    try {
      return JSON.parse(raw);
    } catch (_) {
      throw Error('INVALID JSON');
    }

  }

  /* ==========================================================
     06 - PARSE CELESTRAK TLE CATALOG

     Legacy TLE format supports catalog numbers
     up to 99999. Newer 6-digit objects require
     future OMM/JSON support.
     ========================================================== */

  function parseTLE(raw, group) {

    const lines = String(raw)

      .split(/\r?\n/)

      .map(x => x.trim())

      .filter(Boolean);

    const entries = [];

    for (
      let i = 0;
      i < lines.length - 1;
      i++
    ) {

      if (
        !/^1\s+\d{5}/.test(lines[i]) ||
        !/^2\s+\d{5}/.test(lines[i + 1])
      ) {
        continue;
      }

      const id = Number(
        lines[i].slice(2, 7)
      );

      const name = (

        i > 0 &&
        !/^[12]\s+\d{5}/.test(lines[i - 1])

          ? lines[i - 1].replace(
              /^0\s*/,
              ''
            )

          : 'SAT ' + id

      ).trim();

      const first = lines[i];

      const second = lines[i + 1];

      let record = null;

      if (
        window.satellite?.twoline2satrec
      ) {

        try {

          record = satellite.twoline2satrec(
            first,
            second
          );

          if (record.error) {
            record = null;
          }

        } catch (_) {}

      }

      entries.push({

        id,

        name,

        group,

        first,

        second,

        record

      });

      i++;

    }

    if (!entries.length) {

      throw Error(
        'NO VALID TLE RECORDS'
      );

    }

    return entries;

  }

  function allEntries() {

    const byId = new Map();

    for (
      const key of Object.keys(GROUPS)
    ) {

      for (
        const item of S.catalog[key]
      ) {

        if (!byId.has(item.id)) {

          byId.set(
            item.id,
            item
          );

        }

      }

    }

    return byId;

  }

  function selectedEntry() {

    return allEntries().get(
      S.selected
    ) || null;

  }

  /* ==========================================================
     07 - ORBIT POSITION PROPAGATION

     Uses SGP4 and current TLE.
     Predicted position, NOT live satellite telemetry.
     ========================================================== */

  function positionAt(entry, date) {

    if (
      !entry ||
      !window.satellite?.propagate
    ) {
      return null;
    }

    try {

      if (!entry.record) {

        entry.record = satellite.twoline2satrec(
          entry.first,
          entry.second
        );

      }

      const pv = satellite.propagate(
        entry.record,
        date
      );

      if (
        !pv?.position ||
        !pv?.velocity
      ) {
        return null;
      }

      const gmst = satellite.gstime(
        date
      );

      const geo = satellite.eciToGeodetic(
        pv.position,
        gmst
      );

      const lat = satellite.degreesLat(
        geo.latitude
      );

      const lon = satellite.degreesLong(
        geo.longitude
      );

      if (
        !validGeo(lat, lon) ||
        !Number.isFinite(geo.height)
      ) {
        return null;
      }

      const v = pv.velocity;

      const speed = Math.hypot(
        v.x,
        v.y,
        v.z
      ) * 3600;

      return {

        lat,

        lon,

        altitude: geo.height,

        velocity: speed,

        date,

        source: 'SGP4 MODEL'

      };

    } catch (_) {

      return null;

    }

  }

  /* ==========================================================
     08 - SELECT CURRENT OBJECT POSITION

     Prefer fresh ISS API coordinates.
     Fall back to SGP4 where orbital elements exist.
     ========================================================== */

  function currentPosition() {

    const entry = selectedEntry();

    if (
      S.selected === 25544 &&
      S.iss &&
      Date.now() - S.iss.date.getTime() <
        FRESH_MS
    ) {

      return {

        ...S.iss,

        source: 'LIVE ISS API'

      };

    }

    return positionAt(
      entry,
      new Date()
    );

  }

  /* ==========================================================
     09 - FETCH LIVE ISS TELEMETRY
     ========================================================== */

  async function loadISS() {

    if (S.liveBusy) {
      return S.liveBusy;
    }

    S.liveBusy = (async () => {

      try {

        const d = await fetchJSON(
          ISS_API
        );

        const lat = number(
          d.latitude
        );

        const lon = number(
          d.longitude
        );

        const altitude = number(
          d.altitude
        );

        const velocity = number(
          d.velocity
        );

        const date = new Date(
          Number(d.timestamp) * 1000
        );

        if (
          !validGeo(lat, lon) ||
          altitude === null ||
          velocity === null ||
          !Number.isFinite(date.getTime()) ||
          Math.abs(
            Date.now() - date.getTime()
          ) > 15 * 60 * 1000
        ) {

          throw Error(
            'INVALID OR OLD ISS FIX'
          );

        }

        S.iss = {

          lat,

          lon,

          altitude,

          velocity,

          date,

          visibility: String(
            d.visibility || 'unknown'
          ),

          footprint: number(
            d.footprint
          )

        };

        S.lastFix = new Date();

        S.issError = '';

      } catch (e) {

        S.issError = errText(e);

        console.warn(
          '[WORLDWATCH][ORBITAL] ISS',
          S.issError
        );

      }

      render();

      updateMap(true);

      updateHealth();

    })();

    try {

      await S.liveBusy;

    } finally {

      S.liveBusy = null;

    }

  }

  /* ==========================================================
     10 - CACHED SATELLITE CATALOG
     ========================================================== */

  function cachedCatalog(group) {

    const raw = safeStorageGet(
      'WW_ORBITAL_TLE_' + group
    );

    if (!raw) {
      return null;
    }

    try {

      const c = JSON.parse(raw);

      if (
        !c?.time ||
        !c?.text
      ) {
        return null;
      }

      return c;

    } catch (_) {

      return null;

    }

  }

  async function loadGroup(group) {

    const c = cachedCatalog(
      group
    );

    if (
      c &&
      Date.now() - c.time < CACHE_MS
    ) {

      try {

        S.catalog[group] = parseTLE(
          c.text,
          group
        );

        S.states[group] = 'CACHED';

        return;

      } catch (_) {}

    }

    S.states[group] = 'FETCHING';

    render();

    try {

      const raw = await fetchText(

        CELESTRAK +
        GROUPS[group] +
        '&FORMAT=TLE'

      );

      const parsed = parseTLE(
        raw,
        group
      );

      S.catalog[group] = parsed;

      S.states[group] = 'ONLINE';

      safeStorageSet(

        'WW_ORBITAL_TLE_' + group,

        JSON.stringify({

          time: Date.now(),

          text: raw

        })

      );

    } catch (e) {

      S.states[group] = 'ERROR';

      if (
        c &&
        Date.now() - c.time <
          48 * 60 * 60 * 1000
      ) {

        try {

          S.catalog[group] = parseTLE(
            c.text,
            group
          );

          S.states[group] = 'STALE CACHE';

        } catch (_) {}

      }

      console.warn(
        '[WORLDWATCH][ORBITAL] CelesTrak',
        group,
        errText(e)
      );

    }

  }

  async function loadCatalog() {

    if (S.catalogBusy) {
      return S.catalogBusy;
    }

    S.catalogBusy = (async () => {

      /* Each group gets at least two hours
         between successful downloads. */

      for (
        const group of Object.keys(GROUPS)
      ) {

        await loadGroup(
          group
        );

      }

      render();

      updateMap(true);

      updateHealth();

    })();

    try {

      await S.catalogBusy;

    } finally {

      S.catalogBusy = null;

    }

  }

  /* ==========================================================
     11 - UI HELPERS
     ========================================================== */

  function makeButton(
    label,
    handler,
    extra = ''
  ) {

    const b = node(

      'button',

      'ww-orbit-button ' + extra,

      label

    );

    b.type = 'button';

    b.addEventListener(
      'click',
      handler
    );

    return b;

  }

  function metric(label, value) {

    const d = node(
      'div',
      'ww-orbit-metric'
    );

    d.append(

      node(
        'span',
        'ww-orbit-key',
        label
      ),

      node(
        'strong',
        '',
        value
      )

    );

    return d;

  }

  /* ==========================================================
     12 - INSTALL USER INTERFACE
     ========================================================== */

  function installUI() {

    const host = $('space-panel')
      ?.querySelector('.panel-content');

    if (!host) {
      return;
    }

    host.replaceChildren();

    host.append(

      node(

        'div',

        'ww-orbit-root',

        'INITIALIZING ORBITAL CONTROL ...'

      )

    );

    /* Create map layer checkbox. */

    const layers = document.querySelector(
      '.map-layer-controls'
    );

    if (
      layers &&
      !$('layer-orbital')
    ) {

      const label = node(
        'label',
        'layer-toggle'
      );

      const cb = document.createElement(
        'input'
      );

      cb.type = 'checkbox';

      cb.id = 'layer-orbital';

      cb.dataset.mapLayer = 'orbital';

      cb.checked = true;

      cb.addEventListener(
        'change',
        () => {

          syncLayer();

          updateMap(true);

          document.dispatchEvent(

            new CustomEvent(

              'worldwatch:layers-changed',

              {
                detail: {
                  layers: {}
                }
              }

            )

          );

        }
      );

      label.append(

        cb,

        node(
          'span',
          '',
          'ORBITAL'
        )

      );

      layers.append(label);

    }

    /* Retro terminal styling. */

    const style = document.createElement(
      'style'
    );

    style.id = 'ww-orbital-style';

    style.textContent = `

      #space-panel .ww-orbit-root {
        font: 11px/1.5 Consolas,'Courier New',monospace;
        color:#c5dccb;
        min-width:0;
      }

      #space-panel .ww-orbit-heading {
        font-weight:bold;
        color:#e8bf62;
        margin:8px 0 4px;
      }

      #space-panel .ww-orbit-large {
        font-size:14px;
        font-weight:bold;
        color:#73db94;
        margin:2px 0 6px;
      }

      #space-panel .ww-orbit-grid {
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:4px;
      }

      #space-panel .ww-orbit-metric {
        padding:4px;
        border:1px solid #315b3e;
        background:#081a0f;
        display:flex;
        flex-direction:column;
        overflow-wrap:anywhere;
      }

      #space-panel .ww-orbit-key {
        font-size:9px;
        color:#8da895;
      }

      #space-panel .ww-orbit-actions,
      #space-panel .ww-orbit-tabs {
        display:flex;
        flex-wrap:wrap;
        gap:4px;
        margin:7px 0;
      }

      #space-panel .ww-orbit-button {
        cursor:pointer;
        border:1px solid #315b3e;
        background:#0a190f;
        color:#73db94;
        padding:5px 6px;
        font:10px Consolas,monospace;
      }

      #space-panel .ww-orbit-button:hover,
      #space-panel .ww-orbit-button.active {
        background:#173523;
        border-color:#73db94;
      }

      #space-panel .ww-orbit-row {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:6px;
        border-bottom:1px dashed #315b3e;
        padding:5px 0;
      }

      #space-panel .ww-orbit-row-label {
        min-width:0;
        overflow-wrap:anywhere;
      }

      #space-panel .ww-orbit-note {
        font-size:9px;
        color:#8da895;
        margin:5px 0;
        overflow-wrap:anywhere;
      }

      #space-panel .ww-orbit-search {
        box-sizing:border-box;
        width:100%;
        padding:5px;
        background:#07140c;
        border:1px solid #315b3e;
        color:#c5dccb;
        font:11px Consolas,monospace;
      }

      #space-panel .ww-orbit-links {
        display:flex;
        flex-wrap:wrap;
        gap:7px;
        margin:7px 0;
      }

      #space-panel .ww-orbit-links a {
        color:#73db94;
        font-size:10px;
      }

    `;

    if (!$('ww-orbital-style')) {

      document.head.append(style);

    }

  }

  /* ==========================================================
     13 - MAP MARKER DETAILS
     ========================================================== */

  function htmlPoint(p) {

    const name = S.selected === 25544

      ? 'ISS / INTERNATIONAL SPACE STATION'

      : selectedEntry()?.name ||
        'SATELLITE';

    const wrap = node(
      'div',
      ''
    );

    wrap.append(

      node(
        'strong',
        '',
        name
      ),

      document.createElement('hr'),

      node(
        'div',
        '',
        `POSITION// ${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`
      ),

      node(
        'div',
        '',
        `SOURCE// ${p.source}`
      ),

      node(
        'div',
        '',
        `UTC// ${utc(p.date)}`
      )

    );

    return wrap;

  }

  /* ==========================================================
     14 - SPLIT GROUND TRACK AT DATE LINE

     Prevent long lines crossing the whole map
     where longitude wraps from +180 to -180.
     ========================================================== */

  function splitTrack(points) {

    const segments = [];

    let segment = [];

    for (
      const p of points
    ) {

      if (

        segment.length &&

        Math.abs(

          p.lon -
          segment[segment.length - 1][1]

        ) > 180

      ) {

        if (segment.length > 1) {
          segments.push(segment);
        }

        segment = [];

      }

      segment.push([
        p.lat,
        p.lon
      ]);

    }

    if (segment.length > 1) {
      segments.push(segment);
    }

    return segments;

  }

  /* ==========================================================
     15 - MAP LAYER VISIBILITY
     ========================================================== */

  function syncLayer() {

    if (
      !S.map ||
      !S.layer
    ) {
      return;
    }

    const checked = $('layer-orbital')
      ?.checked;

    if (
      checked &&
      !S.map.hasLayer(S.layer)
    ) {

      S.map.addLayer(
        S.layer
      );

    }

    if (
      !checked &&
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
     16 - DRAW SPACECRAFT AND PREDICTED TRACK

     Prediction window:
       35 minutes behind
       85 minutes ahead

     Approximation derived from current TLE.
     ========================================================== */

  function updateMap(force = false) {

    if (
      !S.map ||
      !S.layer ||
      !window.L
    ) {
      return;
    }

    if (
      !force &&
      Date.now() - S.mapUpdate < 9000
    ) {
      return;
    }

    S.mapUpdate = Date.now();

    S.layer.clearLayers();

    const p = currentPosition();

    if (!p) {
      return;
    }

    const entry = selectedEntry();

    if (
      entry &&
      window.satellite?.propagate
    ) {

      const now = Date.now();

      const positions = [];

      for (

        let minutes = -35;

        minutes <= 85;

        minutes += 3

      ) {

        const pt = positionAt(

          entry,

          new Date(
            now + minutes * 60000
          )

        );

        if (pt) {
          positions.push(pt);
        }

      }

      for (
        const section of splitTrack(
          positions
        )
      ) {

        L.polyline(
          section,
          {

            color: C.blue,

            weight: 2,

            dashArray: '7 6',

            opacity: 0.85

          }
        ).addTo(
          S.layer
        );

      }

    }

    /* Current position marker. */

    L.circleMarker(

      [
        p.lat,
        p.lon
      ],

      {

        radius: 9,

        color: C.amber,

        fillColor: C.green,

        fillOpacity: 0.75,

        weight: 2

      }

    )

      .bindPopup(
        htmlPoint(p)
      )

      .addTo(
        S.layer
      );

    syncLayer();

  }

  /* ==========================================================
     17 - LOCATE SELECTED SATELLITE
     ========================================================== */

  function focusSelected() {

    const p = currentPosition();

    if (
      !p ||
      !S.map
    ) {

      window.WorldWatch?.notify(

        'ORBITAL// POSITION UNAVAILABLE - CHECK SATELLITE.JS AND CELESTRAK',

        'warning'

      );

      return;

    }

    if ($('layer-orbital')) {

      $('layer-orbital').checked = true;

    }

    updateMap(true);

    syncLayer();

    S.map.flyTo(

      [p.lat, p.lon],

      4,

      {
        duration: 0.8
      }

    );

    L.popup()

      .setLatLng(
        [p.lat, p.lon]
      )

      .setContent(
        htmlPoint(p)
      )

      .openOn(S.map);

  }

  /* ==========================================================
     18 - RENDER ORBITAL OPERATIONS PANEL
     ========================================================== */

  function render() {

    const root = $('space-panel')
      ?.querySelector('.ww-orbit-root');

    if (!root) {
      return;
    }

    root.replaceChildren();

    root.append(

      node(

        'div',

        'ww-orbit-heading',

        'ISS// LIVE TELEMETRY'

      )

    );

    const live = S.iss &&
      Date.now() - S.iss.date.getTime() <
        FRESH_MS;

    const status = node(

      'div',

      'ww-orbit-large',

      live

        ? 'SIGNAL// LIVE POSITION'

        : 'SIGNAL// STALE OR OFFLINE'

    );

    status.style.color = live

      ? C.green

      : C.amber;

    root.append(status);

    const p = live

      ? {
          ...S.iss,
          source: 'LIVE ISS API'
        }

      : currentPosition();

    /* ISS metrics */

    const metrics = node(
      'div',
      'ww-orbit-grid'
    );

    metrics.append(

      metric(

        'LATITUDE',

        p
          ? p.lat.toFixed(3) + '°'
          : '--'

      ),

      metric(

        'LONGITUDE',

        p
          ? p.lon.toFixed(3) + '°'
          : '--'

      ),

      metric(

        'ALTITUDE',

        p && p.altitude !== null

          ? p.altitude.toFixed(0) + ' km'

          : '--'

      ),

      metric(

        'SPEED',

        p && p.velocity !== null

          ? (p.velocity / 1000).toFixed(1) +
            ' ×10³ km/h'

          : '--'

      )

    );

    root.append(metrics);

    root.append(

      node(

        'div',

        'ww-orbit-note',

        'POSITION// ' +
        (p ? p.source : 'UNAVAILABLE') +
        ' | TIME// ' +
        (p ? utc(p.date) : '--')

      )

    );

    if (live) {

      root.append(

        node(

          'div',

          'ww-orbit-note',

          'ISS LIGHTING// ' +
          S.iss.visibility.toUpperCase() +

          ' | ABOVE EARTH// ' +

          (
            S.iss.altitude * 0.621371
          ).toFixed(0) +

          ' mi'

        )

      );

    }

    /* Locate and refresh controls. */

    const actions = node(
      'div',
      'ww-orbit-actions'
    );

    actions.append(

      makeButton(

        '[ LOCATE ISS ]',

        () => {

          S.selected = 25544;

          focusSelected();

          render();

        }

      )

    );

    actions.append(

      makeButton(

        '[ LOCATE TRACKED ]',

        focusSelected

      )

    );

    actions.append(

      makeButton(

        '[ REFRESH ISS ]',

        () => void loadISS()

      )

    );

    root.append(actions);

    /* Satellite catalog */

    root.append(

      node(

        'div',

        'ww-orbit-heading',

        'SATCAT// TRACKABLE OBJECTS'

      )

    );

    root.append(

      node(

        'div',

        'ww-orbit-note',

        'SELECT A SOURCE GROUP, THEN [ TRACK ]. ' +
        'ORBIT PATHS ARE MODELLED FROM CELESTRAK TLE DATA.'

      )

    );

    /* Group buttons */

    const tabs = node(
      'div',
      'ww-orbit-tabs'
    );

    for (
      const group of Object.keys(GROUPS)
    ) {

      tabs.append(

        makeButton(

          '[' + GROUPS[group] + ']',

          () => {

            S.group = group;

            S.search = '';

            render();

          },

          group === S.group
            ? 'active'
            : ''

        )

      );

    }

    root.append(tabs);

    /* Search input */

    const filter = node(
      'input',
      'ww-orbit-search'
    );

    filter.type = 'search';

    filter.placeholder =
      'SEARCH NAME OR NORAD ID';

    filter.value = S.search;

    root.append(filter);

    const list = node(
      'div',
      ''
    );

    root.append(list);

    function drawList() {

      list.replaceChildren();

      const items =
        S.catalog[S.group] || [];

      const matches = items

        .filter(
          x =>

            !S.search ||

            x.name.toLowerCase().includes(
              S.search.toLowerCase()
            ) ||

            String(x.id).includes(
              S.search
            )
        )

        .slice(0, 25);

      list.append(

        node(

          'div',

          'ww-orbit-note',

          `${GROUPS[S.group]}// ${S.states[S.group]} | ` +
          `${items.length} RECORDS | DISPLAY ${matches.length}`

        )

      );

      for (
        const item of matches
      ) {

        const row = node(
          'div',
          'ww-orbit-row'
        );

        row.append(

          node(

            'span',

            'ww-orbit-row-label',

            item.name + ' // ' + item.id

          )

        );

        row.append(

          makeButton(

            item.id === S.selected

              ? '[ SELECTED ]'

              : '[ TRACK ]',

            () => {

              S.selected = item.id;

              updateMap(true);

              render();

              focusSelected();

            }

          )

        );

        list.append(row);

      }

      if (!matches.length) {

        list.append(

          node(

            'div',

            'ww-orbit-note',

            'NO MATCHES OR CATALOG NOT LOADED.'

          )

        );

      }

    }

    filter.addEventListener(
      'input',
      () => {

        S.search = filter.value;

        drawList();

      }
    );

    drawList();

    /* Source links */

    const links = node(
      'div',
      'ww-orbit-links'
    );

    for (
      const [label, url] of [

        [
          '[ ISS TRACKER ]',
          'https://spotthestation.nasa.gov/'
        ],

        [
          '[ CELESTRAK ]',
          'https://celestrak.org/NORAD/elements/'
        ],

        [
          '[ SATNOGS ]',
          'https://db.satnogs.org/'
        ],

        [
          '[ N2YO ]',
          'https://www.n2yo.com/'
        ]

      ]
    ) {

      const a = node(
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

    /* Source diagnostics */

    root.append(

      node(

        'div',

        'ww-orbit-note',

        'ISS SOURCE// ' +

        (
          S.issError || 'OK'
        ) +

        ' | SGP4// ' +

        (
          window.satellite?.propagate

            ? 'READY'

            : 'LIBRARY NOT LOADED'
        )

      )

    );

    root.append(

      node(

        'div',

        'ww-orbit-note',

        'TLE GROUPS REFRESH NO MORE THAN ONCE PER TWO HOURS. ' +
        'LAST ISS FIX// ' +
        utc(S.iss?.date)

      )

    );

  }

  /* ==========================================================
     19 - MODULE STATUS
     ========================================================== */

  function updateHealth() {

    const live = S.iss &&
      Date.now() - S.iss.date.getTime() <
        FRESH_MS;

    const cat = Object.values(
      S.catalog
    ).some(
      arr => arr.length > 0
    );

    const isPartial = Object.values(
      S.states
    ).some(
      x => x === 'ERROR' ||
           x === 'STALE CACHE'
    );

    const status = live

      ? (
          cat &&
          !isPartial &&
          !!window.satellite?.propagate

            ? 'ONLINE'

            : 'PARTIAL'
        )

      : (
          cat

            ? 'CATALOG ONLY'

            : 'OFFLINE'
        );

    set(
      'space-status',
      status
    );

    window.WorldWatch?.reportModuleStatus(

      'orbital',

      live

        ? 'online'

        : cat

          ? 'stale'

          : 'error',

      S.issError ||
      (
        !cat
          ? 'CATALOG NOT LOADED'
          : ''
      )

    );

  }

  /* ==========================================================
     20 - CONNECT TO LEAFLET

     Runs before map.js creates the tactical map.
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

        S.layer = L.layerGroup();

        syncLayer();

        updateMap(true);

        console.log(
          '[WORLDWATCH][ORBITAL] Map overlay registered'
        );

      }

    );

  }

  /* ==========================================================
     21 - REFRESH
     ========================================================== */

  async function refresh() {

    await Promise.allSettled([

      loadISS(),

      loadCatalog()

    ]);

  }

  /* ==========================================================
     22 - INITIALIZE MODULE
     ========================================================== */

  function initialize() {

    if (
      S.started ||
      !window.WorldWatch
    ) {
      return;
    }

    S.started = true;

    installUI();

    installMapHook();

    WorldWatch.registerModule(

      'orbital',

      {
        refresh
      }

    );

    /* Update orbital marker locally.
       Does not query the provider every 15s. */

    S.tick = setInterval(
      () => {

        if (!document.hidden) {

          updateMap();

          const live = !!(

            S.iss &&

            Date.now() -
              S.iss.date.getTime() <
              FRESH_MS

          );

          if (
            live !== S.wasLive
          ) {

            S.wasLive = live;

            render();

          }

          updateHealth();

        }

      },

      15000
    );

    /* Query current ISS position every minute. */

    S.liveTimer = setInterval(
      () => {

        if (!document.hidden) {

          void loadISS();

        }

      },

      LIVE_MS
    );

    /* Refresh position when returning to tab. */

    document.addEventListener(

      'visibilitychange',

      () => {

        if (!document.hidden) {

          void loadISS();

          updateMap(true);

        }

      }

    );

    document.addEventListener(

      'worldwatch:layers-changed',

      syncLayer

    );

    void refresh();

    console.log(

      '[WORLDWATCH][ORBITAL] ' +
      'Orbital operations initialized'

    );

  }

  /* ==========================================================
     23 - START

     Executed while deferred scripts are processed,
     before map.js initializes its Leaflet instance.
     ========================================================== */

  initialize();

})();
