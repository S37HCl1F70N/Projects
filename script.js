
/* WORLDWATCH v1.0 // SYSTEM CONTROLLER */
'use strict';

(() => {
  const CONFIG = {
    refreshMs: 300000,
    staleMs: 900000,
    settingsKey: 'WORLDWATCH_SETTINGS_V1'
  };

  const modules = new Map();

  const state = {
    region: 'global',
    newsFilter: 'all',
    audio: false,
    expanded: null,
    refreshing: false,
    lastSync: null,
    audioContext: null,
    initialized: false
  };

  const $ = id => document.getElementById(id);

  const setText = (id, text) => {
    const el = $(id);
    if (el) el.textContent = String(text);
  };

  const utc = (d = new Date()) =>
    d.toISOString().slice(11, 19) + 'Z';

  const shortUtc = (d = new Date()) =>
    d.toISOString().slice(11, 16) + 'Z';

  const emit = (event, detail = {}) =>
    document.dispatchEvent(
      new CustomEvent('worldwatch:' + event, { detail })
    );

  const log = (message, level = 'INFO') =>
    console.log(`[WORLDWATCH][${level}] ${message}`);

  function status(id, text, kind = 'standby') {
    const el = $(id);
    if (!el) return;

    el.textContent = text;

    el.classList.remove(
      'status-standby',
      'status-online',
      'status-stale',
      'status-offline',
      'status-error',
      'status-warning',
      'status-active'
    );

    el.classList.add('status-' + kind);
  }

  function notify(message, type = 'info') {
    const el = $('system-notification');
    if (!el) return;

    clearTimeout(notify.timer);

    el.className = 'system-notification' +
      (type === 'warning' ? ' notification-warning' :
       type === 'error' ? ' notification-error' : '');

    el.textContent = message;
    el.hidden = false;

    if (type === 'warning' || type === 'error') {
      playAlert(type === 'error' ? 'critical' : 'warning');
    }

    notify.timer = setTimeout(() => {
      el.hidden = true;
    }, 5000);
  }

  function saveSettings() {
    try {
      localStorage.setItem(
        CONFIG.settingsKey,
        JSON.stringify({
          region: state.region,
          audio: state.audio
        })
      );
    } catch (_) {}
  }

  function loadSettings() {
    try {
      const s = JSON.parse(
        localStorage.getItem(CONFIG.settingsKey) || '{}'
      );

      if ([
        'global', 'americas', 'europe',
        'middle-east', 'asia-pacific', 'africa'
      ].includes(s.region)) {
        state.region = s.region;
      }

      state.audio = s.audio === true;
    } catch (_) {}
  }

  function clocks() {
    const d = new Date();

    setText('utc-clock', utc(d));

    setText(
      'local-clock',
      d.toLocaleTimeString('en-GB', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    );

    ['utc-clock', 'local-clock'].forEach(id => {
      if ($(id)) $(id).dateTime = d.toISOString();
    });
  }

  function updateFeeds() {
    const entries = [...modules.entries()];

    const online = entries.filter(
      ([, m]) => m.status === 'online'
    ).length;

    const bad = entries.some(
      ([, m]) => ['offline', 'error', 'stale']
        .includes(m.status)
    );

    setText('feeds-online', online);
    setText('feeds-total', entries.length);

    status(
      'data-status',
      entries.length === 0 ? 'NO FEEDS' :
      online === entries.length ? 'ONLINE' :
      bad ? 'DEGRADED' : 'CONNECTING',
      entries.length && online === entries.length
        ? 'online' : bad ? 'warning' : 'standby'
    );

    if (state.lastSync) {
      setText('last-sync', utc(state.lastSync));
    }

    const ids = {
      map: 'map-status',
      news: 'news-status',
      disasters: 'disaster-status',
      conflicts: 'conflict-status',
      space: 'space-status',
      communications: 'comms-status',
      infrastructure: 'infrastructure-status'
    };

    for (const [name, id] of Object.entries(ids)) {
      const m = modules.get(name);
      if (m) status(id, m.status.toUpperCase(), m.status);
    }

    const map = modules.get('map');

    if (map) {
      status(
        'earthquake-status',
        map.status.toUpperCase(),
        map.status
      );

      status(
        'events-status',
        map.status.toUpperCase(),
        map.status
      );
    }
  }

  function registerModule(name, definition) {
    if (
      !name ||
      !definition ||
      typeof definition.refresh !== 'function'
    ) {
      throw Error(
        'Module requires a name and refresh()'
      );
    }

    modules.set(name, {
      refresh: definition.refresh,
      status: 'standby',
      lastSuccess: null,
      error: null
    });

    log(`Registered module: ${name}`);
    updateFeeds();
  }

  function reportModuleStatus(name, kind, message = '') {
    const m = modules.get(name);

    if (!m) {
      log('Unknown module: ' + name, 'WARN');
      return;
    }

    if (![
      'online', 'stale', 'offline', 'error', 'standby'
    ].includes(kind)) return;

    m.status = kind;
    m.error = message;

    if (kind === 'online') {
      m.lastSuccess = new Date();
      state.lastSync = m.lastSuccess;
    }

    if (message) {
      log(
        `${name}: ${message}`,
        kind === 'online' ? 'INFO' : 'WARN'
      );
    }

    updateFeeds();
  }

  function healthCheck() {
    const now = Date.now();

    for (const m of modules.values()) {
      if (
        m.status === 'online' &&
        m.lastSuccess &&
        now - m.lastSuccess.getTime() > CONFIG.staleMs
      ) {
        m.status = 'stale';
      }
    }

    updateFeeds();
  }

  function getActiveLayers() {
    return [
      ...document.querySelectorAll(
        '[data-map-layer]:checked'
      )
    ].map(el => el.dataset.mapLayer);
  }

  function setRegion(region) {
    if (![
      'global', 'americas', 'europe',
      'middle-east', 'asia-pacific', 'africa'
    ].includes(region)) return;

    state.region = region;

    document.querySelectorAll('[data-region]')
      .forEach(el => {
        const active = el.dataset.region === region;

        el.classList.toggle('active', active);
        el.setAttribute(
          'aria-pressed',
          String(active)
        );
      });

    saveSettings();
    emit('region-changed', { region });
  }

  function setNewsFilter(filter) {
    if (![
      'all', 'breaking', 'politics', 'conflict'
    ].includes(filter)) return;

    state.newsFilter = filter;

    document.querySelectorAll('[data-news-filter]')
      .forEach(el => {
        const on = el.dataset.newsFilter === filter;

        el.classList.toggle('active', on);
        el.setAttribute('aria-pressed', String(on));
      });

    emit('news-filter-changed', { filter });
  }

  function closeExpanded() {
    if (!state.expanded) return;

    const panel = $(state.expanded);

    if (panel) {
      panel.classList.remove('panel-expanded');

      const b = panel.querySelector('[data-expand]');

      if (b) {
        b.textContent = '[ + ]';
        b.setAttribute('aria-label', 'Expand panel');
      }
    }

    state.expanded = null;

    document.body.classList.remove(
      'panel-is-expanded'
    );

    emit('panel-resized');
  }

  function expandPanel(id) {
    if (state.expanded === id) {
      return closeExpanded();
    }

    closeExpanded();

    const panel = $(id);
    if (!panel) return;

    panel.classList.add('panel-expanded');

    state.expanded = id;

    document.body.classList.add(
      'panel-is-expanded'
    );

    const b = panel.querySelector('[data-expand]');

    if (b) {
      b.textContent = '[ - ]';
      b.setAttribute('aria-label', 'Restore panel');
      b.focus();
    }

    emit('panel-resized');
  }

  function updateAudioButton() {
    const b = $('toggle-audio');

    if (b) {
      b.textContent = state.audio
        ? '[ AUDIO: ON ]'
        : '[ AUDIO: OFF ]';

      b.setAttribute(
        'aria-pressed',
        String(state.audio)
      );
    }
  }

  function playAlert(type = 'warning') {
    if (
      !state.audio ||
      !state.audioContext ||
      state.audioContext.state !== 'running'
    ) return;

    const ctx = state.audioContext;
    const now = ctx.currentTime;

    for (
      let i = 0;
      i < (type === 'critical' ? 3 : 1);
      i++
    ) {
      const start = now + i * 0.24;

      const o = ctx.createOscillator();
      const g = ctx.createGain();

      o.type = 'square';

      o.frequency.value =
        type === 'critical' ? 880 : 660;

      g.gain.setValueAtTime(0.0001, start);

      g.gain.exponentialRampToValueAtTime(
        0.045, start + 0.015
      );

      g.gain.exponentialRampToValueAtTime(
        0.0001, start + 0.17
      );

      o.connect(g);
      g.connect(ctx.destination);

      o.start(start);
      o.stop(start + 0.18);
    }
  }

  async function toggleAudio() {
    state.audio = !state.audio;

    if (state.audio) {
      try {
        const Ctx =
          window.AudioContext ||
          window.webkitAudioContext;

        if (!Ctx) {
          throw Error('Audio unavailable');
        }

        if (!state.audioContext) {
          state.audioContext = new Ctx();
        }

        await state.audioContext.resume();
      } catch (e) {
        state.audio = false;

        notify(
          'AUDIO// ' + e.message,
          'warning'
        );
      }
    }

    updateAudioButton();
    saveSettings();

    notify(
      'AUDIO// ' +
      (state.audio ? 'ENABLED' : 'DISABLED')
    );

    if (state.audio) playAlert();
  }

  async function refreshAll() {
    if (state.refreshing) return;

    if (!modules.size) {
      notify(
        'REFRESH// NO DATA MODULES CONNECTED',
        'warning'
      );
      return;
    }

    state.refreshing = true;

    const b = $('refresh-all');

    if (b) {
      b.disabled = true;
      b.textContent = '[ REFRESHING... ]';
    }

    try {
      await Promise.allSettled(
        [...modules.entries()].map(
          async ([name, m]) => {
            try {
              await m.refresh();
            } catch (e) {
              reportModuleStatus(
                name, 'error', e.message
              );
            }
          }
        )
      );

      emit('refresh-complete', {
        time: new Date()
      });

      notify('SYSTEM// REFRESH COMPLETE');
    } finally {
      state.refreshing = false;

      if (b) {
        b.disabled = false;
        b.textContent = '[ REFRESH ]';
      }

      updateFeeds();
    }
  }

  function updateBluf(data) {
    if (
      !data ||
      typeof data.text !== 'string' ||
      !data.text.trim()
    ) return;

    setText('bluf-text', data.text);

    setText(
      'bluf-source',
      data.source || 'UNSPECIFIED'
    );

    setText(
      'bluf-updated',
      data.updated instanceof Date &&
      !isNaN(data.updated)
        ? shortUtc(data.updated)
        : 'UNVERIFIED'
    );

    setText(
      'bluf-status',
      data.status || 'REPORTED'
    );

    const e = $('bluf-status');

    if (e) {
      e.className =
        'indicator-' +
        ([
          'active', 'warning',
          'critical', 'standby'
        ].includes(data.level)
          ? data.level
          : 'active');
    }
  }

  function showEventDetails(title, content) {
    setText(
      'event-dialog-title',
      'SITREP// ' + title
    );

    setText(
      'event-dialog-content',
      content
    );

    const d = $('event-details-dialog');

    if (d && !d.open) d.showModal();
  }

  function networkStatus() {
    status(
      'connection-indicator',
      navigator.onLine
        ? 'NETWORK// AVAILABLE'
        : 'NETWORK// OFFLINE',
      navigator.onLine ? 'online' : 'offline'
    );
  }

  function initialize() {
    if (state.initialized) return;

    state.initialized = true;

    loadSettings();
    clocks();

    setInterval(clocks, 1000);

    setInterval(healthCheck, 60000);

    setInterval(() => {
      if (modules.size && !state.refreshing) {
        refreshAll();
      }
    }, CONFIG.refreshMs);

    document.querySelectorAll('[data-region]')
      .forEach(b => b.addEventListener(
        'click',
        () => setRegion(b.dataset.region)
      ));

    document.querySelectorAll('[data-news-filter]')
      .forEach(b => b.addEventListener(
        'click',
        () => setNewsFilter(b.dataset.newsFilter)
      ));

    document.querySelectorAll('[data-map-layer]')
      .forEach(b => b.addEventListener(
        'change',
        () => {
          setText(
            'map-active-layers',
            getActiveLayers().length
          );

          emit('layers-changed', {
            layers: getActiveLayers()
          });
        }
      ));

    document.querySelectorAll('[data-expand]')
      .forEach(b => b.addEventListener(
        'click',
        () => expandPanel(b.dataset.expand)
      ));

    $('refresh-all')?.addEventListener(
      'click', refreshAll
    );

    $('toggle-audio')?.addEventListener(
      'click', toggleAudio
    );

    $('fullscreen-toggle')?.addEventListener(
      'click',
      async () => {
        try {
          if (document.fullscreenElement) {
            await document.exitFullscreen();
          } else {
            await document.documentElement
              .requestFullscreen();
          }
        } catch (e) {
          notify(
            'FULLSCREEN// ' + e.message,
            'warning'
          );
        }
      }
    );

    document.addEventListener(
      'fullscreenchange',
      () => {
        setText(
          'fullscreen-toggle',
          document.fullscreenElement
            ? '[ EXIT FULLSCREEN ]'
            : '[ FULLSCREEN ]'
        );

        emit('panel-resized');
      }
    );

    $('close-event-dialog')?.addEventListener(
      'click',
      () => $('event-details-dialog').close()
    );

    document.addEventListener(
      'keydown',
      e => {
        if (
          e.key === 'Escape' &&
          !$('event-details-dialog')?.open
        ) {
          closeExpanded();
        }
      }
    );

    window.addEventListener(
      'online', networkStatus
    );

    window.addEventListener(
      'offline', networkStatus
    );

    setRegion(state.region);
    setNewsFilter(state.newsFilter);

    setText(
      'map-active-layers',
      getActiveLayers().length
    );

    updateAudioButton();
    networkStatus();

    status(
      'system-status',
      'ONLINE',
      'online'
    );

    updateFeeds();

    log('Control system online');

    emit('ready', { version: '1.0' });
  }

  window.WorldWatch = {
    version: '1.0',
    registerModule,
    reportModuleStatus,
    notify,
    updateBluf,
    showEventDetails,
    refreshAll,
    getRegion: () => state.region,
    getNewsFilter: () => state.newsFilter,
    getActiveLayers,
    utcTime: utc,
    shortUtc,
    log
  };

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
