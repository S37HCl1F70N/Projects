
/* ============================================================
   WORLDWATCH v1.0
   GEO// GLOBAL SITUATION DISPLAY

   MODULES:
   - CARTO DARK MATTER BASEMAP
   - USGS EARTHQUAKES
   - RAINVIEWER PRECIPITATION RADAR
   - NOAA/NHC HURRICANE TRACKING
   - GDACS GLOBAL CYCLONE REPORTS

   DESIGN: 1980s WARGAMES / NORAD
   ============================================================ */

'use strict';

(() => {

  /* ==========================================================
     01 - CONFIGURATION
     ========================================================== */

  const CARTO_KEY =
    'cb1_4ftm_1_8507b2947582a8563e6e67d5';

  const ENDPOINTS = {

    carto:
      'https://basemaps.cartocdn.com/' +
      'dark_all/{z}/{x}/{y}.png?key=' +
      encodeURIComponent(CARTO_KEY),

    quakes:
      'https://earthquake.usgs.gov/earthquakes/' +
      'feed/v1.0/summary/2.5_day.geojson',

    radar:
      'https://api.rainviewer.com/public/' +
      'weather-maps.json',

    nhc:
      'https://mapservices.weather.noaa.gov/' +
      'tropical/rest/services/tropical/' +
      'NHC_tropical_weather_summary/MapServer',

    gdacs:
      'https://www.gdacs.org/contentdata/xml/' +
      'gdacsTC.geojson'

  };

  const REGIONS = {

    global: [[20, 0], 2],
    americas: [[15, -85], 3],
    europe: [[52, 15], 4],
    'middle-east': [[29, 43], 4],
    'asia-pacific': [[10, 120], 3],
    africa: [[2, 20], 3]

  };

  const S = {

    map: null,

    quakeLayer: null,
    cycloneLayer: null,
    radarLayer: null,

    quakes: [],
    storms: [],
    nhcLines: [],
    nhcCones: [],

    lastQuakes: null,
    lastRadar: null,
    lastCyclones: null,

    working: {
      map: false,
      weather: false,
      cyclones: false
    },

    started: false

  };

  /* ==========================================================
     02 - UTILITIES
     ========================================================== */

  const $ = id => document.getElementById(id);

  function set(id, value) {

    const el = $(id);

    if (el) {
      el.textContent = String(value);
    }

  }

  function utc(value) {

    return new Date(value)
      .toISOString()
      .slice(11, 16) + 'Z';

  }

  function esc(value) {

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

  function number(value) {

    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {
      return null;
    }

    const n = Number(value);

    return Number.isFinite(n) ? n : null;

  }

  function position(c) {

    return Array.isArray(c) &&
      c.length >= 2 &&
      number(c[0]) !== null &&
      number(c[1]) !== null &&
      Math.abs(Number(c[0])) <= 180 &&
      Math.abs(Number(c[1])) <= 90;

  }

  function dateOf(value) {

    if (value == null || value === '') {
      return null;
    }

    const n = number(value);

    const d = new Date(
      n !== null
        ? (n < 1e11 ? n * 1000 : n)
        : value
    );

    return Number.isFinite(d.getTime()) ? d : null;

  }

  function verifiedLink(url, host) {

    try {

      const x = new URL(url);

      return (
        x.protocol === 'https:' &&
        (
          x.hostname === host ||
          x.hostname.endsWith('.' + host)
        )
      ) ? x.href : null;

    } catch (_) {

      return null;

    }

  }

  async function json(url, timeout = 18000) {

    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      timeout
    );

    try {

      const response = await fetch(url, {
        cache: 'no-store',
        signal: controller.signal
      });

      if (!response.ok) {
        throw Error('HTTP ' + response.status);
      }

      const data = await response.json();

      if (data?.error) {
        throw Error(
          String(
            data.error.message ||
            'Provider error'
          )
        );
      }

      return data;

    } finally {

      clearTimeout(timer);

    }

  }

  function report(name, status, reason = '') {

    WorldWatch.reportModuleStatus(
      name,
      status,
      reason
    );

    if (reason) {

      console.warn(
        '[WORLDWATCH][' + name + ']',
        reason
      );

    }

  }

  function checkLayers() {

    set(
      'map-active-layers',
      document.querySelectorAll(
        '[data-map-layer]:checked'
      ).length
    );

  }

  function enabled(id) {

    return Boolean($(id)?.checked);

  }

  /* ==========================================================
     03 - MAP COLOR CORRECTION

     The original stylesheet applies a green tint to
     the entire Leaflet tile pane.

     This section limits that tint to CARTO tiles.

     RainViewer radar retains its original colors.
     ========================================================== */

  function installTileStyle() {

    if ($('ww-map-tile-fix')) return;

    const style = document.createElement('style');

    style.id = 'ww-map-tile-fix';

    style.textContent = `

      .world-map .leaflet-tile-pane {
        filter: none !important;
      }

      .world-map img.ww-carto-tile {
        filter:
          grayscale(1)
          sepia(1)
          hue-rotate(65deg)
          saturate(1.35)
          brightness(0.85);
      }

    `;

    document.head.appendChild(style);

  }

  /* ==========================================================
     04 - WEATHER AND CYCLONE INTERFACE
     ========================================================== */

  function addUI() {

    const bar = document.querySelector(
      '.map-layer-controls'
    );

    /* Add CYCLONES checkbox */

    if (bar && !$('layer-cyclones')) {

      const label = document.createElement('label');

      label.className = 'layer-toggle';

      const checkbox = document.createElement('input');

      checkbox.type = 'checkbox';
      checkbox.id = 'layer-cyclones';
      checkbox.dataset.mapLayer = 'cyclones';
      checkbox.checked = true;

      const span = document.createElement('span');

      span.textContent = 'CYCLONES';

      label.append(checkbox, span);
      bar.append(label);

      checkbox.addEventListener(
        'change',
        () => {

          updateLayers();
          checkLayers();

        }
      );

    }

    /* Enable WEATHER checkbox */

    const weather = $('layer-weather');

    if (weather) {
      weather.disabled = false;
    }

    const host = document.querySelector(
      '#events-panel .event-sections'
    );

    if (!host) return;

    /* Weather panel */

    if (!$('weather-monitor')) {

      const article = document.createElement('article');

      article.id = 'weather-monitor';
      article.className = 'event-category';

      article.innerHTML = `

        <div class="event-category-header">

          <h3>METEO// WEATHER RADAR</h3>

          <span class="category-status"
                id="radar-status">
            STANDBY
          </span>

        </div>

        <div class="event-feed">

          <div class="event-title">
            PRECIPITATION// OBSERVED
          </div>

          <div class="event-meta">
            SOURCE// RAINVIEWER
          </div>

          <div class="event-meta">
            FRAME//
            <span id="radar-frame-time">
              --:--Z
            </span>
          </div>

          <div class="event-meta">
            LAYER//
            <span id="radar-display-status">
              DISABLED
            </span>
          </div>

          <div class="event-meta"
               id="radar-message">
          </div>

          <a class="external-monitor-link"
             href="https://www.rainviewer.com/"
             target="_blank"
             rel="noopener noreferrer">
            [ RADAR SOURCE ]
          </a>

        </div>

      `;

      host.insertBefore(
        article,
        $('spaceweather-monitor') || null
      );

    }

    /* Cyclone panel */

    if (!$('cyclone-monitor')) {

      const article = document.createElement('article');

      article.id = 'cyclone-monitor';
      article.className = 'event-category';

      article.innerHTML = `

        <div class="event-category-header">

          <h3>CYCLONE// HURRICANES &amp; TYPHOONS</h3>

          <span class="category-status"
                id="cyclone-status">
            STANDBY
          </span>

        </div>

        <div class="event-feed"
             id="cyclone-feed">
          Awaiting sources...
        </div>

        <div class="event-feed"
             style="border-top:1px solid #315b3e">

          <div class="event-meta"
               id="cyclone-diagnostic">

            NOAA// PENDING
            GDACS// PENDING

          </div>

          <a href="https://www.nhc.noaa.gov/"
             target="_blank"
             rel="noopener noreferrer">
            [ NHC ]
          </a>

          &nbsp;

          <a href="https://www.gdacs.org/"
             target="_blank"
             rel="noopener noreferrer">
            [ GDACS ]
          </a>

        </div>

      `;

      const weatherEl = $('weather-monitor');

      host.insertBefore(
        article,
        weatherEl
          ? weatherEl.nextSibling
          : null
      );

    }

    checkLayers();

  }

  /* ==========================================================
     05 - MAP LAYER MANAGEMENT
     ========================================================== */

  function updateLayers() {

    if (!S.map) return;

    const options = [

      [
        S.quakeLayer,
        enabled('layer-earthquakes')
      ],

      [
        S.radarLayer,
        enabled('layer-weather')
      ],

      [
        S.cycloneLayer,
        enabled('layer-cyclones')
      ]

    ];

    for (const [layer, on] of options) {

      if (!layer) continue;

      if (
        on &&
        !S.map.hasLayer(layer)
      ) {

        S.map.addLayer(layer);

      }

      if (
        !on &&
        S.map.hasLayer(layer)
      ) {

        S.map.removeLayer(layer);

      }

    }

    set(
      'radar-display-status',
      !enabled('layer-weather')
        ? 'DISABLED'
        : S.radarLayer
          ? 'ENABLED'
          : 'AWAITING DATA'
    );

  }

  function locate(lat, lon, popup, zoom = 5) {

    if (!S.map) return;

    S.map.flyTo(
      [lat, lon],
      Math.max(S.map.getZoom(), zoom),
      { duration: 0.7 }
    );

    L.popup({
      maxWidth: 340
    })
      .setLatLng([lat, lon])
      .setContent(popup)
      .openOn(S.map);

  }

  function eventCount() {

    const count =
      S.quakes.length + S.storms.length;

    set('map-event-count', count);
    set('event-count', count);

  }

  /* ==========================================================
     06 - USGS EARTHQUAKES
     ========================================================== */

  function quakeColor(m) {

    if (m >= 7) return '#e84949';
    if (m >= 6) return '#f28c52';
    if (m >= 5) return '#e8bf62';
    if (m >= 4) return '#b8d36b';

    return '#73db94';

  }

  function quakePopup(q) {

    const link = verifiedLink(
      q.url,
      'earthquake.usgs.gov'
    );

    return `

      <div class="ww-quake-popup">

        <strong style="color:${quakeColor(q.mag)}">
          SEISMIC// M${q.mag.toFixed(1)}
        </strong>

        <p>${esc(q.place)}</p>

        <div>
          LAT// ${q.lat.toFixed(3)}
          LON// ${q.lon.toFixed(3)}
        </div>

        <div>
          DEPTH// ${q.depth.toFixed(1)} KM
        </div>

        <div>
          UTC//
          ${new Date(q.time).toISOString().slice(0,19)}Z
        </div>

        ${
          link
            ? `<a href="${esc(link)}"
                  target="_blank"
                  rel="noopener noreferrer">
                  [ USGS REPORT ]
               </a>`
            : ''
        }

      </div>

    `;

  }

  function drawQuakes() {

    S.quakeLayer.clearLayers();

    for (const q of S.quakes) {

      L.circleMarker(
        [q.lat, q.lon],
        {

          radius: Math.max(
            4,
            Math.min(18, q.mag * 2.3)
          ),

          color: quakeColor(q.mag),

          weight: 1.5,

          fillColor: quakeColor(q.mag),

          fillOpacity: 0.42

        }
      )
        .bindPopup(quakePopup(q))
        .addTo(S.quakeLayer);

    }

    eventCount();

    const container = $('earthquake-feed');

    if (!container) return;

    container.replaceChildren();

    const sorted = [...S.quakes]
      .sort((a, b) => b.mag - a.mag)
      .slice(0, 8);

    for (const q of sorted) {

      const row = document.createElement('div');
      row.className = 'event-item';

      const title = document.createElement('div');
      title.className = 'event-title';
      title.style.color = quakeColor(q.mag);

      title.textContent =
        `M${q.mag.toFixed(1)} // ${q.place}`;

      const meta = document.createElement('div');
      meta.className = 'event-meta';

      meta.textContent =
        `${utc(q.time)} // ` +
        `DEPTH ${q.depth.toFixed(1)} KM`;

      const button = document.createElement('button');

      button.type = 'button';
      button.className = 'quake-locate-button';
      button.textContent = '[ LOCATE ]';

      button.addEventListener(
        'click',
        () => {

          const checkbox = $('layer-earthquakes');

          if (checkbox) {
            checkbox.checked = true;
          }

          updateLayers();
          checkLayers();

          locate(
            q.lat,
            q.lon,
            quakePopup(q),
            6
          );

        }
      );

      row.append(title, meta, button);
      container.appendChild(row);

    }

    if (!container.children.length) {

      container.textContent =
        'No M2.5+ reports in the USGS 24-hour feed.';

    }

  }

  async function refreshQuakes() {

    if (S.working.map) return;

    S.working.map = true;

    set('earthquake-status', 'UPDATING');

    try {

      const data = await json(
        ENDPOINTS.quakes
      );

      if (
        data?.type !== 'FeatureCollection' ||
        !Array.isArray(data.features)
      ) {

        throw Error(
          'USGS did not return GeoJSON'
        );

      }

      const next = [];

      for (const feature of data.features) {

        const c = feature.geometry?.coordinates;
        const p = feature.properties || {};

        if (
          !position(c) ||
          number(p.mag) === null ||
          number(p.time) === null
        ) {
          continue;
        }

        next.push({

          lon: Number(c[0]),
          lat: Number(c[1]),

          depth: number(c[2]) ?? 0,

          mag: Number(p.mag),

          time: Number(p.time),

          place: String(
            p.place || 'Unknown'
          ),

          url: p.url

        });

      }

      S.quakes = next;
      S.lastQuakes = new Date();

      drawQuakes();

      set(
        'map-updated',
        utc(S.lastQuakes)
      );

      set('earthquake-status', 'ONLINE');

      report('map', 'online');

    } catch (error) {

      const kind = S.lastQuakes
        ? 'stale'
        : 'error';

      set(
        'earthquake-status',
        kind.toUpperCase()
      );

      report(
        'map',
        kind,
        error.message
      );

      if (!S.lastQuakes) {

        set(
          'earthquake-feed',
          'OFFLINE// USGS unavailable.'
        );

      }

    } finally {

      S.working.map = false;

    }

  }

  /* ==========================================================
     07 - RAINVIEWER WEATHER RADAR

     FIX:
     Accepts current hexadecimal/hash radar frame paths.
     ========================================================== */

  async function refreshRadar() {

    if (S.working.weather) return;

    S.working.weather = true;

    set('radar-status', 'UPDATING');

    try {

      const data = await json(
        ENDPOINTS.radar
      );

      const frames = data?.radar?.past;

      if (
        !Array.isArray(frames) ||
        !frames.length
      ) {

        throw Error(
          'No radar observation frames'
        );

      }

      const frame = frames[
        frames.length - 1
      ];

      const host = new URL(data.host);

      if (
        host.protocol !== 'https:' ||
        !(
          host.hostname === 'rainviewer.com' ||
          host.hostname.endsWith('.rainviewer.com')
        )
      ) {

        throw Error(
          'Unrecognized radar tile host'
        );

      }

      /* Accept hexadecimal frame identifiers. */

      if (
        typeof frame.path !== 'string' ||
        !/^\/v2\/radar\/[a-f0-9]+$/i.test(
          frame.path
        )
      ) {

        throw Error(
          'Unknown radar frame format: ' +
          String(frame.path)
        );

      }

      const time = dateOf(
        number(frame.time)
      );

      if (!time) {

        throw Error(
          'Missing radar observation timestamp'
        );

      }

      const tileURL =
        host.origin +
        frame.path +
        '/256/{z}/{x}/{y}/2/1_1.png';

      const layer = L.tileLayer(
        tileURL,
        {

          tileSize: 256,

          opacity: 0.77,

          maxZoom: 12,

          maxNativeZoom: 7,

          pane: 'wwRadar',

          attribution:
            'Radar &copy; ' +
            '<a href="https://www.rainviewer.com/">' +
            'RainViewer</a>'

        }
      );

      /* Track repeated tile loading errors. */

      let errors = 0;

      layer.on(
        'tileerror',
        () => {

          errors++;

          if (
            errors === 3 &&
            S.radarLayer === layer &&
            enabled('layer-weather')
          ) {

            set(
              'radar-status',
              'TILE ERROR'
            );

            set(
              'radar-message',
              'Radar tile requests are failing. ' +
              'Check Console / Network.'
            );

            report(
              'weather',
              'stale',
              'Radar tile retrieval failed'
            );

          }

        }
      );

      const previous = S.radarLayer;

      S.radarLayer = layer;

      if (previous) {

        S.map.removeLayer(previous);

      }

      S.lastRadar = new Date();

      set(
        'radar-frame-time',
        utc(time)
      );

      set(
        'radar-message',
        'Latest observed precipitation; ' +
        'coverage varies by region.'
      );

      set('radar-status', 'ONLINE');

      updateLayers();

      report('weather', 'online');

    } catch (error) {

      const kind = S.lastRadar
        ? 'stale'
        : 'error';

      set(
        'radar-status',
        kind.toUpperCase()
      );

      set(
        'radar-message',
        'Radar feed: ' + error.message
      );

      report(
        'weather',
        kind,
        error.message
      );

    } finally {

      S.working.weather = false;

    }

  }

  /* ==========================================================
     08 - NOAA / NHC CYCLONE SERVICES
     ========================================================== */

  function nhcURL(id) {

    return ENDPOINTS.nhc +
      '/' + id +
      '/query?' +
      new URLSearchParams({

        where: '1=1',

        outFields: '*',

        returnGeometry: 'true',

        outSR: '4326',

        f: 'geojson'

      }).toString();

  }

  function collection(data, name) {

    if (
      data?.type !== 'FeatureCollection' ||
      !Array.isArray(data.features)
    ) {

      throw Error(
        name +
        ' returned an invalid FeatureCollection'
      );

    }

    return data.features;

  }

  function recent(p, days = 5) {

    const date = dateOf(
      p.idp_filedate ||
      p.idp_ingestdate
    );

    if (!date) return false;

    const age = Date.now() - date.getTime();

    return (
      age < days * 86400000 &&
      age > -86400000
    );

  }

  function stormKey(p) {

    const basin = String(
      p.basin || ''
    ).trim().toUpperCase();

    const no = number(p.stormnum);

    if (
      basin &&
      no !== null
    ) {

      return basin + '-' + no;

    }

    return String(
      p.stormname || ''
    ).trim().toUpperCase();

  }

  /* ==========================================================
     09 - NHC STORM CENTERS
     ========================================================== */

  function nhcStorms(features) {

    const grouped = new Map();

    for (const feature of features) {

      if (
        feature.geometry?.type !== 'Point' ||
        !position(
          feature.geometry.coordinates
        )
      ) {
        continue;
      }

      const p = feature.properties || {};

      if (!recent(p)) continue;

      const key = stormKey(p);

      if (!key) continue;

      const tau =
        number(p.tau) ??
        number(p.fcstprd) ??
        999;

      const old = grouped.get(key);

      if (
        old &&
        old.tau <= tau
      ) {
        continue;
      }

      grouped.set(key, {

        key,
        tau,

        name: String(
          p.stormname || key
        ),

        lat: Number(
          feature.geometry.coordinates[1]
        ),

        lon: Number(
          feature.geometry.coordinates[0]
        ),

        source: 'NOAA NHC',

        type: String(
          p.stormtype ||
          p.tcdvlp ||
          'Tropical cyclone'
        ),

        wind: number(p.maxwind),

        pressure: number(p.mslp),

        category: number(p.ssnum),

        advisory: String(
          p.advdate || ''
        ),

        time: dateOf(
          p.idp_filedate ||
          p.idp_ingestdate
        ),

        url:
          'https://www.nhc.noaa.gov/'

      });

    }

    return [...grouped.values()];

  }

  /* ==========================================================
     10 - GDACS GLOBAL CYCLONE EVENTS
     ========================================================== */

  function gdacsStorms(data) {

    const found = new Map();

    for (
      const feature of collection(
        data,
        'GDACS'
      )
    ) {

      if (
        feature.geometry?.type !== 'Point' ||
        !position(
          feature.geometry.coordinates
        )
      ) {
        continue;
      }

      const p = feature.properties || {};

      if (
        p.eventtype &&
        String(p.eventtype).toUpperCase() !== 'TC'
      ) {
        continue;
      }

      const time = dateOf(
        p.datemodified ||
        p.todate ||
        p.fromdate
      );

      if (
        !time ||
        Math.abs(
          Date.now() - time.getTime()
        ) > 12 * 86400000
      ) {
        continue;
      }

      const name = String(
        p.eventname ||
        p.name ||
        'Tropical Cyclone'
      );

      const id = String(
        p.eventid ??
        feature.id ??
        name
      );

      found.set(id, {

        name,

        key: 'GDACS-' + id,

        lat: Number(
          feature.geometry.coordinates[1]
        ),

        lon: Number(
          feature.geometry.coordinates[0]
        ),

        source: 'GDACS (recent event)',

        type:
          'Recent global cyclone report',

        wind: null,

        pressure: null,

        category: null,

        advisory: String(
          p.alertlevel || 'UNSPECIFIED'
        ),

        time,

        url:
          'https://www.gdacs.org/'

      });

    }

    return [...found.values()];

  }

  /* ==========================================================
     11 - CYCLONE COLORS AND DETAILS
     ========================================================== */

  function cycloneColor(storm) {

    if (
      storm.source.startsWith('GDACS')
    ) {
      return '#70b7d5';
    }

    if (
      storm.category !== null &&
      storm.category >= 3
    ) {
      return '#e84949';
    }

    if (
      storm.category !== null &&
      storm.category >= 1
    ) {
      return '#f28c52';
    }

    return '#e8bf62';

  }

  function stormPopup(storm) {

    const link = verifiedLink(

      storm.url,

      storm.source.startsWith('GDACS')
        ? 'gdacs.org'
        : 'nhc.noaa.gov'

    );

    const extra = storm.source.startsWith('GDACS')

      ? `
        <div>
          RECENT REPORT//
          NOT AN OFFICIAL FORECAST FIX
        </div>
      `

      : `
        <div>
          WIND//
          ${
            storm.wind === null
              ? 'NOT PROVIDED'
              : storm.wind + ' (NHC GIS)'
          }
        </div>

        <div>
          PRESSURE//
          ${
            storm.pressure === null
              ? 'NOT PROVIDED'
              : storm.pressure + ' hPa'
          }
        </div>

        <div>
          CATEGORY//
          ${
            storm.category === null
              ? 'NOT PROVIDED'
              : storm.category
          }
        </div>

        <div>
          FORECAST HOUR//
          ${storm.tau ?? '?'}
        </div>
      `;

    return `

      <div class="ww-quake-popup">

        <strong style="color:${cycloneColor(storm)}">
          CYCLONE// ${esc(storm.name)}
        </strong>

        <div>
          TYPE// ${esc(storm.type)}
        </div>

        <div>
          SOURCE// ${esc(storm.source)}
        </div>

        <div>
          POSITION//
          ${storm.lat.toFixed(2)},
          ${storm.lon.toFixed(2)}
        </div>

        ${extra}

        <div>
          UPDATED//
          ${
            storm.time
              ? utc(storm.time)
              : 'UNKNOWN'
          }
        </div>

        ${
          link
            ? `<a href="${esc(link)}"
                  target="_blank"
                  rel="noopener noreferrer">
                 [ SOURCE REPORT ]
               </a>`
            : ''
        }

      </div>

    `;

  }

  /* ==========================================================
     12 - DRAW CYCLONE TRACKS AND CONES

     FIX:
     Forecast tracks and cones are rendered
     independently of storm-center matching.
     ========================================================== */

  function drawCyclones() {

    S.cycloneLayer.clearLayers();

    /* Forecast cones */

    for (const feature of S.nhcCones) {

      L.geoJSON(
        feature,
        {

          pane: 'wwTracks',

          interactive: false,

          style: {

            color: '#e8bf62',

            weight: 1,

            opacity: 0.5,

            fillColor: '#e8bf62',

            fillOpacity: 0.09

          }

        }
      ).addTo(S.cycloneLayer);

    }

    /* Forecast tracks */

    for (const feature of S.nhcLines) {

      L.geoJSON(
        feature,
        {

          pane: 'wwTracks',

          interactive: false,

          style: {

            color: '#e8bf62',

            weight: 2.5,

            opacity: 0.95,

            dashArray: '8 5'

          }

        }
      ).addTo(S.cycloneLayer);

    }

    /* Storm position markers */

    for (const storm of S.storms) {

      L.circleMarker(
        [storm.lat, storm.lon],
        {

          radius: 10,

          color: cycloneColor(storm),

          weight: 2,

          fillColor: '#07120b',

          fillOpacity: 0.9

        }
      )

        .bindPopup(
          stormPopup(storm)
        )

        .bindTooltip(
          'CYCLONE// ' + storm.name
        )

        .addTo(S.cycloneLayer);

    }

    eventCount();

    renderCycloneSidebar();

  }

  /* ==========================================================
     13 - CYCLONE SIDEBAR
     ========================================================== */

  function renderCycloneSidebar() {

    const panel = $('cyclone-feed');

    if (!panel) return;

    panel.replaceChildren();

    const summary = document.createElement('div');

    summary.className = 'event-meta';

    summary.textContent =
      `NHC TRACKS// ${S.nhcLines.length}  ` +
      `CONES// ${S.nhcCones.length}`;

    panel.appendChild(summary);

    if (!S.storms.length) {

      const message = document.createElement('p');

      message.className = 'waiting-message';

      message.textContent =
        S.nhcLines.length
          ? 'NOAA forecast paths available; ' +
            'no current center point resolved.'
          : 'No recent cyclone positions in ' +
            'available feeds. Tracks only appear ' +
            'when published.';

      panel.appendChild(message);

    }

    for (const storm of S.storms) {

      const row = document.createElement('div');

      row.className = 'event-item';

      const title = document.createElement('div');

      title.className = 'event-title';

      title.style.color = cycloneColor(storm);

      title.textContent =
        'CYCLONE// ' + storm.name;

      const meta = document.createElement('div');

      meta.className = 'event-meta';

      meta.textContent = storm.source;

      const button = document.createElement('button');

      button.type = 'button';

      button.className = 'quake-locate-button';

      button.textContent = '[ LOCATE ]';

      button.addEventListener(
        'click',
        () => {

          const checkbox = $('layer-cyclones');

          if (checkbox) {
            checkbox.checked = true;
          }

          updateLayers();
          checkLayers();

          locate(
            storm.lat,
            storm.lon,
            stormPopup(storm)
          );

        }
      );

      row.append(title, meta, button);

      panel.appendChild(row);

    }

  }

  /* ==========================================================
     14 - REFRESH CYCLONE SOURCES
     ========================================================== */

  function refreshCyclones() {

    return refreshCyclonesAsync();

  }

  async function refreshCyclonesAsync() {

    if (S.working.cyclones) return;

    S.working.cyclones = true;

    set('cyclone-status', 'UPDATING');

    try {

      const tasks = await Promise.allSettled([

        json(
          nhcURL(5),
          20000
        ),

        json(
          nhcURL(6),
          20000
        ),

        json(
          nhcURL(7),
          20000
        ),

        json(
          ENDPOINTS.gdacs,
          20000
        )

      ]);

      const faults = [];
      const ok = [];

      function get(index, label) {

        const result = tasks[index];

        if (result.status === 'rejected') {

          faults.push(
            label + ': ' +
            result.reason.message
          );

          return null;

        }

        try {

          const features = collection(
            result.value,
            label
          );

          ok.push(label);

          return features;

        } catch (error) {

          faults.push(
            label + ': ' +
            error.message
          );

          return null;

        }

      }

      const points = get(
        0,
        'NHC positions'
      );

      const tracks = get(
        1,
        'NHC tracks'
      );

      const cones = get(
        2,
        'NHC cones'
      );

      const gdacs = get(
        3,
        'GDACS'
      );

      /* Preserve last good data for failed sources. */

      if (points) {

        S.nhcCenters = nhcStorms(points);

      }

      if (tracks) {

        S.nhcLines = tracks.filter(
          feature =>

            [
              'LineString',
              'MultiLineString'
            ].includes(
              feature.geometry?.type
            ) &&

            recent(
              feature.properties || {}
            )
        );

      }

      if (cones) {

        S.nhcCones = cones.filter(
          feature =>

            [
              'Polygon',
              'MultiPolygon'
            ].includes(
              feature.geometry?.type
            ) &&

            recent(
              feature.properties || {}
            )
        );

      }

      if (gdacs) {

        S.gdacsCenters = gdacsStorms({

          type: 'FeatureCollection',

          features: gdacs

        });

      }

      if (!ok.length) {

        throw Error(
          faults.join(' | ')
        );

      }

      const centers = S.nhcCenters || [];

      const globalReports =
        S.gdacsCenters || [];

      S.storms = [...centers];

      /* Avoid obvious duplicate storm markers. */

      for (const storm of globalReports) {

        const duplicate = centers.some(
          nhc =>

            nhc.name.toUpperCase() ===
              storm.name.toUpperCase() &&

            Math.abs(
              nhc.lat - storm.lat
            ) < 4 &&

            Math.abs(
              nhc.lon - storm.lon
            ) < 4
        );

        if (!duplicate) {

          S.storms.push(storm);

        }

      }

      S.lastCyclones = new Date();

      drawCyclones();

      set(
        'cyclone-status',
        faults.length
          ? 'PARTIAL'
          : 'ONLINE'
      );

      set(
        'cyclone-diagnostic',

        `NOAA TRACKS// ${S.nhcLines.length} | ` +
        `CONES// ${S.nhcCones.length} | ` +
        `REPORTS// ${S.storms.length} | ` +

        (
          faults.length
            ? 'PARTIAL SOURCE FAILURE'
            : 'SOURCES REPLIED'
        )
      );

      report(
        'cyclones',
        'online',
        faults.length
          ? faults.join(' | ')
          : ''
      );

    } catch (error) {

      const kind = S.lastCyclones
        ? 'stale'
        : 'error';

      set(
        'cyclone-status',
        kind.toUpperCase()
      );

      set(
        'cyclone-diagnostic',
        'CYCLONE DATA// ' + error.message
      );

      report(
        'cyclones',
        kind,
        error.message
      );

    } finally {

      S.working.cyclones = false;

    }

  }

  /* ==========================================================
     15 - STARTUP
     ========================================================== */

  function start() {

    if (
      S.started ||
      !window.WorldWatch
    ) {
      return;
    }

    S.started = true;

    addUI();

    installTileStyle();

    /* Register independent data modules. */

    const modules = [

      ['map', refreshQuakes],

      ['weather', refreshRadar],

      ['cyclones', refreshCyclones]

    ];

    for (const [name, refresh] of modules) {

      WorldWatch.registerModule(
        name,
        { refresh }
      );

    }

    if (!window.L) {

      for (const name of [
        'map',
        'weather',
        'cyclones'
      ]) {

        report(
          name,
          'error',
          'Leaflet library unavailable'
        );

      }

      set(
        'map-placeholder',
        'MAP OFFLINE// LEAFLET UNAVAILABLE'
      );

      return;

    }

    try {

      /* Create Leaflet map. */

      S.map = L.map(
        'world-map',
        {

          center: [20, 0],

          zoom: 2,

          minZoom: 2,

          maxZoom: 12,

          zoomControl: true,

          worldCopyJump: true,

          preferCanvas: true

        }
      );

      /* CARTO Dark Matter basemap. */

      L.tileLayer(
        ENDPOINTS.carto,
        {

          maxZoom: 19,

          className: 'ww-carto-tile',

          attribution:
            '&copy; OpenStreetMap contributors ' +
            '&copy; CARTO'

        }
      ).addTo(S.map);

      /* Weather radar pane. */

      S.map.createPane('wwRadar');

      S.map.getPane(
        'wwRadar'
      ).style.zIndex = 350;

      S.map.getPane(
        'wwRadar'
      ).style.pointerEvents = 'none';

      /* Cyclone forecast track pane. */

      S.map.createPane('wwTracks');

      S.map.getPane(
        'wwTracks'
      ).style.zIndex = 390;

      S.map.getPane(
        'wwTracks'
      ).style.pointerEvents = 'none';

      /* Data layer groups. */

      S.quakeLayer = L.layerGroup();

      S.cycloneLayer = L.layerGroup();

      /* Initial region. */

      const [center, zoom] =

        REGIONS[
          WorldWatch.getRegion()
        ] || REGIONS.global;

      S.map.setView(
        center,
        zoom
      );

      updateLayers();

      /* Mouse coordinate tracking. */

      S.map.on(
        'mousemove',
        event => {

          set(
            'map-coordinates',

            event.latlng.lat.toFixed(4) +
            ' / ' +
            event.latlng.lng.toFixed(4)
          );

        }
      );

      S.map.on(
        'mouseout',
        () => {

          set(
            'map-coordinates',
            '--.---- / --.----'
          );

        }
      );

      /* Map zoom indicator. */

      S.map.on(
        'zoomend',
        () => {

          set(
            'map-zoom',
            S.map.getZoom()
          );

        }
      );

      set(
        'map-zoom',
        S.map.getZoom()
      );

      /* Remove startup placeholder. */

      $('map-placeholder')?.remove();

      /* Regional navigation. */

      document.addEventListener(
        'worldwatch:region-changed',
        event => {

          const region =
            REGIONS[event.detail.region] ||
            REGIONS.global;

          S.map.flyTo(
            region[0],
            region[1],
            { duration: 0.7 }
          );

        }
      );

      /* Map layer controls. */

      document.addEventListener(
        'worldwatch:layers-changed',
        updateLayers
      );

      /* Panel resizing. */

      document.addEventListener(
        'worldwatch:panel-resized',
        () => {

          setTimeout(
            () => S.map.invalidateSize(),
            120
          );

        }
      );

      window.addEventListener(
        'resize',
        () => S.map.invalidateSize()
      );

      setTimeout(
        () => S.map.invalidateSize(),
        200
      );

      /* Initialize all data feeds. */

      refreshQuakes();

      refreshRadar();

      refreshCyclones();

      console.log(
        '[WORLDWATCH] GEO/METEO/CYCLONE ' +
        'modules initialized'
      );

    } catch (error) {

      for (const name of [
        'map',
        'weather',
        'cyclones'
      ]) {

        report(
          name,
          'error',
          error.message
        );

      }

      console.error(
        '[WORLDWATCH] Map startup failed',
        error
      );

    }

  }

  /* ==========================================================
     16 - INITIALIZE APPLICATION
     ========================================================== */

  if (document.readyState === 'loading') {

    document.addEventListener(
      'DOMContentLoaded',
      start,
      { once: true }
    );

  } else {

    start();

  }

})();
