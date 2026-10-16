
/* ============================================================
   WORLDWATCH v1.0 // SOLAR + COMMS PROPAGATION
   SOURCE: NOAA SPACE WEATHER PREDICTION CENTER
   FILE: modules/solar.js

   Monitoring overview, NOT a point-to-point HF forecast.
   No API key required. All times UTC.
   ============================================================ */

'use strict';

(() => {

  /* ==========================================================
     01 - CONFIGURATION
     ========================================================== */

  const ROOT = 'https://services.swpc.noaa.gov';

  const FEEDS = {

    scales:
      ROOT + '/products/noaa-scales.json',

    kp:
      ROOT + '/products/noaa-planetary-k-index.json',

    outlook:
      ROOT + '/products/noaa-planetary-k-index-forecast.json',

    xray:
      ROOT + '/json/goes/primary/xray-flares-latest.json',

    speed:
      ROOT + '/products/summary/solar-wind-speed.json',

    magnetic:
      ROOT + '/products/summary/solar-wind-mag-field.json',

    alerts:
      ROOT + '/products/alerts.json'

  };

  const COLOR = {

    green: '#73db94',

    amber: '#e8bf62',

    orange: '#f28c52',

    red: '#e84949',

    muted: '#8da895',

    blue: '#70b7d5'

  };

  const MAX_AGE = {

    scales: 3 * 3600000,

    kp: 8 * 3600000,

    xray: 2 * 3600000,

    wind: 2 * 3600000

  };

  const S = {

    started: false,

    running: null,

    lastGood: {},

    errors: {},

    results: {},

    lastSync: null

  };

  /* ==========================================================
     02 - UTILITIES
     ========================================================== */

  const $ = id => document.getElementById(id);

  function text(id, value) {

    const element = $(id);

    if (element) {
      element.textContent = String(value);
    }

  }

  function el(tag, className, value) {

    const node = document.createElement(tag);

    if (className) {
      node.className = className;
    }

    if (value !== undefined) {
      node.textContent = String(value);
    }

    return node;

  }

  function valueNum(value) {

    if (
      value === null ||
      value === '' ||
      value === undefined
    ) {
      return null;
    }

    const n = Number(value);

    return Number.isFinite(n) ? n : null;

  }

  /* NOAA date fields are UTC, sometimes without Z. */

  function utcDate(value) {

    if (!value && value !== 0) {
      return null;
    }

    if (value instanceof Date) {

      return Number.isFinite(value.getTime())
        ? value
        : null;

    }

    if (typeof value !== 'string') {
      return null;
    }

    const str = value.trim();

    if (!str) {
      return null;
    }

    const iso = str.replace(' ', 'T');

    const normalized =
      /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso)
        ? iso
        : iso + 'Z';

    const date = new Date(normalized);

    return Number.isFinite(date.getTime())
      ? date
      : null;

  }

  function stamp(date) {

    return date

      ? date.toISOString()
          .slice(0, 16)
          .replace('T', ' ') + 'Z'

      : '--';

  }

  function ageOK(date, maxAge) {

    if (!date) {
      return false;
    }

    const delta =
      Date.now() - date.getTime();

    return (
      delta >= -15 * 60000 &&
      delta <= maxAge
    );

  }

  function shade(level) {

    if (level === null) {
      return COLOR.muted;
    }

    if (level >= 4) {
      return COLOR.red;
    }

    if (level >= 2) {
      return COLOR.orange;
    }

    if (level >= 1) {
      return COLOR.amber;
    }

    return COLOR.green;

  }

  /* ==========================================================
     03 - DISPLAY COMPONENTS
     ========================================================== */

  function metric(
    label,
    reading,
    note,
    color = COLOR.green
  ) {

    const card = el(
      'div',
      'ww-solar-metric'
    );

    const heading = el(
      'div',
      'ww-solar-label',
      label
    );

    const number = el(
      'div',
      'ww-solar-reading',
      reading
    );

    number.style.color = color;

    const foot = el(
      'div',
      'ww-solar-note',
      note
    );

    card.append(
      heading,
      number,
      foot
    );

    return card;

  }

  function line(
    label,
    reading,
    color = COLOR.muted
  ) {

    const row = el(
      'div',
      'ww-solar-row'
    );

    row.append(
      el('span', '', label)
    );

    const right = el(
      'strong',
      '',
      reading
    );

    right.style.color = color;

    row.append(right);

    return row;

  }

  function link(label, href) {

    const a = el(
      'a',
      'external-monitor-link',
      label
    );

    a.href = href;

    a.target = '_blank';

    a.rel = 'noopener noreferrer';

    return a;

  }

  function feedStatus(name) {

    if (S.errors[name]) {

      return S.lastGood[name]
        ? 'STALE'
        : 'ERROR';

    }

    return S.lastGood[name]
      ? 'ONLINE'
      : 'UNAVAILABLE';

  }

  /* ==========================================================
     04 - FETCH NOAA JSON
     ========================================================== */

  async function getJSON(url) {

    const controller =
      new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      14000
    );

    try {

      const response = await fetch(
        url,
        {

          method: 'GET',

          cache: 'no-store',

          signal: controller.signal

        }
      );

      if (!response.ok) {

        throw Error(
          'HTTP ' + response.status
        );

      }

      return await response.json();

    } finally {

      clearTimeout(timer);

    }

  }

  /* ==========================================================
     05 - NOAA SPACE WEATHER SCALES

     NOAA:
     R = Radio Blackout
     S = Solar Radiation Storm
     G = Geomagnetic Storm

     Response key "0" represents current conditions.
     ========================================================== */

  function parseScales(payload) {

    const current =
      payload && payload['0'];

    if (
      !current ||
      typeof current !== 'object'
    ) {

      throw Error(
        'NO CURRENT SCALES'
      );

    }

    const time = utcDate(
      current.DateStamp +
      'T' +
      current.TimeStamp
    );

    const levels = {};

    for (const key of ['R', 'S', 'G']) {

      const n = valueNum(
        current[key]?.Scale
      );

      levels[key] =
        n !== null &&
        n >= 0 &&
        n <= 5
          ? n
          : null;

    }

    if (
      Object.values(levels)
        .every(v => v === null)
    ) {

      throw Error(
        'SCALES MISSING'
      );

    }

    return {

      ...levels,

      time,

      fresh: ageOK(
        time,
        MAX_AGE.scales
      )

    };

  }

  /* ==========================================================
     06 - PLANETARY KP
     ========================================================== */

  function parseKP(payload) {

    if (!Array.isArray(payload)) {

      throw Error(
        'KP ARRAY MISSING'
      );

    }

    const all = payload

      .map(row => ({

        time: utcDate(
          row.time_tag
        ),

        kp: valueNum(
          row.Kp ?? row.kp
        )

      }))

      .filter(x =>

        x.time &&

        x.kp !== null &&

        x.kp >= 0 &&

        x.kp <= 9 &&

        x.time.getTime() <=
          Date.now() + 15 * 60000

      )

      .sort(
        (a, b) => a.time - b.time
      );

    if (!all.length) {

      throw Error(
        'NO VALID KP OBSERVATIONS'
      );

    }

    const latest =
      all[all.length - 1];

    return {

      ...latest,

      history: all.slice(-12),

      fresh: ageOK(
        latest.time,
        MAX_AGE.kp
      )

    };

  }

  /* ==========================================================
     07 - FORECAST KP

     Future predicted values are not observations.
     ========================================================== */

  function parseOutlook(payload) {

    if (!Array.isArray(payload)) {

      throw Error(
        'FORECAST ARRAY MISSING'
      );

    }

    const from = Date.now();

    const to =
      from + 24 * 3600000;

    const rows = payload

      .map(row => ({

        time: utcDate(
          row.time_tag
        ),

        kp: valueNum(
          row.kp ?? row.Kp
        ),

        mode: String(
          row.observed || ''
        ).toLowerCase()

      }))

      .filter(x =>

        x.mode === 'predicted' &&

        x.time &&

        x.time.getTime() >= from &&

        x.time.getTime() <= to &&

        x.kp !== null &&

        x.kp >= 0 &&

        x.kp <= 9

      );

    return rows.length

      ? Math.max(
          ...rows.map(x => x.kp)
        )

      : null;

  }

  /* ==========================================================
     08 - GOES X-RAY ACTIVITY
     ========================================================== */

  function parseXray(payload) {

    if (
      !Array.isArray(payload) ||
      !payload.length
    ) {

      throw Error(
        'GOES ARRAY MISSING'
      );

    }

    const rows = payload

      .map(row => ({

        time: utcDate(
          row.time_tag
        ),

        reading:
          typeof row.current_class === 'string'
            ? row.current_class
            : null

      }))

      .filter(x =>

        x.time &&

        /^[ABCMX]\d+(?:\.\d+)?$/i.test(
          x.reading || ''
        )

      )

      .sort(
        (a, b) => a.time - b.time
      );

    if (!rows.length) {

      throw Error(
        'NO VALID XRAY READING'
      );

    }

    const latest =
      rows[rows.length - 1];

    return {

      ...latest,

      fresh: ageOK(
        latest.time,
        MAX_AGE.xray
      )

    };

  }

  /* ==========================================================
     09 - SOLAR WIND
     ========================================================== */

  function parseWind(payload, type) {

    if (!Array.isArray(payload)) {

      throw Error(
        'SOLAR WIND ARRAY MISSING'
      );

    }

    const rows = payload

      .map(row => ({

        time: utcDate(
          row.time_tag
        ),

        val: valueNum(

          type === 'speed'

            ? row.proton_speed

            : row.bz_gsm

        )

      }))

      .filter(
        x => x.time &&
        x.val !== null
      )

      .sort(
        (a, b) => a.time - b.time
      );

    if (!rows.length) {

      throw Error(
        'NO SOLAR WIND VALUES'
      );

    }

    const latest =
      rows[rows.length - 1];

    return {

      ...latest,

      fresh: ageOK(
        latest.time,
        MAX_AGE.wind
      )

    };

  }

  /* ==========================================================
     10 - NOAA BULLETINS

     Recent bulletin history is not automatically
     an active warning list.
     ========================================================== */

  function parseAlerts(payload) {

    if (!Array.isArray(payload)) {

      throw Error(
        'ALERT ARRAY MISSING'
      );

    }

    return payload

      .map(row => {

        const msg = String(
          row.message || ''
        );

        const lines = msg
          .split(/\r?\n/)
          .map(s => s.trim());

        const lead =

          lines.find(
            s => /^(ALERT|WATCH|WARNING|EXTENDED WARNING|SUMMARY|CANCEL WATCH|CANCEL WARNING):/i.test(s)
          ) ||

          lines.find(
            s => /^(Space Weather Message Code|Issue Time):/i.test(s)
          ) ||

          'NOAA SPACE WEATHER BULLETIN';

        return {

          time: utcDate(
            row.issue_datetime
          ),

          title: lead.slice(0, 170)

        };

      })

      .filter(x =>

        x.time &&

        Date.now() -
          x.time.getTime() <
          48 * 3600000 &&

        x.time.getTime() <=
          Date.now() + 15 * 60000

      )

      .sort(
        (a, b) => b.time - a.time
      )

      .slice(0, 3);

  }

  const PARSERS = {

    scales: parseScales,

    kp: parseKP,

    outlook: parseOutlook,

    xray: parseXray,

    speed:
      x => parseWind(
        x,
        'speed'
      ),

    magnetic:
      x => parseWind(
        x,
        'magnetic'
      ),

    alerts: parseAlerts

  };

  /* ==========================================================
     11 - MODULE STYLING
     ========================================================== */

  function injectStyle() {

    if ($('ww-solar-style')) {
      return;
    }

    const style =
      document.createElement('style');

    style.id =
      'ww-solar-style';

    style.textContent = `

      .ww-solar-block {
        font: 11px/1.55 Consolas, 'Courier New', monospace;
        color: #c5dccb;
      }

      .ww-solar-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0,1fr));
        gap: 5px;
        margin: 7px 0;
      }

      .ww-solar-metric {
        min-width: 0;
        padding: 7px 5px;
        background: #09190f;
        border: 1px solid #315b3e;
      }

      .ww-solar-label {
        font-size: 10px;
        color: #8da895;
        font-weight: bold;
      }

      .ww-solar-reading {
        margin: 3px 0;
        font-size: 18px;
        font-weight: bold;
        font-variant-numeric: tabular-nums;
      }

      .ww-solar-note {
        color: #8da895;
        font-size: 9px;
        overflow-wrap: anywhere;
      }

      .ww-solar-row {
        display: flex;
        justify-content: space-between;
        gap: 6px;
        padding: 4px 0;
        border-bottom: 1px dashed #1c3826;
        font-size: 10px;
      }

      .ww-solar-row strong {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      .ww-solar-heading {
        margin: 10px 0 4px;
        color: #e8bf62;
        font-size: 11px;
        font-weight: bold;
      }

      .ww-solar-chart {
        display: flex;
        gap: 3px;
        align-items: end;
        height: 68px;
        padding: 5px 2px 3px;
        border-bottom: 1px solid #315b3e;
      }

      .ww-solar-bar {
        flex: 1;
        min-width: 4px;
        max-width: 22px;
        opacity: 0.85;
      }

      .ww-solar-muted {
        font-size: 10px;
        color: #8da895;
      }

      .ww-solar-message {
        padding: 5px 0;
        border-bottom: 1px dashed #315b3e;
        font-size: 10px;
      }

      .ww-solar-links {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 8px;
      }

      .ww-prop {
        padding: 6px 7px;
        border: 1px solid #315b3e;
        background: #09190f;
        margin: 5px 0;
      }

      .ww-prop-name {
        font-size: 10px;
        font-weight: bold;
        color: #e8bf62;
      }

      .ww-prop-state {
        font-size: 13px;
        font-weight: bold;
        margin: 3px 0;
      }

      .ww-prop-note {
        font-size: 10px;
        color: #8da895;
        line-height: 1.45;
      }

      .ww-solar-source {
        margin-top: 6px;
        font-size: 9px;
        color: #8da895;
        overflow-wrap: anywhere;
      }

      @media(max-width:700px) {

        .ww-solar-reading {
          font-size: 16px;
        }

      }

    `;

    document.head.appendChild(style);

  }

  /* ==========================================================
     12 - KP HISTORY CHART
     ========================================================== */

  function renderKPChart(host, kp) {

    const title = el(
      'div',
      'ww-solar-heading',
      'GEOMAG// LAST 12 KP OBSERVATIONS'
    );

    host.append(title);

    if (!kp) {

      host.append(
        el(
          'div',
          'ww-solar-muted',
          'HISTORY// UNAVAILABLE'
        )
      );

      return;

    }

    const chart = el(
      'div',
      'ww-solar-chart'
    );

    chart.setAttribute(
      'aria-label',
      'Recent Kp bar chart'
    );

    for (const item of kp.history) {

      const bar = el(
        'div',
        'ww-solar-bar'
      );

      bar.style.height =

        Math.max(

          3,

          Math.round(
            item.kp / 9 * 58
          )

        ) + 'px';

      bar.style.background =

        item.kp >= 7
          ? COLOR.red

          : item.kp >= 5
            ? COLOR.orange

            : item.kp >= 4
              ? COLOR.amber

              : COLOR.green;

      bar.title =

        stamp(item.time) +

        ' Kp ' +

        item.kp.toFixed(2);

      chart.append(bar);

    }

    host.append(chart);

    host.append(

      el(
        'div',
        'ww-solar-muted',

        'LEFT// OLDER     RIGHT// NEWER     ' +
        'BARS// PLANETARY KP (0–9)'
      )

    );

  }

  /* ==========================================================
     13 - RADIO PROPAGATION ASSESSMENT

     These are broad impact indicators derived
     from the NOAA scales.

     They are not actual signal measurements.
     ========================================================== */

  function commsAssessment(scales) {

    if (

      !scales ||

      !scales.fresh ||

      ['R', 'S', 'G'].some(
        k => scales[k] === null
      )

    ) {

      return {

        color: COLOR.muted,

        headline: 'UNAVAILABLE',

        rows: [

          [
            'HAM HF (3–30 MHz)',
            'UNKNOWN',
            'NOAA scales unavailable or stale. Cannot assess HF disruption.',
            COLOR.muted
          ],

          [
            'CB (27 MHz)',
            'UNKNOWN',
            'Upper-HF skywave conditions cannot be assessed from stale data.',
            COLOR.muted
          ],

          [
            'GMRS / VHF / UHF',
            'NOT ASSESSED',
            'This feed does not measure local repeater or line-of-sight link quality.',
            COLOR.muted
          ],

          [
            'MESH RADIO',
            'NOT ASSESSED',
            'Local RF path and network health require dedicated monitoring.',
            COLOR.muted
          ],

          [
            'GNSS / SATELLITES',
            'UNKNOWN',
            'Space-weather satellite risk cannot be assessed.',
            COLOR.muted
          ]

        ]

      };

    }

    const {

      R,

      S: solar,

      G

    } = scales;

    let headline =
      'NO MAJOR NOAA-SCALE DISTURBANCE';

    let color =
      COLOR.green;

    if (

      R >= 3 ||

      G >= 3 ||

      solar >= 3

    ) {

      headline =
        'SIGNIFICANT SPACE-WEATHER RISK';

      color = COLOR.red;

    } else if (

      R >= 1 ||

      G >= 2 ||

      solar >= 1

    ) {

      headline =
        'ELEVATED RADIO / SPACE RISK';

      color = COLOR.orange;

    } else if (G >= 1) {

      headline =
        'MINOR GEOMAGNETIC ACTIVITY';

      color = COLOR.amber;

    }

    const hf =

      R >= 3
        ? 'DAYLIGHT HF BLACKOUT RISK'

        : R >= 1
          ? 'DAYLIGHT HF DEGRADATION'

          : (G >= 2 || solar >= 1)
            ? 'REGIONAL / POLAR RISK'

            : 'NO NOAA R-LEVEL BLACKOUT';

    const cb =

      R >= 1
        ? 'SKYWAVE MAY DEGRADE'

        : 'NO R-LEVEL BLACKOUT';

    const satellite =

      G >= 2 || solar >= 2
        ? 'ELEVATED WATCH'

        : G >= 1
          ? 'MINOR RISK POSSIBLE'

          : 'NO MAJOR SCALE FLAG';

    return {

      color,

      headline,

      rows: [

        [
          'HAM HF (3–30 MHz)',

          hf,

          R >= 1

            ? 'NOAA R' + R +
              ' affects sunlit-side HF. G/S effects may affect high-latitude paths.'

            : 'No current NOAA R-scale blackout; propagation still depends on time, frequency, path, and ionosphere.',

          R >= 3
            ? COLOR.red

            : R >= 1 || G >= 2
              ? COLOR.orange

              : COLOR.green
        ],

        [
          'CB (27 MHz)',

          cb,

          '27 MHz is upper HF. Local groundwave and long-range skip behave differently.',

          R >= 1
            ? COLOR.amber
            : COLOR.green
        ],

        [
          'GMRS / VHF / UHF',

          'NO DIRECT HF BLACKOUT INDICATOR',

          'NOAA R-scale HF blackouts do not by themselves indicate a failed 462/467 MHz GMRS repeater. Local coverage not tested.',

          COLOR.blue
        ],

        [
          'MESH RADIO',

          'LOCAL LINK STATUS UNKNOWN',

          'Mesh LoS links depend on frequency, terrain, nodes, and backhaul; this is not a mesh-health measurement.',

          COLOR.blue
        ],

        [
          'GNSS / SATELLITES',

          satellite,

          'Geomagnetic and particle storms can affect satellite operations/navigation. Monitor service-specific advisories.',

          G >= 2 || solar >= 2
            ? COLOR.orange
            : COLOR.green
        ]

      ]

    };

  }

  /* ==========================================================
     14 - RENDER SOLAR MONITOR
     ========================================================== */

  function renderSolar() {

    const host =
      $('spaceweather-feed');

    if (!host) {
      return;
    }

    host.replaceChildren();

    const body = el(
      'div',
      'ww-solar-block'
    );

    const scales =
      S.lastGood.scales;

    const kp =
      S.lastGood.kp;

    const xray =
      S.lastGood.xray;

    const speed =
      S.lastGood.speed;

    const mag =
      S.lastGood.magnetic;

    const forecast =
      S.lastGood.outlook;

    const alerts =
      S.lastGood.alerts;

    const current =
      scales && scales.fresh;

    /* NOAA R/S/G scales */

    const grid = el(
      'div',
      'ww-solar-grid'
    );

    for (const key of ['R', 'S', 'G']) {

      const level = current
        ? scales[key]
        : null;

      const detail = {

        R: 'RADIO BLACKOUT',

        S: 'RADIATION STORM',

        G: 'GEOMAGNETIC'

      }[key];

      grid.append(

        metric(

          'NOAA ' + key + '-SCALE',

          level === null
            ? '--'
            : key + level,

          detail,

          shade(level)

        )

      );

    }

    body.append(grid);

    /* NOAA measurements */

    body.append(

      line(

        'SCALES OBSERVED//',

        current
          ? stamp(scales.time)
          : 'STALE / UNAVAILABLE',

        current
          ? COLOR.green
          : COLOR.amber

      )

    );

    body.append(

      line(

        'KP// PLANETARY OBSERVED',

        kp && kp.fresh
          ? kp.kp.toFixed(2)
          : '--',

        kp && kp.fresh

          ? (
              kp.kp >= 7
                ? COLOR.red

                : kp.kp >= 5
                  ? COLOR.orange

                  : COLOR.green
            )

          : COLOR.muted

      )

    );

    body.append(

      line(

        'KP OBSERVATION UTC//',

        kp
          ? stamp(kp.time)
          : '--'

      )

    );

    body.append(

      line(

        'KP FORECAST MAX NEXT 24H//',

        typeof forecast === 'number'

          ? forecast.toFixed(2) +
            ' (PREDICTED)'

          : '--',

        COLOR.amber

      )

    );

    body.append(

      line(

        'GOES X-RAY CURRENT//',

        xray && xray.fresh
          ? xray.reading
          : '--',

        xray &&
        xray.fresh &&
        /^[MX]/i.test(xray.reading)

          ? COLOR.orange

          : COLOR.green

      )

    );

    body.append(

      line(

        'X-RAY OBSERVATION UTC//',

        xray
          ? stamp(xray.time)
          : '--'

      )

    );

    body.append(

      line(

        'SOLAR WIND SPEED//',

        speed && speed.fresh

          ? speed.val.toFixed(0) +
            ' km/s'

          : '--',

        COLOR.blue

      )

    );

    body.append(

      line(

        'IMF Bz (GSM)//',

        mag && mag.fresh

          ? mag.val.toFixed(1) +
            ' nT'

          : '--',

        mag &&
        mag.fresh &&
        mag.val < -10

          ? COLOR.orange

          : COLOR.blue

      )

    );

    /* Kp history */

    renderKPChart(
      body,
      kp && kp.fresh
        ? kp
        : null
    );

    /* Recent NOAA bulletins */

    body.append(

      el(

        'div',

        'ww-solar-heading',

        'NOAA// RECENT BULLETINS (NOT LIVE WARNINGS)'

      )

    );

    if (
      alerts &&
      alerts.length
    ) {

      for (const alert of alerts) {

        const row = el(
          'div',
          'ww-solar-message'
        );

        row.append(

          el(
            'div',
            'ww-solar-muted',
            stamp(alert.time)
          )

        );

        row.append(

          el(
            'div',
            '',
            alert.title
          )

        );

        body.append(row);

      }

    } else {

      body.append(

        el(

          'div',

          'ww-solar-muted',

          'NO BULLETINS LOADED FROM PAST 48H.'

        )

      );

    }

    /* NOAA source links */

    const links = el(
      'div',
      'ww-solar-links'
    );

    links.append(

      link(
        '[ NOAA SWPC ]',
        'https://www.swpc.noaa.gov/'
      ),

      link(
        '[ SCALES ]',
        'https://www.swpc.noaa.gov/noaa-scales-explanation'
      ),

      link(
        '[ RADIO IMPACTS ]',
        'https://www.spaceweather.gov/impacts/hf-radio-communications'
      )

    );

    body.append(links);

    /* Diagnostics */

    const status =
      Object.keys(FEEDS)

        .map(

          name =>

            name.toUpperCase() +
            ':' +
            feedStatus(name)

        )

        .join(' | ');

    body.append(

      el(

        'div',

        'ww-solar-source',

        'SOURCE STATUS// ' +
        status

      )

    );

    if (
      Object.keys(S.errors).length
    ) {

      const problems =
        Object.entries(S.errors)

          .map(
            ([key, val]) =>
              key + ': ' + val
          )

          .join(' | ');

      body.append(

        el(

          'div',

          'ww-solar-source',

          'FEED ISSUES// ' +
          problems

        )

      );

    }

    body.append(

      el(

        'div',

        'ww-solar-source',

        'ALL TIMES UTC // R, S, G = CURRENT NOAA SCALES; ' +
        'Kp = OBSERVATION; FORECAST MARKED PREDICTED.'

      )

    );

    host.append(body);

  }

  /* ==========================================================
     15 - RENDER COMMS PROPAGATION MONITOR
     ========================================================== */

  function renderComms() {

    const panel =
      $('comms-panel');

    const host =
      panel?.querySelector('.panel-content');

    if (!host) {
      return;
    }

    host.replaceChildren();

    const container = el(
      'div',
      'ww-solar-block'
    );

    const assessment =
      commsAssessment(
        S.lastGood.scales
      );

    const heading = el(

      'div',

      'ww-solar-heading',

      'COMMS// PROPAGATION STATUS'

    );

    container.append(heading);

    const headline = el(

      'div',

      'ww-solar-reading',

      assessment.headline

    );

    headline.style.color =
      assessment.color;

    headline.style.fontSize =
      '12px';

    container.append(headline);

    for (
      const [
        name,
        status,
        explanation,
        color
      ] of assessment.rows
    ) {

      const item = el(
        'div',
        'ww-prop'
      );

      const nameNode = el(

        'div',

        'ww-prop-name',

        name

      );

      const statusNode = el(

        'div',

        'ww-prop-state',

        status

      );

      statusNode.style.color =
        color;

      statusNode.style.fontSize =
        '11px';

      item.append(

        nameNode,

        statusNode,

        el(

          'div',

          'ww-prop-note',

          explanation

        )

      );

      container.append(item);

    }

    container.append(

      el(

        'div',

        'ww-solar-source',

        'RULE-BASED NOAA IMPACT INDICATORS ONLY. ' +
        'NOT A RADIO PATH PREDICTION OR EQUIPMENT STATUS TEST.'

      )

    );

    container.append(

      link(

        '[ HF RADIO IMPACTS ]',

        'https://www.spaceweather.gov/impacts/hf-radio-communications'

      )

    );

    container.append(

      link(

        '[ NETWORK RADAR ]',

        'https://radar.cloudflare.com/'

      )

    );

    host.append(container);

    text(

      'comms-status',

      S.lastGood.scales?.fresh

        ? 'NOAA// ASSESSED'

        : 'NOAA// UNKNOWN'

    );

  }

  /* ==========================================================
     16 - MODULE HEALTH
     ========================================================== */

  function updateStatus() {

    const core = [
      'scales',
      'kp'
    ];

    const coreFresh =
      core.some(

        name =>
          Boolean(
            S.lastGood[name]?.fresh
          )

      );

    const received =
      Object.keys(
        S.lastGood
      ).length;

    const failures =
      Object.keys(
        S.errors
      ).length;

    let label;
    let health;

    if (!received) {

      label = 'OFFLINE';

      health = 'error';

    } else if (!coreFresh) {

      label = 'STALE';

      health = 'stale';

    } else {

      label =
        failures
          ? 'PARTIAL'
          : 'ONLINE';

      health = 'online';

    }

    text(
      'spaceweather-status',
      label
    );

    const status =
      $('spaceweather-status');

    if (status) {

      status.style.color =

        health === 'error'
          ? COLOR.red

          : health === 'stale' || failures
            ? COLOR.amber

            : COLOR.green;

    }

    window.WorldWatch?.reportModuleStatus(

      'solar',

      health,

      failures

        ? Object.entries(S.errors)

            .map(
              ([name, error]) =>
                name + ': ' + error
            )

            .join(' | ')

        : ''

    );

  }

  /* ==========================================================
     17 - REFRESH NOAA FEEDS
     ========================================================== */

  async function refresh() {

    if (S.running) {
      return S.running;
    }

    S.running = (async () => {

      text(
        'spaceweather-status',
        'UPDATING'
      );

      const jobs =
        Object.entries(FEEDS);

      const results =
        await Promise.allSettled(

          jobs.map(

            ([, url]) =>
              getJSON(url)

          )

        );

      results.forEach(

        (outcome, i) => {

          const name =
            jobs[i][0];

          try {

            if (
              outcome.status === 'rejected'
            ) {

              throw outcome.reason;

            }

            S.lastGood[name] =

              PARSERS[name](
                outcome.value
              );

            delete S.errors[name];

          } catch (error) {

            S.errors[name] =

              error?.name === 'AbortError'

                ? 'TIMEOUT'

                : String(
                    error?.message || error
                  ).slice(0, 100);

          }

        }

      );

      S.lastSync = new Date();

      renderSolar();

      renderComms();

      updateStatus();

      console.log(

        '[WORLDWATCH][SOLAR] SWPC sync complete',

        Object.keys(S.lastGood).length,

        'feeds with data',

        Object.keys(S.errors).length,

        'feed errors'

      );

    })();

    try {

      await S.running;

    } finally {

      S.running = null;

    }

  }

  /* ==========================================================
     18 - INITIALIZATION
     ========================================================== */

  function initialize() {

    if (
      S.started ||
      !window.WorldWatch
    ) {
      return;
    }

    S.started = true;

    injectStyle();

    window.WorldWatch.registerModule(

      'solar',

      {
        refresh
      }

    );

    void refresh();

  }

  /* ==========================================================
     19 - START
     ========================================================== */

  if (
    document.readyState === 'loading'
  ) {

    document.addEventListener(

      'DOMContentLoaded',

      initialize,

      {
        once: true
      }

    );

  } else {

    initialize();

  }

})();
