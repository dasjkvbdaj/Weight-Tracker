(function () {
  'use strict';

  var STORAGE_KEY = 'weightTracker.v1';
  var THEME_KEY = 'weightTracker.theme';
  var BACKUP_FILENAME = 'my-weight-tracker-backup.json';
  var MIN_KG = 1, MAX_KG = 500;

  // ---------- State ----------
  var records = [];            // always sorted by timestamp ascending
  var storageOk = true;
  var saveLock = false;
  var filter = { mode: 'all', date: todayStr(), from: todayStr(), to: todayStr() };
  var editingId = null;

  // ---------- Helpers: dates ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function localDateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayStr() { return localDateStr(new Date()); }
  function parseLocal(s) {
    var p = s.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function isValidDateStr(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    return localDateStr(parseLocal(s)) === s;
  }
  function formatLong(s) {
    return parseLocal(s).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  function formatShort(s) {
    return parseLocal(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function weekdayOf(s) { return parseLocal(s).toLocaleDateString('en-US', { weekday: 'long' }); }
  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  function addDays(s, n) {
    var d = parseLocal(s);
    d.setDate(d.getDate() + n);
    return localDateStr(d);
  }
  function weekRange(s) {            // Monday to Sunday
    var d = parseLocal(s);
    var offset = (d.getDay() + 6) % 7;
    var start = addDays(s, -offset);
    return { from: start, to: addDays(start, 6) };
  }
  function monthRange(s) {
    var d = parseLocal(s);
    var first = new Date(d.getFullYear(), d.getMonth(), 1);
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { from: localDateStr(first), to: localDateStr(last) };
  }
  function shiftMonth(s, n) {
    var d = parseLocal(s);
    return localDateStr(new Date(d.getFullYear(), d.getMonth() + n, 1));
  }

  // ---------- Helpers: numbers ----------
  function round2(n) { return Math.round(n * 100) / 100; }
  function fmt(n) {
    var r = round2(n);
    return (Math.round(r * 10) / 10 === r) ? r.toFixed(1) : r.toFixed(2);
  }
  function fmtDelta(n) {
    var r = round2(n);
    if (r === 0) return '0.0 kg';
    return (r > 0 ? '+' : '−') + fmt(Math.abs(r)) + ' kg';
  }
  function deltaClass(n) { var r = round2(n); return r < 0 ? 'down' : r > 0 ? 'up' : 'flat'; }
  function deltaArrow(n) { var r = round2(n); return r < 0 ? '▼ ' : r > 0 ? '▲ ' : '▬ '; }
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function parseWeight(raw) {
    var s = String(raw == null ? '' : raw).trim().replace(',', '.');
    if (s === '') return { error: 'Please enter your weight.' };
    var n = Number(s);
    if (!isFinite(n)) return { error: 'Please enter a valid number.' };
    if (n < MIN_KG || n > MAX_KG) return { error: 'Weight must be between ' + MIN_KG + ' and ' + MAX_KG + ' kg.' };
    return { value: round2(n) };
  }

  // ---------- Storage ----------
  function sortRecords(list) {
    return list.slice().sort(function (a, b) {
      var d = new Date(a.timestamp) - new Date(b.timestamp);
      return d !== 0 ? d : (a.id < b.id ? -1 : 1);
    });
  }
  function validRecord(r) {
    return r && typeof r === 'object' &&
      typeof r.id === 'string' && r.id.length > 0 &&
      typeof r.weight === 'number' && isFinite(r.weight) && r.weight >= MIN_KG && r.weight <= MAX_KG &&
      typeof r.timestamp === 'string' && !isNaN(new Date(r.timestamp).getTime()) &&
      isValidDateStr(r.date);
  }
  function normalizeRecord(r) {
    var out = {
      id: r.id,
      weight: round2(r.weight),
      timestamp: r.timestamp,
      date: r.date,
      weekday: typeof r.weekday === 'string' && r.weekday ? r.weekday : weekdayOf(r.date)
    };
    if (typeof r.editedAt === 'string') out.editedAt = r.editedAt;
    return out;
  }
  function writeRecords(list) {
    // Throws on failure; callers keep the previous state when it does.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, records: list }));
  }
  function showBanner(msg) {
    var b = document.getElementById('banner');
    if (!b) return;
    if (msg) { b.textContent = msg; b.hidden = false; } else { b.hidden = true; }
  }
  function loadRecords() {
    var raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      storageOk = false;
      showBanner('Browser storage is unavailable, so measurements cannot be saved or loaded here. Check that cookies/site data are allowed.');
      return [];
    }
    if (raw === null) return [];                 // first run: nothing to restore, nothing is written
    try {
      var data = JSON.parse(raw);
      var list = Array.isArray(data) ? data : data && data.records;
      if (!Array.isArray(list)) throw new Error('bad shape');
      var ok = [], bad = 0;
      list.forEach(function (r) { if (validRecord(r)) ok.push(normalizeRecord(r)); else bad++; });
      if (bad) preserveRaw(raw, bad + ' saved entr' + (bad === 1 ? 'y was' : 'ies were') + ' unreadable and skipped. The original data was kept as a safety copy.');
      return sortRecords(ok);
    } catch (e) {
      preserveRaw(raw, 'Your saved data could not be read (it may be corrupted). A copy of it was kept in this browser. You can restore a backup with Import Backup.');
      return [];
    }
  }
  function preserveRaw(raw, message) {
    try {
      localStorage.setItem(STORAGE_KEY + '.unreadable.' + Date.now(), raw);
      showBanner(message);
    } catch (e) {
      // Could not even copy it: refuse to overwrite the original.
      storageOk = false;
      showBanner('Your saved data could not be read and no safety copy could be made, so saving is disabled to protect it. Export is unavailable; please contact support or clear data only if you have a backup.');
    }
  }
  function commit(next) {
    // Persist first, then update memory. Returns true on success.
    if (!storageOk) { toast('Cannot save: browser storage is unavailable.', true); return false; }
    var sorted = sortRecords(next);
    try {
      writeRecords(sorted);
    } catch (e) {
      var quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
      toast(quota ? 'Storage is full. Export a backup and free up space.' : 'Could not save to browser storage.', true);
      return false;
    }
    records = sorted;
    return true;
  }

  // ---------- Stats ----------
  function changeFor(list, index) {
    return index > 0 ? round2(list[index].weight - list[index - 1].weight) : null;
  }
  function computeStats(list) {
    var n = list.length;
    if (!n) return { count: 0 };
    var latest = list[n - 1], first = list[0];
    return {
      count: n,
      latest: latest,
      first: first,
      total: round2(latest.weight - first.weight),
      prevChange: n > 1 ? round2(latest.weight - list[n - 2].weight) : null
    };
  }
  function latestPerDay(list) {
    var map = {};
    list.forEach(function (r) { map[r.date] = r; });   // list is ascending, so last wins
    return map;
  }

  // ---------- DOM helpers ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  var toastTimer;
  function toast(msg, isError) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, isError ? 5000 : 2500);
  }

  // ---------- Rendering: home ----------
  function renderToday() { $('today').textContent = formatLong(todayStr()); }

  function renderHome() {
    var s = computeStats(records);
    var w = $('latest-weight'), meta = $('latest-meta'), ch = $('latest-change'), stats = $('stats');
    stats.textContent = '';
    ch.className = 'change';
    if (!s.count) {
      w.textContent = '—';
      meta.textContent = 'Enter your first weight above to get started.';
      ch.textContent = '';
      $('chart-wrap').hidden = true;
      return;
    }
    w.textContent = fmt(s.latest.weight) + ' kg';
    meta.textContent = formatLong(s.latest.date) + ' · ' + formatTime(s.latest.timestamp);
    if (s.prevChange === null) {
      ch.textContent = 'Add another measurement to see your change.';
      ch.className = 'change flat';
    } else {
      ch.className = 'change ' + deltaClass(s.prevChange);
      ch.textContent = deltaArrow(s.prevChange) + fmtDelta(s.prevChange) + ' since previous measurement';
    }
    function stat(k, v, cls) {
      var d = el('div', 'stat');
      var vv = el('p', 'v' + (cls ? ' ' + cls : ''), v);
      d.appendChild(vv); d.appendChild(el('p', 'k', k));
      stats.appendChild(d);
    }
    stat('First recorded', fmt(s.first.weight) + ' kg');
    stat('Measurements', String(s.count));
    if (s.count > 1) {
      var word = s.total < 0 ? 'lost' : s.total > 0 ? 'gained' : 'change';
      stat('Total since first (' + word + ')', deltaArrow(s.total) + fmtDelta(s.total), 'delta ' + deltaClass(s.total));
    } else {
      stat('Total since first', 'Need 2+ entries');
    }
    stat('Since', formatShort(s.first.date));
    renderChart();
  }

  function renderChart() {
    var wrap = $('chart-wrap'), svg = $('chart');
    if (records.length < 2) { wrap.hidden = true; return; }
    wrap.hidden = false;
    var W = 320, H = 140, padL = 8, padR = 8, padT = 16, padB = 16;
    var ts = records.map(function (r) { return new Date(r.timestamp).getTime(); });
    var ws = records.map(function (r) { return r.weight; });
    var t0 = Math.min.apply(null, ts), t1 = Math.max.apply(null, ts);
    var wMin = Math.min.apply(null, ws), wMax = Math.max.apply(null, ws);
    if (wMax === wMin) { wMax += 0.5; wMin -= 0.5; }
    function x(t) { return t1 === t0 ? W / 2 : padL + (t - t0) / (t1 - t0) * (W - padL - padR); }
    function y(v) { return padT + (wMax - v) / (wMax - wMin) * (H - padT - padB); }
    var NS = 'http://www.w3.org/2000/svg';
    svg.textContent = '';
    var pts = records.map(function (r, i) { return x(ts[i]).toFixed(1) + ',' + y(r.weight).toFixed(1); }).join(' ');
    var line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', pts);
    line.setAttribute('class', 'line');
    svg.appendChild(line);
    records.forEach(function (r, i) {
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', x(ts[i]).toFixed(1));
      c.setAttribute('cy', y(r.weight).toFixed(1));
      c.setAttribute('r', records.length > 40 ? '1.5' : '3');
      c.setAttribute('class', 'dot');
      svg.appendChild(c);
    });
    function label(txt, yy, anchor) {
      var t = document.createElementNS(NS, 'text');
      t.setAttribute('x', anchor === 'end' ? W - padR : padL);
      t.setAttribute('y', yy);
      t.setAttribute('text-anchor', anchor);
      t.setAttribute('font-size', '10');
      t.setAttribute('fill', 'currentColor');
      t.setAttribute('opacity', '0.6');
      t.textContent = txt;
      svg.appendChild(t);
    }
    label(fmt(Math.max.apply(null, ws)) + ' kg', 10, 'start');
    label(fmt(Math.min.apply(null, ws)) + ' kg', H - 3, 'start');
    label(formatShort(records[0].date) + ' → ' + formatShort(records[records.length - 1].date), H - 3, 'end');
  }

  // ---------- Rendering: history ----------
  function filterBounds() {
    switch (filter.mode) {
      case 'today': var t = todayStr(); return { from: t, to: t, day: true };
      case 'date': return { from: filter.date, to: filter.date, day: true };
      case 'week': var w = weekRange(filter.date); return { from: w.from, to: w.to };
      case 'month': var m = monthRange(filter.date); return { from: m.from, to: m.to };
      case 'range':
        var a = filter.from, b = filter.to;
        return a <= b ? { from: a, to: b } : { from: b, to: a };
      default: return null;
    }
  }

  function stepButton(label, aria, fn) {
    var b = el('button', 'step', label);
    b.type = 'button';
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', fn);
    return b;
  }
  function dateInput(value, onChange, aria) {
    var i = document.createElement('input');
    i.type = 'date';
    i.value = value;
    i.setAttribute('aria-label', aria);
    i.addEventListener('change', function () { if (isValidDateStr(i.value)) onChange(i.value); });
    return i;
  }

  function renderFilterInputs() {
    var box = $('filter-inputs');
    box.textContent = '';
    var m = filter.mode;
    function setDate(v) { filter.date = v; renderFilterInputs(); renderHistory(); }
    if (m === 'date') {
      box.appendChild(stepButton('◀', 'Previous day', function () { setDate(addDays(filter.date, -1)); }));
      box.appendChild(dateInput(filter.date, setDate, 'Date'));
      box.appendChild(stepButton('▶', 'Next day', function () { setDate(addDays(filter.date, 1)); }));
    } else if (m === 'week') {
      box.appendChild(stepButton('◀', 'Previous week', function () { setDate(addDays(filter.date, -7)); }));
      box.appendChild(dateInput(filter.date, setDate, 'Any day in the week'));
      box.appendChild(stepButton('▶', 'Next week', function () { setDate(addDays(filter.date, 7)); }));
      var w = weekRange(filter.date);
      box.appendChild(el('p', 'muted small', 'Week: ' + formatShort(w.from) + ' – ' + formatShort(w.to) + ' (Mon–Sun)'));
    } else if (m === 'month') {
      box.appendChild(stepButton('◀', 'Previous month', function () { setDate(shiftMonth(filter.date, -1)); }));
      box.appendChild(dateInput(filter.date, setDate, 'Any day in the month'));
      box.appendChild(stepButton('▶', 'Next month', function () { setDate(shiftMonth(filter.date, 1)); }));
      box.appendChild(el('p', 'muted small', parseLocal(filter.date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })));
    } else if (m === 'range') {
      box.appendChild(dateInput(filter.from, function (v) { filter.from = v; renderHistory(); }, 'From date'));
      box.appendChild(dateInput(filter.to, function (v) { filter.to = v; renderHistory(); }, 'To date'));
    } else if (m === 'today') {
      box.appendChild(el('p', 'muted small', formatLong(todayStr())));
    }
  }

  function renderHistory() {
    var list = $('history-list'), count = $('history-count');
    list.textContent = '';
    var b = filterBounds();
    var shown = [];
    records.forEach(function (r, i) {
      if (!b || (r.date >= b.from && r.date <= b.to)) shown.push({ r: r, change: changeFor(records, i) });
    });
    if (!shown.length) {
      count.textContent = '';
      var msg = !records.length ? 'No measurements yet. Enter your first weight on the Home tab.'
        : (b && b.day) ? 'No weight recorded for this day.'
          : 'No measurements in this period.';
      list.appendChild(el('p', 'empty', msg));
      return;
    }
    count.textContent = shown.length + ' measurement' + (shown.length === 1 ? '' : 's');
    var groups = [];
    shown.slice().reverse().forEach(function (item) {         // newest first
      var g = groups[groups.length - 1];
      if (!g || g.date !== item.r.date) { g = { date: item.r.date, items: [] }; groups.push(g); }
      g.items.push(item);
    });
    groups.forEach(function (g) {
      var wrap = el('div', 'day-group');
      wrap.appendChild(el('p', 'day-head', formatLong(g.date) + (g.items.length > 1 ? ' · ' + g.items.length + ' entries' : '')));
      g.items.forEach(function (item) {
        var row = el('div', 'entry-row');
        row.setAttribute('data-id', item.r.id);
        var main = el('div', 'entry-main');
        main.appendChild(el('p', 'entry-w', fmt(item.r.weight) + ' kg'));
        main.appendChild(el('p', 'entry-t', formatTime(item.r.timestamp) + (item.r.editedAt ? ' · edited' : '')));
        row.appendChild(main);
        var d = el('span', 'delta');
        if (item.change === null) { d.className = 'delta flat'; d.textContent = '—'; }
        else { d.className = 'delta ' + deltaClass(item.change); d.textContent = fmtDelta(item.change); }
        row.appendChild(d);
        var act = el('div', 'entry-actions');
        var eb = el('button', null, 'Edit'); eb.type = 'button';
        eb.addEventListener('click', function () { openEdit(item.r.id); });
        var db = el('button', 'danger', 'Delete'); db.type = 'button';
        db.addEventListener('click', function () { askDelete(item.r.id); });
        act.appendChild(eb); act.appendChild(db);
        row.appendChild(act);
        wrap.appendChild(row);
      });
      list.appendChild(wrap);
    });
  }

  function renderAll() { renderToday(); renderHome(); renderFilterInputs(); renderHistory(); }

  // ---------- Actions ----------
  function addRecord(weight, now) {
    now = now || new Date();
    var date = localDateStr(now);
    var rec = { id: newId(), weight: weight, timestamp: now.toISOString(), date: date, weekday: weekdayOf(date) };
    if (!commit(records.concat([rec]))) return null;
    return rec;
  }

  function onSave(ev) {
    ev.preventDefault();
    if (saveLock) return;
    var input = $('weight-input'), err = $('form-error');
    var res = parseWeight(input.value);
    if (res.error) { err.textContent = res.error; err.hidden = false; input.focus(); return; }
    err.hidden = true;
    saveLock = true;
    var btn = $('save-btn');
    btn.disabled = true;
    setTimeout(function () { saveLock = false; btn.disabled = false; }, 900);   // guards double-taps
    var rec = addRecord(res.value);
    if (rec) {
      input.value = '';
      renderHome(); renderHistory();
      toast('Saved ' + fmt(rec.weight) + ' kg — ' + rec.weekday + ', ' + formatShort(rec.date));
    }
  }

  function openEdit(id) {
    var r = records.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    editingId = id;
    $('edit-meta').textContent = formatLong(r.date) + ' · ' + formatTime(r.timestamp) + ' (date and time stay the same)';
    $('edit-weight').value = r.weight;
    $('edit-error').hidden = true;
    $('edit-dialog').showModal();
    $('edit-weight').focus();
  }
  function onEditSave(ev) {
    ev.preventDefault();
    var res = parseWeight($('edit-weight').value);
    if (res.error) { $('edit-error').textContent = res.error; $('edit-error').hidden = false; return; }
    var editedAt = new Date().toISOString();
    var next = records.map(function (r) {
      if (r.id !== editingId) return r;
      var copy = {}; for (var k in r) copy[k] = r[k];
      copy.weight = res.value; copy.editedAt = editedAt;
      return copy;
    });
    if (commit(next)) {
      $('edit-dialog').close();
      renderHome(); renderHistory();
      toast('Measurement updated.');
    }
  }

  function askChoice(title, text, buttons) {
    // buttons: [{label, value, cls}] -> resolves with the chosen value
    return new Promise(function (resolve) {
      var dlg = $('confirm-dialog');
      $('confirm-title').textContent = title;
      $('confirm-text').textContent = text;
      var box = $('confirm-actions');
      box.textContent = '';
      var done = false;
      function finish(v) { if (done) return; done = true; dlg.close(); resolve(v); }
      buttons.forEach(function (b) {
        var btn = el('button', b.cls || null, b.label);
        btn.type = 'button';
        btn.addEventListener('click', function () { finish(b.value); });
        box.appendChild(btn);
      });
      dlg.addEventListener('cancel', function () { finish(null); }, { once: true });
      dlg.showModal();
    });
  }

  function askDelete(id) {
    var r = records.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    askChoice('Delete this measurement?',
      fmt(r.weight) + ' kg on ' + formatLong(r.date) + ' at ' + formatTime(r.timestamp) + '. This cannot be undone.',
      [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, cls: 'danger' }]
    ).then(function (yes) {
      if (!yes) return;
      if (commit(records.filter(function (x) { return x.id !== id; }))) {
        renderHome(); renderHistory();
        toast('Measurement deleted.');
      }
    });
  }

  // ---------- Backup ----------
  function buildBackup() {
    return { app: 'my-weight-tracker', version: 1, exportedAt: new Date().toISOString(), records: records };
  }
  function exportBackup() {
    if (!records.length) { toast('Nothing to export yet.', true); return; }
    try {
      var blob = new Blob([JSON.stringify(buildBackup(), null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = BACKUP_FILENAME;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('Backup exported (' + records.length + ' records).');
    } catch (e) {
      toast('Could not create the backup file.', true);
    }
  }
  function parseBackup(text) {
    // Returns {records} or {error}. Nothing is modified here.
    var data;
    try { data = JSON.parse(text); } catch (e) { return { error: 'This file is not valid JSON.' }; }
    var list = Array.isArray(data) ? data : (data && data.records);
    if (!Array.isArray(list)) return { error: 'This does not look like a weight tracker backup (no records list).' };
    var out = [], seen = {};
    for (var i = 0; i < list.length; i++) {
      if (!validRecord(list[i])) return { error: 'Record #' + (i + 1) + ' is invalid or incomplete. Nothing was imported.' };
      if (seen[list[i].id]) return { error: 'Record #' + (i + 1) + ' has a duplicate ID. Nothing was imported.' };
      seen[list[i].id] = true;
      out.push(normalizeRecord(list[i]));
    }
    return { records: out };
  }
  function mergeRecords(current, incoming) {
    var ids = {};
    current.forEach(function (r) { ids[r.id] = true; });
    var added = incoming.filter(function (r) { return !ids[r.id]; });
    return { merged: current.concat(added), added: added.length };
  }
  function importText(text) {
    var parsed = parseBackup(text);
    if (parsed.error) { toast(parsed.error, true); return Promise.resolve(false); }
    var inc = parsed.records;
    if (!inc.length) { toast('The backup file contains no records.', true); return Promise.resolve(false); }
    var info = inc.length + ' record' + (inc.length === 1 ? '' : 's') + ' in the backup; ' + records.length + ' currently saved.';
    var choices = !records.length
      ? [{ label: 'Cancel', value: null }, { label: 'Import', value: 'replace', cls: 'primary' }]
      : [{ label: 'Cancel', value: null }, { label: 'Replace all', value: 'replace', cls: 'danger' }, { label: 'Merge (keep both)', value: 'merge', cls: 'primary' }];
    return askChoice('Import backup?', info + (records.length ? ' Merge adds only records that are not already here. Replace deletes your current records first.' : ''), choices)
      .then(function (choice) {
        if (!choice) return false;
        var previous = records;
        var next, msg;
        if (choice === 'merge') {
          var m = mergeRecords(records, inc);
          next = m.merged;
          msg = 'Merged: ' + m.added + ' new record' + (m.added === 1 ? '' : 's') + ' added.';
        } else {
          next = inc;
          msg = 'Restored ' + inc.length + ' record' + (inc.length === 1 ? '' : 's') + '.';
          if (previous.length) {
            try { localStorage.setItem(STORAGE_KEY + '.beforeImport', JSON.stringify({ savedAt: new Date().toISOString(), records: previous })); } catch (e) { /* best effort */ }
          }
        }
        if (!commit(next)) return false;
        renderAll();
        toast(msg);
        return true;
      });
  }
  function onImportFile() {
    var f = $('import-file').files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () { importText(String(reader.result)); $('import-file').value = ''; };
    reader.onerror = function () { toast('Could not read that file.', true); $('import-file').value = ''; };
    reader.readAsText(f);
  }

  // ---------- Views, theme ----------
  function showView(name) {
    ['home', 'history'].forEach(function (v) { $('view-' + v).hidden = v !== name; });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('active', t.getAttribute('data-view') === name);
    });
    if (name === 'history') renderHistory();
  }
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    var b = document.getElementById('theme-toggle');
    if (b) b.textContent = t === 'dark' ? 'Light' : 'Dark';
  }
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
    applyTheme(saved === 'dark' ? 'dark' : 'light');
    $('theme-toggle').addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    });
  }

  // ---------- Init ----------
  function init() {
    initTheme();
    records = loadRecords();
    $('weight-form').addEventListener('submit', onSave);
    $('edit-form').addEventListener('submit', onEditSave);
    $('edit-cancel').addEventListener('click', function () { $('edit-dialog').close(); });
    $('export-btn').addEventListener('click', exportBackup);
    $('import-btn').addEventListener('click', function () { $('import-file').click(); });
    $('import-file').addEventListener('change', onImportFile);
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () { showView(t.getAttribute('data-view')); });
    });
    $('filter-mode').addEventListener('change', function (e) {
      filter.mode = e.target.value;
      if (filter.mode === 'date' || filter.mode === 'week' || filter.mode === 'month') filter.date = todayStr();
      if (filter.mode === 'range') { filter.to = todayStr(); filter.from = addDays(filter.to, -30); }
      renderFilterInputs(); renderHistory();
    });
    // Refresh the date header if the tab stays open past midnight.
    document.addEventListener('visibilitychange', function () { if (!document.hidden) renderToday(); });
    renderAll();
  }

  // Exposed for testing and debugging only.
  window.WeightTracker = {
    getRecords: function () { return records.slice(); },
    addRecord: addRecord,
    computeStats: computeStats,
    latestPerDay: latestPerDay,
    parseBackup: parseBackup,
    mergeRecords: mergeRecords,
    importText: importText,
    buildBackup: buildBackup,
    render: renderAll,
    STORAGE_KEY: STORAGE_KEY
  };

  init();
})();
