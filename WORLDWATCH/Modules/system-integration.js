
/* ==============================================================
 WORLDWATCH // SYSTEMS INTEGRATION // PHASE 15
 FILE: modules/system-integration.js

 PURPOSE
   - Record health reports from existing data modules
   - Separate browser connectivity from module health
   - Show a shared operational diagnostics console
   - Provide a copyable diagnostic report
   - Prepare optional same-origin home-server API endpoints

 DOES NOT alter API traffic, security settings, or existing modules.
 Load immediately after script.js, BEFORE the data modules.
 ============================================================== */
(() => {
  'use strict';

  /* ============================================================
     CONFIGURATION FOR FUTURE HOME-SERVER DEPLOYMENT

     Keep empty while developing in Notepad / opening file://.

     When your home server implements the documented endpoints,
     change this to '/api'. The browser will then use endpoints
     on the SAME web-server origin (no hardcoded external domain).

     Required server routes if enabled:
       GET /api/conflict/articles?...
       GET /api/conflict/geo?...
       GET /api/maritime/vessels?...
       GET /api/infra/gdelt/doc?...
       GET /api/infra/gdelt/geo?...
       GET /api/infra/status/cloudflare
       GET /api/infra/status/github

     Existing AIR, NEWS, WEATHER and SPACE modules do NOT yet
     use these routes; they remain on their current data sources.
     Configuring '/api' does NOT create a backend automatically.
     ============================================================ */

  const DATA_HUB_ROOT = '';

  const WW = window.WorldWatch;
  if (!WW || typeof WW.registerModule !== 'function' ||
      typeof WW.reportModuleStatus !== 'function') {
    console.warn('[WORLDWATCH][SYSTEMS] Core controller missing');
    return;
  }

  const records = new Map();
  const SYSTEM_ID = 'worldwatch-systems-integration';
  const updatedAt = { lastReport: null, lastRequested: null };
  const $ = id => document.getElementById(id);
  let mounted = false;
  let busy = false;
  let updateQueued = false;

  const LABELS = {
    map: 'GEO / SEISMIC',
    weather: 'GEO / WEATHER',
    cyclones: 'GEO / CYCLONES',
    news: 'INTEL / NEWSWIRE',
    disasters: 'WATCH / DISASTERS',
    disaster: 'WATCH / DISASTERS',
    solar: 'WATCH / SOLAR',
    spaceweather: 'WATCH / SOLAR',
    aviation: 'AIR / ADS-B',
    maritime: 'SEA / AIS',
    orbital: 'SPACE / ORBITAL',
    space: 'SPACE / ORBITAL',
    conflict: 'WATCH / CONFLICT',
    infrastructure: 'INFRA / SERVICES',
    communications: 'COMMS / NETWORK',
    comms: 'COMMS / NETWORK'
  };

  function node(tag, className = '', value) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (value !== undefined) n.textContent = String(value);
    return n;
  }

  function setText(id, value) {
    const n = $(id);
    if (n) n.textContent = String(value);
  }

  function stamp(date) {
    return date instanceof Date && !Number.isNaN(date.getTime())
      ? date.toISOString().slice(0, 19).replace('T', ' ') + 'Z'
      : '--';
  }

  function elapsed(date) {
    if (!date) return 'NEVER';
    const secs = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (secs < 60) return secs + 's AGO';
    if (secs < 3600) return Math.floor(secs / 60) + 'm AGO';
    if (secs < 86400) return Math.floor(secs / 3600) + 'h AGO';
    return Math.floor(secs / 86400) + 'd AGO';
  }

  function deployment() {
    if (location.protocol === 'file:') {
      return {
        label: 'LOCAL FILE MODE',
        message: 'Browser file:// mode. Some remote APIs and YouTube embeds may be blocked.',
        level: 'warning'
      };
    }
    if (location.protocol === 'https:') {
      return {
        label: 'HTTPS WEB SERVER',
        message: 'Page is served over HTTPS. External API permissions still vary by provider.',
        level: 'online'
      };
    }
    if (location.protocol === 'http:') {
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
      return {
        label: local ? 'LOCAL WEB SERVER' : 'HTTP WEB SERVER',
        message: local
          ? 'Page is served over loopback HTTP. API access depends on the remote provider.'
          : 'HTTP access is not encrypted. Use HTTPS before allowing remote family access.',
        level: local ? 'online' : 'warning'
      };
    }
    return { label: 'UNKNOWN HOST MODE', message: 'Unrecognized page protocol.', level: 'warning' };
  }

  /* Apply optional same-origin URLs before other modules evaluate. */
  function configureDataHub() {
    const root = DATA_HUB_ROOT.trim().replace(/\/+$/, '');
    if (!root) return;
    // A root-relative path avoids exposing credentials or binding
    // a private dashboard to a third-party host by mistake.
    if (!/^\/(?!\/)[a-zA-Z0-9/_-]+$/.test(root)) {
      console.warn('[WORLDWATCH][SYSTEMS] Invalid DATA_HUB_ROOT. Expected /api');
      return;
    }
    window.WORLDWATCH_CONFLICT_API = root + '/conflict';
    window.WORLDWATCH_MARITIME_API = root + '/maritime/vessels';
    window.WORLDWATCH_INFRA_API = root + '/infra';
  }
  configureDataHub();

  /* ============================================================
     WATCH EXISTING MODULE REPORTS

     The original controller remains authoritative. We only
     observe successful registrations and status reports.
     ============================================================ */

  const originalRegister = WW.registerModule;
  const originalReport = WW.reportModuleStatus;

  WW.registerModule = function(name, definition) {
    const result = originalRegister.call(WW, name, definition);
    records.set(name, {
      name,
      status: 'standby',
      error: '',
      registered: new Date(),
      lastReport: null,
      lastOnline: null
    });
    queueUpdate();
    return result;
  };

  WW.reportModuleStatus = function(name, status, detail = '') {
    const result = originalReport.call(WW, name, status, detail);
    const rec = records.get(name);
    if (rec && ['online', 'standby', 'stale', 'offline', 'error'].includes(status)) {
      rec.status = status;
      rec.error = String(detail || '').slice(0, 350);
      rec.lastReport = new Date();
      if (status === 'online') rec.lastOnline = rec.lastReport;
      updatedAt.lastReport = rec.lastReport;
      queueUpdate();
    }
    return result;
  };

  function queueUpdate() {
    if (!mounted || updateQueued) return;
    updateQueued = true;
    requestAnimationFrame(() => {
      updateQueued = false;
      render();
    });
  }

  function summary() {
    const list = [...records.values()];
    return {
      total: list.length,
      online: list.filter(r => r.status === 'online').length,
      attention: list.filter(r => ['stale', 'error', 'offline'].includes(r.status)).length,
      pending: list.filter(r => r.status === 'standby').length
    };
  }

  function orderedRecords() {
    const priority = { error: 0, offline: 1, stale: 2, standby: 3, online: 4 };
    return [...records.values()].sort((a, b) =>
      (priority[a.status] ?? 5) - (priority[b.status] ?? 5) ||
      (LABELS[a.name] || a.name).localeCompare(LABELS[b.name] || b.name)
    );
  }

  function buildReport() {
    const s = summary();
    const lines = [
      'WORLDWATCH // SYSTEMS DIAGNOSTIC REPORT',
      'GENERATED// ' + stamp(new Date()),
      'PAGE MODE// ' + deployment().label,
      'BROWSER ONLINE FLAG// ' + (navigator.onLine ? 'TRUE' : 'FALSE') + ' (NOT PROOF OF API ACCESS)',
      'DATA HUB// ' + (DATA_HUB_ROOT ? 'CONFIGURED - NOT AUTOMATICALLY VERIFIED' : 'NOT CONFIGURED'),
      'ACTIVE REGION// ' + (typeof WW.getRegion === 'function' ? WW.getRegion() : 'UNKNOWN'),
      'MODULES// ' + s.online + ' ONLINE / ' + s.total + ' REGISTERED',
      'ATTENTION// ' + s.attention,
      'PENDING// ' + s.pending,
      'LAST STATUS REPORT// ' + stamp(updatedAt.lastReport),
      '--------------------------------------------------'
    ];
    orderedRecords().forEach(r => {
      lines.push((LABELS[r.name] || r.name.toUpperCase()) + ' [' + r.name + ']');
      lines.push('  STATE: ' + r.status.toUpperCase());
      lines.push('  LAST ONLINE: ' + stamp(r.lastOnline));
      lines.push('  LAST REPORT: ' + stamp(r.lastReport));
      if (r.error) lines.push('  DETAIL: ' + r.error.replace(/[\r\n]+/g, ' '));
    });
    lines.push('NOTE// Provider/network/CORS failures require separate validation.');
    lines.push('NOTE// This report intentionally excludes full URLs, passwords and API keys.');
    return lines.join('\n');
  }

  async function copyReport() {
    const text = buildReport();
    try {
      if (!navigator.clipboard?.writeText) throw Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
      setText('ww-sys-message', 'DIAGNOSTICS COPIED TO CLIPBOARD');
      return;
    } catch (_) {
      // Restricted browsers may block the Clipboard API, especially file://.
      const textarea = $('ww-sys-report');
      if (textarea) {
        textarea.hidden = false;
        textarea.value = text;
        textarea.focus();
        textarea.select();
        setText('ww-sys-message', 'REPORT SELECTED — PRESS CTRL+C TO COPY');
      }
    }
  }

  async function refreshAll() {
    if (busy || typeof WW.refreshAll !== 'function') return;
    busy = true;
    updatedAt.lastRequested = new Date();
    const btn = $('ww-sys-refresh');
    if (btn) btn.disabled = true;
    setText('ww-sys-message', 'SYSTEM REFRESH REQUESTED — CHECK MODULE STATUSES');
    try {
      await WW.refreshAll();
      setText('ww-sys-message', 'REFRESH CYCLE ENDED — REVIEW FEED STATUS BELOW');
    } catch (e) {
      setText('ww-sys-message', 'REFRESH REQUEST FAILED: ' + String(e?.message || e).slice(0, 100));
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
      render();
    }
  }

  function css() {
    if ($('ww-sys-css')) return;
    const style = node('style');
    style.id = 'ww-sys-css';
    style.textContent = `
      #${SYSTEM_ID}{grid-column:1/-1;display:block;min-width:0;width:100%;height:auto!important;min-height:0!important;
        overflow:visible!important;border:1px solid #315b3e;background:#07130c;color:#c5dccb;
        font:11px/1.5 Consolas,'Courier New',monospace}
      #${SYSTEM_ID} *{box-sizing:border-box}
      #${SYSTEM_ID} .ww-sys-head{display:flex;align-items:center;justify-content:space-between;gap:12px;
        padding:9px 12px;background:#0c1b11;border-bottom:1px solid #315b3e;flex-wrap:wrap}
      #${SYSTEM_ID} .ww-sys-head h2{margin:0;color:#a0ffb9;font-size:12px;letter-spacing:.8px}
      #${SYSTEM_ID} .ww-sys-body{padding:11px 12px}
      #${SYSTEM_ID} .ww-sys-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}
      #${SYSTEM_ID} .ww-sys-metric{padding:9px;border:1px solid #315b3e;background:#0a1b10;min-width:0}
      #${SYSTEM_ID} .ww-sys-metric small{display:block;color:#8da895;font-size:10px;letter-spacing:.35px}
      #${SYSTEM_ID} .ww-sys-metric strong{display:block;color:#a0ffb9;font-size:19px;line-height:1.35}
      #${SYSTEM_ID} .ww-sys-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:10px 0}
      #${SYSTEM_ID} .ww-sys-chip{border:1px solid #315b3e;background:#0a1b10;padding:4px 7px;color:#a0ffb9}
      #${SYSTEM_ID} .ww-sys-chip.warning{border-color:#80632a;color:#e8bf62}
      #${SYSTEM_ID} .ww-sys-chip.error{border-color:#934d4d;color:#f29b9b}
      #${SYSTEM_ID} .ww-sys-button{font:700 10px Consolas,'Courier New',monospace;background:#102217;color:#73db94;
        border:1px solid #315b3e;padding:7px 10px;cursor:pointer}
      #${SYSTEM_ID} .ww-sys-button:hover:not(:disabled){border-color:#73db94;background:#173523}
      #${SYSTEM_ID} .ww-sys-button:disabled{cursor:wait;color:#8da895}
      #${SYSTEM_ID} .ww-sys-note{color:#8da895;overflow-wrap:anywhere}
      #${SYSTEM_ID} .ww-sys-message{color:#e8bf62;min-height:14px}
      #${SYSTEM_ID} details{margin-top:9px;border-top:1px solid #315b3e;padding-top:9px}
      #${SYSTEM_ID} summary{cursor:pointer;color:#e8bf62;font-weight:700;user-select:none}
      #${SYSTEM_ID} .ww-sys-table{display:grid;grid-template-columns:minmax(155px,1.1fr) 105px 125px minmax(160px,2fr);margin-top:9px}
      #${SYSTEM_ID} .ww-sys-cell{min-width:0;padding:7px;border-bottom:1px dashed #315b3e;overflow-wrap:anywhere}
      #${SYSTEM_ID} .ww-sys-th{font-weight:700;color:#8da895;background:#0a1b10;border-bottom:1px solid #315b3e}
      #${SYSTEM_ID} .ww-sys-status-online{color:#73db94}
      #${SYSTEM_ID} .ww-sys-status-standby{color:#8da895}
      #${SYSTEM_ID} .ww-sys-status-stale{color:#e8bf62}
      #${SYSTEM_ID} .ww-sys-status-offline,#${SYSTEM_ID} .ww-sys-status-error{color:#f29b9b}
      #${SYSTEM_ID} .ww-sys-report{display:block;width:100%;min-height:170px;max-height:300px;resize:vertical;
        background:#040a06;border:1px solid #315b3e;color:#b5ffca;padding:8px;
        font:10px/1.5 Consolas,'Courier New',monospace;white-space:pre}
      #${SYSTEM_ID} .ww-sys-report[hidden]{display:none!important}
      @media(max-width:760px){
        #${SYSTEM_ID} .ww-sys-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
        #${SYSTEM_ID} .ww-sys-table{grid-template-columns:minmax(110px,1fr) 85px minmax(0,1.3fr)}
        #${SYSTEM_ID} .ww-sys-cell.ww-sys-last{display:none}
      }
    `;
    document.head.append(style);
  }

  function mount() {
    if (mounted) return;
    const shell = $('worldwatch-app');
    if (!shell || $(SYSTEM_ID)) return;
    css();
    const panel = node('section');
    panel.id = SYSTEM_ID;
    panel.setAttribute('aria-labelledby', 'ww-sys-heading');
    const head = node('header', 'ww-sys-head');
    const heading = node('h2', '', 'SYSTEMS// OPERATIONS & FEED HEALTH');
    heading.id = 'ww-sys-heading';
    const right = node('span', 'ww-sys-note', 'WORLDWATCH // SYSTEMS INTEGRATION V1');
    head.append(heading, right);
    panel.append(head);

    const body = node('div', 'ww-sys-body');
    const metrics = node('div', 'ww-sys-metrics');
    for (const [id, label] of [
      ['ww-sys-online', 'MODULES ONLINE'],
      ['ww-sys-total', 'MODULES REGISTERED'],
      ['ww-sys-attention', 'NEEDS ATTENTION'],
      ['ww-sys-pending', 'INITIALIZING']
    ]) {
      const card = node('div', 'ww-sys-metric');
      card.append(node('small', '', label));
      const value = node('strong', '', '--');
      value.id = id;
      card.append(value);
      metrics.append(card);
    }
    body.append(metrics);

    const line = node('div', 'ww-sys-row');
    for (const id of ['ww-sys-host', 'ww-sys-net', 'ww-sys-hub', 'ww-sys-region']) {
      const chip = node('span', 'ww-sys-chip', '--');
      chip.id = id;
      line.append(chip);
    }
    body.append(line);

    const actions = node('div', 'ww-sys-row');
    const refresh = node('button', 'ww-sys-button', '[ REFRESH ALL MODULES ]');
    refresh.id = 'ww-sys-refresh';
    refresh.type = 'button';
    refresh.addEventListener('click', refreshAll);
    const copy = node('button', 'ww-sys-button', '[ COPY DIAGNOSTICS ]');
    copy.type = 'button';
    copy.addEventListener('click', copyReport);
    actions.append(refresh, copy);
    body.append(actions);

    const msg = node('div', 'ww-sys-message', 'DIAGNOSTICS// STANDBY');
    msg.id = 'ww-sys-message';
    body.append(msg);
    const note = node('p', 'ww-sys-note');
    note.id = 'ww-sys-note';
    body.append(note);

    const detail = node('details');
    detail.append(node('summary', '', 'MODULE ROSTER // EXPAND DIAGNOSTICS'));
    const table = node('div', 'ww-sys-table');
    table.id = 'ww-sys-table';
    detail.append(table);
    body.append(detail);

    const report = node('textarea', 'ww-sys-report');
    report.id = 'ww-sys-report';
    report.setAttribute('aria-label', 'Diagnostic report for manual copying');
    report.readOnly = true;
    report.hidden = true;
    body.append(report);

    panel.append(body);
    const footer = shell.querySelector(':scope > .system-footer');
    if (footer) shell.insertBefore(panel, footer);
    else shell.append(panel);
    mounted = true;
    render();
  }

  function renderTable() {
    const table = $('ww-sys-table');
    if (!table) return;
    table.replaceChildren();
    for (const [label, cls] of [
      ['MODULE', ''], ['STATE', ''], ['LAST ONLINE', 'ww-sys-last'], ['DETAIL', '']
    ]) table.append(node('div', 'ww-sys-cell ww-sys-th ' + cls, label));
    const list = orderedRecords();
    if (!list.length) {
      const none = node('div', 'ww-sys-cell', 'No data modules have registered yet.');
      none.style.gridColumn = '1 / -1';
      table.append(none);
      return;
    }
    list.forEach(r => {
      table.append(node('div', 'ww-sys-cell', LABELS[r.name] || r.name.toUpperCase()));
      table.append(node('div', 'ww-sys-cell ww-sys-status-' + r.status, r.status.toUpperCase()));
      table.append(node('div', 'ww-sys-cell ww-sys-last', elapsed(r.lastOnline)));
      table.append(node('div', 'ww-sys-cell ww-sys-note', r.error || '—'));
    });
  }

  function render() {
    if (!mounted) return;
    const s = summary();
    setText('ww-sys-online', s.online);
    setText('ww-sys-total', s.total);
    setText('ww-sys-attention', s.attention);
    setText('ww-sys-pending', s.pending);

    const mode = deployment();
    const host = $('ww-sys-host');
    if (host) {
      host.textContent = 'HOST// ' + mode.label;
      host.className = 'ww-sys-chip' + (mode.level === 'warning' ? ' warning' : '');
    }
    const online = Boolean(navigator.onLine);
    const net = $('ww-sys-net');
    if (net) {
      net.textContent = 'BROWSER// ' + (online ? 'NETWORK FLAG ON' : 'NETWORK FLAG OFF');
      net.className = 'ww-sys-chip' + (online ? '' : ' error');
    }
    setText('ww-sys-hub', 'DATA HUB// ' + (DATA_HUB_ROOT ? 'CONFIGURED / UNTESTED' : 'DIRECT MODE'));
    setText('ww-sys-region', 'REGION// ' + (WW.getRegion?.() || 'GLOBAL').toUpperCase());
    setText('ww-sys-note', mode.message + ' Browser network flag does not prove individual feeds are reachable. ' +
      'Last module report: ' + stamp(updatedAt.lastReport) + '. ' +
      'Module timestamps indicate status reports, not independently verified sensor observations.');
    renderTable();
  }

  const start = () => {
    mount();
    document.addEventListener('worldwatch:region-changed', queueUpdate);
    document.addEventListener('worldwatch:refresh-complete', queueUpdate);
    window.addEventListener('online', queueUpdate);
    window.addEventListener('offline', queueUpdate);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) queueUpdate();
    });
    window.setInterval(() => {
      if (!document.hidden) queueUpdate();
    }, 15000);
    console.info('[WORLDWATCH][SYSTEMS] Passive health integration active');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
