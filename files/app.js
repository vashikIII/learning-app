'use strict';

/* ================= State ================= */

const STORAGE_KEY = 'flashapp_state_v1';

function defaultState() {
  return { view: { page: 'topics' }, pins: [], openTopic: null, exercises: {}, log: [] };
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && typeof s === 'object') return Object.assign(defaultState(), s);
  } catch (e) { /* corrupted state -> start fresh */ }
  return defaultState();
}

const state = loadState();

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}

let manifest = null;
let pinMode = false;
let cur = null;      // {topic, file, rows, ex}
let picIdx = 0;

function exKey(topic, file) { return topic + '/' + file; }

function getEx(topic, file, total) {
  const k = exKey(topic, file);
  if (!state.exercises[k]) {
    state.exercises[k] = { learned: [], visible: [], noteOpen: [], rounds: 0, total: total || 0, lastStudied: null };
  }
  const ex = state.exercises[k];
  if (total) ex.total = total;
  ex.noteOpen = ex.noteOpen || [];
  return ex;
}

function progressOf(topic, file) {
  const ex = state.exercises[exKey(topic, file)];
  if (!ex || !ex.total) return 0;
  return Math.round(ex.learned.length / ex.total * 100);
}

function logEvent(type, topic, file, extra) {
  state.log.push(Object.assign({ t: new Date().toISOString(), type: type, topic: topic, file: file }, extra || {}));
  if (state.log.length > 500) state.log = state.log.slice(-500);
}

/* ================= CSV ================= */

function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
  if (!lines.length) return ',';
  let withSemi = 0;
  for (const l of lines) if (l.indexOf(';') !== -1) withSemi++;
  return withSemi >= lines.length / 2 ? ';' : ',';
}

function parseCSV(text) {
  const delim = detectDelimiter(text);
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') {
      inQ = true;
    } else if (c === delim) {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const out = rows.map(function (r) {
    return { q: (r[0] || '').trim(), a: (r[1] || '').trim(), n: (r[2] || '').trim() };
  }).filter(function (r) { return r.q && r.a; });
  if (out.length && out[0].q.toLowerCase() === 'question') out.shift();
  return out;
}

/* ================= Helpers ================= */

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function el(id) { return document.getElementById(id); }
const app = document.getElementById('app');

function niceName(folderOrFile) {
  return folderOrFile.replace(/\.csv$/i, '');
}

function dataUrl(topic, rel) {
  return 'data/' + encodeURIComponent(topic) + '/' + rel.split('/').map(encodeURIComponent).join('/');
}

function topicByFolder(folder) {
  return manifest.topics.find(function (t) { return t.folder === folder; });
}

/* ================= Init / routing ================= */

