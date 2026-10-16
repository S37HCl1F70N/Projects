
/* ============================================================
   WORLDWATCH v1.0 // INTEL GLOBAL NEWSWIRE
   PRIMARY: RSS2JSON (BBC / NPR PUBLIC RSS)
   FALLBACK: GDELT DOC 2.0
   DESIGN: WARGAMES / NORAD
   Save as: modules/news.js
   ============================================================ */
'use strict';

(() => {
  const RSS_API = 'https://api.rss2json.com/v1/api.json';
  const GDELT_API = 'https://api.gdeltproject.org/api/v2/doc/doc';
  const CACHE_MS = 5 * 60 * 1000;
  const REQUEST_TIMEOUT = 12000;
  const MAX_ITEMS = 35;
  const RECENT_MS = 3 * 60 * 60 * 1000;

  const FEEDS = {
    global: [
      { name: 'BBC WORLD', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
      { name: 'NPR WORLD', url: 'https://feeds.npr.org/1004/rss.xml' }
    ],
    americas: [
      { name: 'BBC USA / CANADA', url: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml' },
      { name: 'BBC LATIN AMERICA', url: 'https://feeds.bbci.co.uk/news/world/latin_america/rss.xml' }
    ],
    europe: [
      { name: 'BBC EUROPE', url: 'https://feeds.bbci.co.uk/news/world/europe/rss.xml' }
    ],
    'middle-east': [
      { name: 'BBC MIDDLE EAST', url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml' }
    ],
    'asia-pacific': [
      { name: 'BBC ASIA', url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml' }
    ],
    africa: [
      { name: 'BBC AFRICA', url: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml' }
    ]
  };

  const SEARCH = {
    global: '(election OR conflict OR earthquake OR diplomacy OR sanctions OR hurricane)',
    americas: '("United States" OR Canada OR Mexico OR Brazil OR Argentina)',
    europe: '(Europe OR Ukraine OR Russia OR Germany OR France)',
    'middle-east': '(Israel OR Iran OR Gaza OR Lebanon OR Syria)',
    'asia-pacific': '(China OR Taiwan OR Japan OR India OR Australia)',
    africa: '(Africa OR Sudan OR Nigeria OR Ethiopia OR Congo)'
  };

  const state = {
    region: 'global',
    filter: 'all',
    items: [],
    cache: new Map(),
    pending: new Map(),
    lastSuccess: null,
    sourceName: 'NONE',
    diagnostics: '',
    debounceTimer: null,
    initialized: false
  };

  const $ = id => document.getElementById(id);

  function set(id, value) {
    const el = $(id);
    if (el) el.textContent = String(value);
  }

  function shortUTC(date) {
    return date.toISOString().slice(11, 16) + 'Z';
  }

  function parseDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  function parseGdeltDate(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(
      /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/
    );
    if (!match) return null;
    return parseDate(
      `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`
    );
  }

  function safeLink(value) {
    try {
      const u = new URL(value);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
    } catch (_) {
      return null;
    }
  }

  function clean(value) {
    return String(value ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function topic(title, categories = '') {
    const text = `${title} ${categories}`;

    if (/\b(war|military|missile|airstrike|invasion|troops|ceasefire|conflict|attack|drone strike|armed forces)\b/i.test(text))
      return 'conflict';

    if (/\b(election|president|parliament|minister|government|diplomat|sanctions|senate|legislation|politics|vote)\b/i.test(text))
      return 'politics';

    if (/\b(earthquake|hurricane|typhoon|cyclone|flood|wildfire|tsunami|volcano|storm|tornado)\b/i.test(text))
      return 'disaster';

    if (/\b(trade|economy|inflation|energy|tariff|shipping|power grid|market)\b/i.test(text))
      return 'economy';

    return 'world';
  }

  function displayError(error) {
    if (error?.name === 'AbortError') return 'REQUEST TIMEOUT';
    if (error instanceof TypeError) return 'NETWORK / CORS / FILTER BLOCK';
    return String(error?.message || error).slice(0, 120);
  }

  async function getJSON(url) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT
    );

    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });

      if (!response.ok)
        throw new Error('HTTP ' + response.status);

      const type = response.headers.get('content-type') || '';

      if (!type.includes('json')) {
        const body = (await response.text())
          .slice(0, 90)
          .replace(/\s+/g, ' ');

        throw new Error('NON-JSON RESPONSE: ' + body);
      }

      return await response.json();

    } finally {
      clearTimeout(timer);
    }
  }

  async function getRSS(feed) {
    const params = new URLSearchParams({
      rss_url: feed.url
    });

    const data = await getJSON(RSS_API + '?' + params);

    if (data.status !== 'ok' || !Array.isArray(data.items)) {
      throw new Error(
        String(data.message || 'RSS converter returned invalid data')
      );
    }

    return data.items.map(item => ({
      title: clean(item.title),
      url: safeLink(item.link || item.guid),
      source: feed.name,
      date: parseDate(item.pubDate),
      kind: 'PUBLISHED',
      categoryText: Array.isArray(item.categories)
        ? item.categories.join(' ')
        : ''
    }));
  }

  function gdeltURL(region) {
    const params = new URLSearchParams({
      query: (SEARCH[region] || SEARCH.global) + ' sourcelang:english',
      mode: 'artlist',
      format: 'json',
      maxrecords: '40',
      timespan: '2d',
      sort: 'datedesc'
    });

    return GDELT_API + '?' + params;
  }

  async function getGDELT(region) {
    const data = await getJSON(gdeltURL(region));

    if (!Array.isArray(data.articles))
      throw new Error('GDELT: NO ARTICLE LIST');

    return data.articles.map(item => ({
      title: clean(item.title),
      url: safeLink(item.url),
      source: clean(item.domain || 'GDELT INDEX'),
      date: parseGdeltDate(item.seendate),
      kind: 'INDEXED',
      categoryText: ''
    }));
  }

  function normalize(entries) {
    const seen = new Set();
    const result = [];

    for (const item of entries) {
      if (!item || !item.url || !item.title || item.title.length < 8)
        continue;

      const key = item.title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();

      if (seen.has(key)) continue;

      seen.add(key);

      result.push({
        ...item,
        category: topic(item.title, item.categoryText)
      });
    }

    return result
      .sort((a, b) =>
        (b.date?.getTime() || 0) -
        (a.date?.getTime() || 0)
      )
      .slice(0, MAX_ITEMS);
  }

  function info(message) {
    set('ww-news-info', message);
  }

  function message(text, isError = false) {
    const host = $('news-feed');
    if (!host) return;

    host.replaceChildren();

    const el = document.createElement('div');
    el.className = 'feed-placeholder';

    el.style.cssText =
      `padding:12px;color:${isError ? '#e84949' : '#e8bf62'};white-space:pre-line`;

    el.textContent = text;
    host.appendChild(el);

    set('news-count', '0');
  }

  function displayed() {
    if (state.filter === 'breaking') {
      return state.items.filter(a =>
        a.date &&
        (Date.now() - a.date.getTime()) >= 0 &&
        (Date.now() - a.date.getTime()) <= RECENT_MS
      );
    }

    if (state.filter === 'politics' ||
        state.filter === 'conflict') {
      return state.items.filter(a =>
        a.category === state.filter
      );
    }

    return state.items;
  }

  function updateBluf() {
    const top = displayed()[0] ||
      (state.filter === 'all' ? state.items[0] : null);

    if (!top) return;

    WorldWatch.updateBluf({
      text:
        `Latest ${top.kind.toLowerCase()} headline (${top.source}): ${top.title}`,
      source: state.sourceName + ' / ' + top.source,
      updated: top.date || state.lastSuccess,
      status: 'SOURCE HEADLINE',
      level: 'standby'
    });
  }

  function render() {
    const host = $('news-feed');
    if (!host) return;

    host.replaceChildren();

    const rows = displayed();
    set('news-count', rows.length);

    if (!rows.length) {
      message(
        state.filter === 'breaking'
          ? 'BREAKING// No reports published or indexed within the last three hours. This is a recency filter, not a verified emergency alert.'
          : 'INTEL// No matching headlines in this source. Select ALL to see the remaining reports.'
      );
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const item of rows) {
      const row = document.createElement('article');
      row.className = 'news-item';

      const h = document.createElement('h3');
      h.className = 'news-item-title';

      const a = document.createElement('a');
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'BLUF// ' + item.title;
      h.appendChild(a);

      const meta = document.createElement('div');
      meta.className = 'news-item-meta';

      const source = document.createElement('span');
      source.className = 'news-source';
      source.textContent = 'SOURCE// ' + item.source;

      const stamp = document.createElement('span');
      stamp.className = 'news-timestamp';
      stamp.textContent = item.kind + '// ' +
        (item.date ? shortUTC(item.date) : 'TIME UNKNOWN');

      const tag = document.createElement('span');
      tag.textContent =
        'TOPIC// ' + item.category.toUpperCase();

      meta.append(source, stamp, tag);
      row.append(h, meta);
      fragment.appendChild(row);
    }

    host.append(fragment);
  }

  function applyData(region, record) {
    if (region !== state.region) return;

    state.items = record.items;
    state.sourceName = record.provider;
    state.diagnostics = record.details;
    state.lastSuccess = new Date(record.time);

    set('news-updated', shortUTC(state.lastSuccess));

    info(
      `SOURCE// ${record.provider} | ${record.details} | ` +
      `${record.items.length} HEADLINES`
    );

    WorldWatch.reportModuleStatus('news', 'online');

    // PARTIAL is a source diagnostic, not a threat rating.
    if (record.partial) set('news-status', 'PARTIAL');

    render();
    updateBluf();
  }

  async function load(region = state.region, force = false) {
    const cached = state.cache.get(region);

    if (!force && cached &&
        Date.now() - cached.time < CACHE_MS) {
      applyData(region, cached);
      return;
    }

    if (state.pending.has(region))
      return state.pending.get(region);

    const task = (async () => {
      if (region === state.region) {
        info('INTEL// CONTACTING BBC / NPR FEED CONVERTER ...');

        if (!state.items.length) {
          message(
            'NEWSWIRE// CONNECTING TO PUBLISHER FEEDS ...'
          );
        }
      }

      const errors = [];
      const feeds = FEEDS[region] || FEEDS.global;

      const results = await Promise.allSettled(
        feeds.map(getRSS)
      );

      let entries = [];
      let successful = 0;

      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          successful++;
          entries.push(...result.value);
        } else {
          errors.push(
            feeds[i].name + ': ' +
            displayError(result.reason)
          );
        }
      });

      let provider = 'RSS2JSON / BBC / NPR';

      if (!successful) {
        if (region === state.region) {
          info(
            'INTEL// RSS UNAVAILABLE; TRYING GDELT ...'
          );
        }

        try {
          entries = await getGDELT(region);
          successful = 1;
          provider = 'GDELT FALLBACK';
        } catch (err) {
          errors.push(
            'GDELT: ' + displayError(err)
          );
        }
      }

      if (!successful) {
        if (region === state.region) {
          const detail = errors.join(' | ');

          console.warn(
            '[WORLDWATCH][INTEL] All feeds failed:',
            detail
          );

          info('INTEL// OFFLINE | ' + detail);

          WorldWatch.reportModuleStatus(
            'news',
            state.lastSuccess ? 'stale' : 'error',
            detail
          );

          if (state.items.length) {
            render();
          } else {
            message(
              'NEWSWIRE// OFFLINE\n' +
              detail +
              '\nOpen [ BBC WORLD ] or [ NPR WORLD ] ' +
              'below to read reports directly.',
              true
            );
          }
        }
        return;
      }

      const record = {
        items: normalize(entries),
        time: Date.now(),
        provider,
        details: errors.length
          ? 'PARTIAL: ' + errors.join(' | ')
          : 'CONNECTED',
        partial: errors.length > 0
      };

      state.cache.set(region, record);
      applyData(region, record);
    })();

    state.pending.set(region, task);

    try {
      await task;
    } finally {
      state.pending.delete(region);
    }
  }

  function scheduleRegion() {
    clearTimeout(state.debounceTimer);

    const region = state.region;
    const cached = state.cache.get(region);

    state.items = [];

    if (cached &&
        Date.now() - cached.time < CACHE_MS) {
      applyData(region, cached);
      return;
    }

    message(
      'INTEL// SWITCHING REGION: ' +
      region.toUpperCase()
    );

    state.debounceTimer = setTimeout(
      () => {
        void load(region);
      },
      500
    );
  }

  function addInfo() {
    const toolbar = document.querySelector(
      '#news-panel .panel-toolbar'
    );

    if (toolbar && !$('ww-news-info')) {
      const e = document.createElement('div');
      e.id = 'ww-news-info';

      e.style.cssText =
        'padding:6px 10px;' +
        'border-bottom:1px solid #315b3e;' +
        'color:#8da895;' +
        'font-size:10px;' +
        'overflow-wrap:anywhere';

      e.textContent = 'INTEL// INITIALIZING';
      toolbar.after(e);
    }

    const footer = document.querySelector(
      '#news-panel .panel-footer'
    );

    if (footer && !$('ww-news-links')) {
      const links = document.createElement('span');
      links.id = 'ww-news-links';

      links.innerHTML =
        '<a href="https://www.bbc.com/news/world" ' +
        'target="_blank" rel="noopener noreferrer">' +
        '[ BBC WORLD ]</a> &nbsp; ' +
        '<a href="https://www.npr.org/sections/world/" ' +
        'target="_blank" rel="noopener noreferrer">' +
        '[ NPR WORLD ]</a>';

      footer.appendChild(links);
    }
  }

  function initialize() {
    if (state.initialized ||
        !window.WorldWatch) return;

    state.initialized = true;

    state.region = WorldWatch.getRegion();
    state.filter = WorldWatch.getNewsFilter();

    addInfo();

    WorldWatch.registerModule('news', {
      refresh: () => load(state.region, true)
    });

    document.addEventListener(
      'worldwatch:region-changed',
      e => {
        state.region = e.detail.region;
        scheduleRegion();
      }
    );

    document.addEventListener(
      'worldwatch:news-filter-changed',
      e => {
        state.filter = e.detail.filter;
        render();
        updateBluf();
      }
    );

    void load(state.region);

    console.log(
      '[WORLDWATCH][INTEL] RSS-first newswire initialized.'
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      initialize,
      { once: true }
    );
  } else {
    initialize();
  }
})();