async function init() {
  try {
    const r = await fetch('files/manifest.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    manifest = await r.json();
  } catch (e) {
    app.innerHTML = '<div class="msg error">Nelze načíst <b>files/manifest.json</b>.<br>' +
      'Aplikace musí běžet přes web server (ne přímo ze souboru file://).<br>' +
      'Manifest vygenerujete příkazem:<br><code>python3 files/build_manifest.py</code></div>';
    return;
  }
  if (state.view && state.view.page === 'exercise') {
    const t = topicByFolder(state.view.topic);
    if (t && t.files.indexOf(state.view.file) !== -1) {
      openExercise(state.view.topic, state.view.file);
      return;
    }
  }
  showTopics();
}

/* ================= First page (topics) ================= */

function sortedTopics() {
  const pinned = [], rest = [];
  for (const t of manifest.topics) {
    (state.pins.indexOf(t.folder) !== -1 ? pinned : rest).push(t);
  }
  return pinned.concat(rest);
}

function showTopics() {
  state.view = { page: 'topics' };
  saveState();
  const topics = sortedTopics();
  let html = '<div class="header">' +
    '<button id="btnStats">Stats</button>' +
    '<button id="btnPin"' + (pinMode ? ' class="active"' : '') + '>Pin</button>' +
    '<a class="btn" href="files/help.html">Help</a>' +
    '</div>';
  if (pinMode) html += '<div class="pinhint">Pin mode: klepněte na téma pro připnutí / odepnutí. Ukončíte tlačítkem Pin.</div>';
  html += '<div class="topics">';
  if (!topics.length) html += '<div class="msg">Ve složce <b>data</b> nejsou žádná témata.</div>';
  for (const t of topics) {
    const pinned = state.pins.indexOf(t.folder) !== -1;
    html += '<button class="topic' + (pinned ? ' pinned' : '') + '" data-f="' + esc(t.folder) + '">' +
      (pinned ? '📌 ' : '') + esc(t.folder.replace(/_/g, ' ')) + '</button>';
    if (!pinMode && state.openTopic === t.folder) {
      html += '<div class="files">';
      for (const f of t.files) {
        html += '<button class="file" data-t="' + esc(t.folder) + '" data-file="' + esc(f) + '">' +
          esc(niceName(f)) + ' (' + progressOf(t.folder, f) + '%)</button>';
      }
      if (!t.files.length) html += '<div class="msg">Žádné CSV soubory.</div>';
      html += '</div>';
    }
  }
  html += '</div>';
  app.innerHTML = html;

  el('btnStats').onclick = showStats;
  el('btnPin').onclick = function () { pinMode = !pinMode; showTopics(); };
  app.querySelectorAll('.topic').forEach(function (b) {
    b.onclick = function () {
      const f = b.getAttribute('data-f');
      if (pinMode) {
        const i = state.pins.indexOf(f);
        if (i === -1) state.pins.push(f); else state.pins.splice(i, 1);
        saveState();
      } else {
        state.openTopic = (state.openTopic === f) ? null : f;
        saveState();
      }
      showTopics();
    };
  });
  app.querySelectorAll('.file').forEach(function (b) {
    b.onclick = function () {
      openExercise(b.getAttribute('data-t'), b.getAttribute('data-file'));
    };
  });
}

/* ================= Stats overlay ================= */

function showStats() {
  let rowsHtml = '';
  for (const t of manifest.topics) {
    for (const f of t.files) {
      const ex = state.exercises[exKey(t.folder, f)];
      if (!ex) continue;
      const last = ex.lastStudied ? ex.lastStudied.slice(0, 10) : '—';
      rowsHtml += '<tr><td>' + esc(niceName(f)) + '</td><td>' + progressOf(t.folder, f) + '%</td>' +
        '<td>' + ex.rounds + '</td><td>' + last + '</td></tr>';
    }
  }
  if (!rowsHtml) rowsHtml = '<tr><td colspan="4">Zatím žádné učení.</td></tr>';

  let logHtml = '';
  const names = { round: 'kolo dokončeno', reset: 'reset', done: '100 % hotovo' };
  const recent = state.log.slice(-30).reverse();
  for (const e of recent) {
    const when = e.t.slice(0, 16).replace('T', ' ');
    let detail = names[e.type] || e.type;
    if (e.type === 'round') detail += ' (uměl ' + e.known + ', zbývá ' + e.left + ')';
    logHtml += '<tr><td>' + when + '</td><td>' + esc(niceName(e.file || '')) + '</td><td>' + detail + '</td></tr>';
  }
  if (!logHtml) logHtml = '<tr><td colspan="3">Prázdná historie.</td></tr>';

  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = '<div class="panel">' +
    '<h2>Stats</h2>' +
    '<table class="stats"><tr><th>Cvičení</th><th>Pokrok</th><th>Kola</th><th>Naposledy</th></tr>' + rowsHtml + '</table>' +
    '<h2>Historie</h2>' +
    '<table class="stats"><tr><th>Kdy</th><th>Cvičení</th><th>Událost</th></tr>' + logHtml + '</table>' +
    '<button class="exit">Exit</button>' +
    '</div>';
  ov.querySelector('.exit').onclick = function () { ov.remove(); };
  document.body.appendChild(ov);
}

/* ================= Exercise page ================= */

async function openExercise(topic, file) {
  let text;
  try {
    const r = await fetch(dataUrl(topic, file), { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    text = await r.text();
  } catch (e) {
    alert('Nelze načíst soubor: ' + file);
    showTopics();
    return;
  }
  const rows = parseCSV(text);
  const ex = getEx(topic, file, rows.length);
  const inRange = function (i) { return i >= 0 && i < rows.length; };
  ex.learned = ex.learned.filter(inRange);
  ex.visible = ex.visible.filter(function (i) { return inRange(i) && ex.learned.indexOf(i) === -1; });
  ex.noteOpen = ex.noteOpen.filter(inRange);
  ex.lastStudied = new Date().toISOString();
  state.view = { page: 'exercise', topic: topic, file: file };
  saveState();
  cur = { topic: topic, file: file, rows: rows, ex: ex };
  renderExercise();
}

function renderExercise() {
  const topic = cur.topic, file = cur.file, rows = cur.rows, ex = cur.ex;
  const remaining = [];
  for (let i = 0; i < rows.length; i++) if (ex.learned.indexOf(i) === -1) remaining.push(i);
  const pct = progressOf(topic, file);
  const pinned = state.pins.indexOf(topic) !== -1;
  const t = topicByFolder(topic);
  const pics = (t && t.pics) ? t.pics : [];

  let html = '<div class="header exheader">' +
    '<button id="btnBack">Back</button>' +
    '<button id="btnReset">Reset</button>' +
    '<button id="btnPinEx"' + (pinned ? ' class="active"' : '') + '>Pin</button>' +
    '<button id="btnPic"' + (pics.length ? '' : ' disabled') + '>Pic</button>' +
    '<div class="exname">' + esc(niceName(file)) + ' (' + pct + '%)</div>' +
    '</div>';

  if (!rows.length) {
    html += '<div class="msg">Soubor neobsahuje žádné otázky.</div>';
  } else if (!remaining.length) {
    html += '<div class="msg done">🎉 Hotovo — 100 %!<br><br>' +
      '<button id="btnAgain">Start again</button></div>';
  } else {
    html += '<div class="tablewrap" id="wrap"><table class="extable">';
    for (const i of remaining) {
      const r = rows[i];
      if (r.n && ex.noteOpen.indexOf(i) !== -1) {
        html += '<tr class="noterow" data-i="' + i + '"><td colspan="3" class="notecell">' + esc(r.n) + '</td></tr>';
      } else {
        const vis = ex.visible.indexOf(i) !== -1;
        html += '<tr data-i="' + i + '">' +
          '<td class="q">' + esc(r.q) + '</td>' +
          '<td class="a' + (vis ? ' shown' : '') + '">' + (vis ? esc(r.a) : '') + '</td>' +
          '<td class="n' + (r.n ? ' hasnote' : '') + '"></td>' +
          '</tr>';
      }
    }
    html += '</table>' +
      '<div class="roundbar">' +
      '<button id="btnNext">Next round</button>' +
      '<span class="counter">umím: ' + ex.visible.length + ' / ' + remaining.length + '</span>' +
      '</div></div>';
  }
  app.innerHTML = html;

  el('btnBack').onclick = function () { cur = null; showTopics(); };
  el('btnReset').onclick = function () {
    if (!confirm('Opravdu resetovat učení tohoto cvičení?')) return;
    ex.learned = []; ex.visible = []; ex.noteOpen = []; ex.rounds = 0;
    logEvent('reset', topic, file);
    saveState();
    renderExercise();
  };
  el('btnPinEx').onclick = function () {
    const i = state.pins.indexOf(topic);
    if (i === -1) state.pins.push(topic); else state.pins.splice(i, 1);
    saveState();
    renderExercise();
  };
  if (pics.length) el('btnPic').onclick = function () { showPics(pics); };
  const again = el('btnAgain');
  if (again) again.onclick = function () {
    ex.learned = []; ex.visible = []; ex.noteOpen = []; ex.rounds = 0;
    logEvent('reset', topic, file);
    saveState();
    renderExercise();
  };
  const next = el('btnNext');
  if (next) next.onclick = function () {
    const known = ex.visible.length;
    ex.learned = ex.learned.concat(ex.visible);
    ex.visible = [];
    ex.noteOpen = [];
    ex.rounds++;
    const left = rows.length - ex.learned.length;
    logEvent('round', topic, file, { known: known, left: left });
    if (!left) logEvent('done', topic, file);
    saveState();
    renderExercise();
  };

  const wrap = el('wrap');
  if (wrap) {
    wrap.addEventListener('click', function (evt) {
      const td = evt.target.closest('td');
      if (!td) return;
      const tr = td.closest('tr');
      const i = parseInt(tr.getAttribute('data-i'), 10);
      if (td.classList.contains('a')) {
        const p = ex.visible.indexOf(i);
        if (p === -1) ex.visible.push(i); else ex.visible.splice(p, 1);
        saveState();
        rerenderKeepScroll();
      } else if (td.classList.contains('hasnote') || td.classList.contains('notecell')) {
        const p = ex.noteOpen.indexOf(i);
        if (p === -1) ex.noteOpen.push(i); else ex.noteOpen.splice(p, 1);
        saveState();
        rerenderKeepScroll();
      }
    });
  }
}

function rerenderKeepScroll() {
  const wrap = el('wrap');
  const top = wrap ? wrap.scrollTop : 0;
  renderExercise();
  const w2 = el('wrap');
  if (w2) w2.scrollTop = top;
}

/* ================= Picture viewer ================= */

function showPics(pics) {
  picIdx = 0;
  const ov = document.createElement('div');
  ov.className = 'overlay picview';

  function render() {
    let nav = '';
    if (pics.length > 1) {
      nav = '<button class="pback">Back</button><button class="pfwd">Forward</button>';
    }
    ov.innerHTML = '<div class="picbar">' + nav + '<button class="exit">Exit</button>' +
      '<span class="counter">' + (picIdx + 1) + ' / ' + pics.length + '</span></div>' +
      '<div class="picholder"><img src="' + dataUrl(cur.topic, pics[picIdx]) + '" alt="obrázek"></div>';
    ov.querySelector('.exit').onclick = function () { ov.remove(); };
    const back = ov.querySelector('.pback');
    const fwd = ov.querySelector('.pfwd');
    if (back) back.onclick = function () { picIdx = (picIdx - 1 + pics.length) % pics.length; render(); };
    if (fwd) fwd.onclick = function () { picIdx = (picIdx + 1) % pics.length; render(); };
  }
  render();
  document.body.appendChild(ov);
}

/* ================= Password gate ================= */

// SHA-256 hash of the access password; the plain password never appears in the code
const PW_HASH = '5dde896887f6754c9b15bfe3a441ae4806df2fde94001311e08bf110622e0bbe';

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function showLogin() {
  app.innerHTML = '<div class="login">' +
    '<h2>Zadejte heslo</h2>' +
    '<input type="password" id="pw" autocomplete="current-password">' +
    '<button id="pwBtn">OK</button>' +
    '<div id="pwMsg" class="pwmsg"></div>' +
    '</div>';
  const tryPw = async function () {
    let ok = false;
    try { ok = (await sha256hex(el('pw').value)) === PW_HASH; } catch (e) { ok = false; }
    if (ok) {
      sessionStorage.setItem('flashapp_auth', '1');
      init();
    } else {
      el('pwMsg').textContent = 'Špatné heslo';
      el('pw').value = '';
      el('pw').focus();
    }
  };
  el('pwBtn').onclick = tryPw;
  el('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') tryPw(); });
  el('pw').focus();
}

/* ================= Go ================= */

if (sessionStorage.getItem('flashapp_auth') === '1') init();
else showLogin();
