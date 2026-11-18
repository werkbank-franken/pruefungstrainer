'use strict';
// Prüfungstrainer TBW – Lernkarten (Lehrbuch), Prüfungsaufgaben, Simulation, Fortschritt.
// Inhalte liegen in IndexedDB, der Lernstand in localStorage – alles nur auf diesem Gerät.

const $ = s => document.querySelector(s);
const main = $('#main');
const DAY = 864e5;
const INTERVAL = [0, 1, 3, 7, 16, 35];          // Tage je Leitner-Fach 1–5
const FKEYS = ['vwl', 'rewe', 'ma'];
let CARDS = [], TASKS = [], CBY = {}, TBY = {}, CONTENT = null;
let P = null;
let view = 'home';
let S = {};                                       // flüchtiger Zustand der aktuellen Ansicht
let timerId = null;

/* ---------- Speicher ---------- */
const LS = 'pt-progress-v1';
function loadP() {
  try { P = JSON.parse(localStorage.getItem(LS)) || {}; } catch { P = {}; }
  P.cards ??= {}; P.tasks ??= {}; P.days ??= {}; P.exams ??= [];
  P.set = Object.assign({ examDate: '', newPerDay: 20, simMin: 120, theme: 'auto' }, P.set || {});
}
function saveP() {
  try { localStorage.setItem(LS, JSON.stringify(P)); }
  catch { toast('Speichern fehlgeschlagen – Gerätespeicher voll?'); }
}
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('pruefungstrainer', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbGet(k) {
  const db = await idb();
  return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function dbSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
function setContent(c) {
  CONTENT = c;
  CARDS = c.cards || []; TASKS = c.tasks || [];
  CBY = Object.fromEntries(CARDS.map(x => [x.id, x]));
  TBY = Object.fromEntries(TASKS.map(x => [x.id, x]));
}

/* ---------- Helfer ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmtDate = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; };
const pct = x => Math.round(x * 100);
const fname = k => FAECHER[k].name;
const fkurz = k => FAECHER[k].kurz;
const tag = k => `<span class="tag f-${k}">${esc(fkurz(k))}</span>`;
const num = n => String(Math.round(n * 10) / 10).replace('.', ',');
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function day(k = dayKey()) { return P.days[k] ??= { cards: 0, neu: 0, pts: 0, tasks: 0 }; }
function daysToExam() {
  if (!P.set.examDate) return null;
  return Math.ceil((new Date(P.set.examDate + 'T00:00').getTime() - startOfDay(Date.now())) / DAY);
}
function ihkNote(p) {
  const x = Math.floor(p * 100 + 1e-9);
  return x >= 92 ? 1 : x >= 81 ? 2 : x >= 67 ? 3 : x >= 50 ? 4 : x >= 30 ? 5 : 6;
}
function streak() {
  let n = 0, t = Date.now();
  if (!activeDay(dayKey(t))) t -= DAY;           // heute noch nichts? dann ab gestern zählen
  while (activeDay(dayKey(t))) { n++; t -= DAY; }
  return n;
}
const activeDay = k => { const d = P.days[k]; return d && (d.cards || d.tasks); };

/* ---------- Mini-Markdown für die Aufgaben ---------- */
function inl(s) {
  return esc(s)
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
    .replace(/\^\[\d+\]/g, '')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[Abbildung: ([^\]]*?) – nicht erfasst\]/g, '<span class="muted">[Abbildung nicht erfasst: $1]</span>');
}
function md(src) {
  const L = String(src || '').replace(/\r/g, '').split('\n');
  const isLi = l => /^\s*([-*]|\d+\.)\s+/.test(l);
  const ind = l => l.match(/^\s*/)[0].length;
  let i = 0, out = '';
  function list() {
    const base = ind(L[i]); const ol = /^\s*\d+\./.test(L[i]);
    const start = ol ? parseInt(L[i].trim(), 10) : 1;
    let h = ol ? `<ol start="${start}">` : '<ul>';
    while (i < L.length) {
      const l = L[i];
      if (!l.trim()) {
        let j = i + 1; while (j < L.length && !L[j].trim()) j++;
        if (j < L.length && isLi(L[j]) && ind(L[j]) >= base) { i = j; continue; }
        break;
      }
      const m = /^\s*([-*]|\d+\.)\s+(.*)/.exec(l);
      if (m && ind(l) === base) {
        h += '<li>' + inl(m[2]); i++;
        while (i < L.length && L[i].trim() && !isLi(L[i]) && ind(L[i]) > base) { h += ' ' + inl(L[i].trim()); i++; }
        if (i < L.length && isLi(L[i]) && ind(L[i]) > base) h += list();
        h += '</li>'; continue;
      }
      if (m && ind(l) > base) { h += list(); continue; }
      break;
    }
    return h + (ol ? '</ol>' : '</ul>');
  }
  while (i < L.length) {
    const l = L[i];
    if (!l.trim()) { i++; continue; }
    if (/^\s*\|/.test(l)) {
      const rows = []; while (i < L.length && /^\s*\|/.test(L[i])) rows.push(L[i++]);
      const sep = r => /^\s*\|\s*:?-{3,}/.test(r);
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|');
      let h = '<div class="tbl"><table>';
      rows.forEach((r, k) => {
        if (sep(r)) return;
        const tg = k === 0 && rows[1] && sep(rows[1]) ? 'th' : 'td';
        h += '<tr>' + cells(r).map(c => `<${tg}>${inl(c.trim()).replace(/(<br>\s*)+$/, '')}</${tg}>`).join('') + '</tr>';
      });
      out += h + '</table></div>'; continue;
    }
    let m;
    if ((m = /^#{1,6}\s+(.*)/.exec(l))) { out += `<h4>${inl(m[1])}</h4>`; i++; continue; }
    if (/^>\s?/.test(l)) { const t = []; while (i < L.length && /^>\s?/.test(L[i])) t.push(L[i++].replace(/^>\s?/, '')); out += `<blockquote>${inl(t.join(' '))}</blockquote>`; continue; }
    if (isLi(l)) { out += list(); continue; }
    const t = []; while (i < L.length && L[i].trim() && !/^(\s*\||#{1,6}\s|>)/.test(L[i]) && !isLi(L[i])) t.push(L[i++].trim());
    out += `<p>${inl(t.join(' '))}</p>`;
  }
  return out;
}

// Lehrbuch-Antworten: PDF-Zeilenumbrüche glätten, Absätze erhalten
function bookText(s) {
  const lines = s.split('\n');
  let out = '', prev = '';
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { out += '<br><br>'; prev = ''; continue; }
    if (l === 'MERKE') { out += '<br><b class="f-rewe">Merke:</b> '; prev = ''; continue; }
    const e = esc(l).replace(/^(→|•)/, '$1 ');
    // umbrochene PDF-Zeilen (lang, ohne Satzende) zusammenfügen, kurze Zeilen sind meist Aufzählungen
    const wrapped = prev.length >= 60 && !/[.:!?]$/.test(prev);
    if (wrapped && /[A-Za-zäöüß]-$/.test(prev) && /^[a-zäöüß]/.test(l)) out = out.replace(/-$/, '') + e;
    else if (wrapped || (prev.length >= 40 && /[a-zäöüß,(]$/i.test(prev) && /^[a-zäöüß(]/.test(l))) out += ' ' + e;
    else out += (out && !out.endsWith('<br><br>') && !out.endsWith('</b> ') ? '<br>' : '') + e;
    prev = l;
  }
  return out.replace(/^(<br>)+|(<br>)+$/g, '');
}

/* ---------- Lernkarten-Logik ---------- */
function cardStat(id) { return P.cards[id]; }
function rateCard(id, r) {
  const now = Date.now();
  let p = P.cards[id];
  if (!p) { p = P.cards[id] = { box: 0, right: 0, part: 0, wrong: 0, seen: 0, first: now }; day().neu++; }
  p.seen++; p.last = now;
  if (r === 0) { p.wrong++; p.box = 1; p.due = now + 10 * 60e3; }
  else if (r === 1) { p.part++; p.box = Math.max(1, p.box); p.due = startOfDay(now + DAY); }
  else { p.right++; p.box = Math.min(5, p.box + 1); p.due = startOfDay(now + INTERVAL[p.box] * DAY); }
  day().cards++;
  saveP();
}
const isDue = c => { const p = P.cards[c.id]; return p && p.due <= Date.now(); };
const isNew = c => !P.cards[c.id];
const quote = p => p && p.seen ? (p.right + 0.5 * p.part) / p.seen : null;

function newPicks(pool, n) {
  // gleichmäßig über die drei Fächer, innerhalb eines Fachs in Buchreihenfolge
  const by = FKEYS.map(k => pool.filter(c => c.fach === k && isNew(c)));
  const out = [];
  let k = 0;
  while (out.length < n && by.some(a => a.length)) { const a = by[k % 3]; if (a.length) out.push(a.shift()); k++; }
  return out;
}
function dailyQueue() {
  const due = CARDS.filter(isDue).sort((a, b) => P.cards[a.id].box - P.cards[b.id].box || P.cards[a.id].due - P.cards[b.id].due);
  const nNew = Math.max(0, P.set.newPerDay - day().neu);
  return [...due.slice(0, 150), ...newPicks(CARDS, nNew)].map(c => c.id);
}
function weakCards() {
  return CARDS.filter(c => { const p = P.cards[c.id]; return p && p.wrong > 0 && p.box <= 2; })
    .sort((a, b) => (P.cards[b.id].wrong - P.cards[b.id].right) - (P.cards[a.id].wrong - P.cards[a.id].right));
}
function chapters(fach) {
  const m = new Map();
  for (const c of CARDS) {
    if (fach && c.fach !== fach) continue;
    if (!m.has(c.kap)) m.set(c.kap, { kap: c.kap, fach: c.fach, cards: [] });
    m.get(c.kap).cards.push(c);
  }
  return [...m.values()];
}
function chapterStats(cards) {
  let nNew = 0, learn = 0, sure = 0, seen = 0, score = 0, due = 0;
  for (const c of cards) {
    const p = P.cards[c.id];
    if (!p) { nNew++; continue; }
    if (p.box >= 4) sure++; else learn++;
    if (p.due <= Date.now()) due++;
    seen += p.seen; score += p.right + 0.5 * p.part;
  }
  return { n: cards.length, nNew, learn, sure, due, q: seen ? score / seen : null, seen };
}
function weakChapters() {
  return chapters().map(ch => ({ ...ch, st: chapterStats(ch.cards) }))
    .filter(ch => ch.st.seen >= 4 && ch.st.q < 0.75)
    .sort((a, b) => a.st.q - b.st.q);
}

/* ---------- Aufgaben-Logik ---------- */
function taskStat(id) { return P.tasks[id] ??= { answers: {}, attempts: [] }; }
function taskPct(id) { const a = P.tasks[id]?.attempts; return a && a.length ? a[a.length - 1].pts / a[a.length - 1].max : null; }
function taskStatus(id) { const p = taskPct(id); return p === null ? 'neu' : p >= 0.8 ? 'gut' : 'wdh'; }
function fachTaskAvg(k) {
  const ps = TASKS.filter(t => t.fach === k).map(t => taskPct(t.id)).filter(x => x !== null);
  return ps.length ? { avg: ps.reduce((s, x) => s + x, 0) / ps.length, n: ps.length } : null;
}
function taskOfDay() {
  // Fach mit der schwächsten Quote (oder dem wenigsten Training) zuerst
  const score = k => { const a = fachTaskAvg(k); return a ? a.avg + a.n * 0.01 : -1 + FKEYS.indexOf(k) * 0.001; };
  const rot = FKEYS.slice().sort((a, b) => score(a) - score(b));
  for (const k of rot) {
    const open = TASKS.filter(t => t.fach === k && taskStatus(t.id) === 'neu');
    const weak = TASKS.filter(t => t.fach === k && taskStatus(t.id) === 'wdh').sort((a, b) => taskPct(a.id) - taskPct(b.id));
    const pickWeak = weak.length && (!open.length || dayKey().charCodeAt(9) % 2);
    if (pickWeak) return weak[0];
    if (open.length) return open[0];
  }
  return TASKS[0];
}
function pickExam(fach) {
  const pool = TASKS.filter(t => t.fach === fach);
  const fresh = pool.filter(t => taskStatus(t.id) === 'neu');
  const src = (fresh.length >= 4 ? fresh : pool).slice().sort(() => Math.random() - 0.5);
  const out = []; let sum = 0;
  for (const t of src) {
    if (sum >= 95) break;
    if (sum + t.punkte > 110 && sum >= 80) continue;
    out.push(t.id); sum += t.punkte;
  }
  return out;
}

/* ---------- Zwischenbilanz für das Claude-Projekt ---------- */
function bilanzText() {
  const d = daysToExam();
  const lines = [`Zwischenbilanz aus der Prüfungstrainer-App (${fmtDate(dayKey())})`];
  if (d !== null) lines.push(`Prüfung am ${fmtDate(P.set.examDate)}, noch ${d} Tage. Lernserie: ${streak()} Tage in Folge.`);
  const all = chapterStats(CARDS);
  lines.push('', `Lernkarten (Lehrbuch): ${all.n - all.nNew} von ${all.n} begonnen, ${all.sure} sicher, Trefferquote ${all.q === null ? '–' : pct(all.q) + ' %'}.`);
  for (const k of FKEYS) {
    const st = chapterStats(CARDS.filter(c => c.fach === k));
    lines.push(`- ${fname(k)}: ${st.n - st.nNew}/${st.n} begonnen, ${st.sure} sicher, Quote ${st.q === null ? '–' : pct(st.q) + ' %'}`);
  }
  const wc = weakChapters().slice(0, 6);
  if (wc.length) { lines.push('', 'Schwächste Kapitel (Karten):'); wc.forEach(ch => lines.push(`- ${ch.kap} (${fname(ch.fach)}): ${pct(ch.st.q)} % richtig`)); }
  const done = TASKS.filter(t => taskPct(t.id) !== null);
  lines.push('', `Prüfungsaufgaben: ${done.length} von ${TASKS.length} bearbeitet.`);
  for (const k of FKEYS) { const a = fachTaskAvg(k); if (a) lines.push(`- ${fname(k)}: ${a.n} Aufgaben, Ø ${pct(a.avg)} %`); }
  const weakT = done.filter(t => taskPct(t.id) < 0.6).sort((a, b) => taskPct(a.id) - taskPct(b.id)).slice(0, 8);
  if (weakT.length) { lines.push('', 'Aufgaben unter 60 %:'); weakT.forEach(t => lines.push(`- ${t.thema} (${fname(t.fach)}, ${t.satz} Aufg. ${pad(t.nr)}): ${pct(taskPct(t.id))} %`)); }
  if (P.exams.length) { lines.push('', 'Prüfungssimulationen:'); P.exams.slice(-5).forEach(e => lines.push(`- ${fmtDate(e.date)} ${fname(e.fach)}: ${num(e.pts)}/${num(e.max)} P. = ${pct(e.pts / e.max)} %, Note ${ihkNote(e.pts / e.max)}`)); }
  lines.push('', 'Bitte stelle mir in der nächsten Sitzung gezielt Aufgaben zu meinen Schwächen und passe den Lernplan an.');
  return lines.join('\n');
}
async function shareText(text, title) {
  if (navigator.share) { try { await navigator.share({ title, text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text); toast('In die Zwischenablage kopiert'); }
  catch { S.showBilanz = true; render(); }
}

/* ---------- Ansichten ---------- */
const V = {};

V.import = () => `
  <h2>Willkommen!</h2>
  <div class="stack">
    <p>Der Prüfungstrainer arbeitet mit deinem Lehrbuch und den IHK-Aufgabensätzen aus dem Claude-Projekt. Die Inhalte werden <b>nur auf diesem Handy</b> gespeichert und sind nicht Teil der öffentlichen App.</p>
    <div class="drop">
      <p><b>Lerninhalte laden</b></p>
      <p class="small muted">Wähle die beiden Dateien aus:<br><code>Lehrbuch_A_WH.txt</code> und <code>TBW_WH_Aufgaben.md</code><br>(du kannst beide auf einmal markieren)</p>
      <button class="primary" data-act="pick">Dateien auswählen</button>
    </div>
    ${CARDS.length || TASKS.length ? `<p class="small">Geladen: ${CARDS.length} Lernkarten, ${TASKS.length} Aufgaben.</p><button data-act="go" data-v="home">Weiter</button>` : ''}
    <p class="small muted">Eine Sicherung deines Lernstands (.json) kannst du hier ebenfalls laden.</p>
  </div>`;

V.home = () => {
  const d = daysToExam();
  const q = dailyQueue();
  const dueN = CARDS.filter(isDue).length;
  const newLeft = Math.max(0, P.set.newPerDay - day().neu);
  const t = taskOfDay();
  const weak = weakCards().length;
  const today = day();
  const remainingNew = CARDS.filter(isNew).length;
  let tempo = '';
  if (d !== null && d > 0) {
    const learnDays = Math.max(1, d - 21);
    const need = Math.ceil(remainingNew / learnDays);
    tempo = remainingNew
      ? `Damit alle ${remainingNew} offenen Karten 3 Wochen vor der Prüfung durch sind, brauchst du <b>${need} neue Karten pro Tag</b>${need > P.set.newPerDay ? ` – eingestellt sind ${P.set.newPerDay}. <button class="small" data-act="settempo" data-n="${need}">Auf ${need} erhöhen</button>` : ' – passt zu deiner Einstellung.'}`
      : 'Alle Lehrbuchkarten sind begonnen. Jetzt heißt es: wiederholen und Prüfungen simulieren.';
    if (d <= 21) tempo += '<br><b>Endspurt:</b> Mach jetzt regelmäßig Prüfungssimulationen.';
  }
  return `
  <div class="stack">
    ${d === null ? `<div class="card row"><div class="grow">Trag deinen Prüfungstermin ein, dann plane ich dein Lerntempo.</div><button class="small" data-act="go" data-v="stats" data-focus="examDate">Eintragen</button></div>`
      : `<div class="card row"><div class="grow"><div class="big">${d > 0 ? d : d === 0 ? 'Heute!' : '–'}</div><div class="muted small">${d > 0 ? 'Tage bis zur Prüfung' : d === 0 ? 'Prüfungstag – viel Erfolg!' : 'Prüfung vorbei'} · ${fmtDate(P.set.examDate)}</div></div><div style="text-align:right"><div class="big">${streak()}</div><div class="muted small">Tage Serie</div></div></div>`}

    <div class="card stack">
      <div class="row"><b class="grow">Tageslernen</b><span class="muted small">heute: ${today.cards} Karten · ${num(today.pts)} Aufgabenpunkte</span></div>
      <div class="muted small">${dueN} Karten fällig zur Wiederholung · ${newLeft} neue Karten heute</div>
      <button class="primary" data-act="session" data-kind="daily" ${q.length ? '' : 'disabled'}>${q.length ? `Starten (${q.length} Karten)` : 'Für heute alles erledigt ✓'}</button>
      ${tempo ? `<div class="small muted">${tempo}</div>` : ''}
    </div>

    ${t ? `<div class="card stack">
      <div class="row"><b class="grow">Aufgabe des Tages</b>${tag(t.fach)}</div>
      <div>${esc(t.thema)}</div>
      <div class="muted small">${esc(t.satz)} · Aufgabe ${pad(t.nr)} · ${num(t.punkte)} Punkte${taskPct(t.id) !== null ? ` · zuletzt ${pct(taskPct(t.id))} %` : ''}</div>
      <button data-act="task" data-id="${esc(t.id)}">Aufgabe bearbeiten</button>
    </div>` : ''}

    ${weak ? `<div class="card row"><div class="grow"><b>Schwächen wiederholen</b><div class="muted small">${weak} Karten, die dir schwerfallen</div></div><button data-act="session" data-kind="weak">Üben</button></div>` : ''}

    <div class="card stack">
      <b>Prüfungssimulation</b>
      <div class="muted small">Zufällige IHK-Aufgaben eines Fachs mit rund 100 Punkten, ${P.set.simMin} Minuten Zeit, danach Selbstbewertung und Note.</div>
      <div class="row">${FKEYS.map(k => `<button class="small grow" data-act="exam" data-fach="${k}">${esc(fkurz(k))}</button>`).join('')}</div>
    </div>
  </div>`;
};

V.cards = () => {
  const f = S.fach || '';
  const chs = chapters(f);
  const pool = f ? CARDS.filter(c => c.fach === f) : CARDS;
  const dueN = pool.filter(isDue).length;
  return `
  <h2>Lernkarten</h2>
  <div class="seg" role="group" aria-label="Fach">
    <button data-act="fach" data-f="" aria-pressed="${!f}">Alle</button>
    ${FKEYS.map(k => `<button data-act="fach" data-f="${k}" aria-pressed="${f === k}">${esc(fkurz(k))}</button>`).join('')}
  </div>
  <div class="row" style="margin:12px 0">
    <button class="grow" data-act="session" data-kind="due" ${dueN ? '' : 'disabled'}>Fällige wiederholen (${dueN})</button>
    <button class="grow" data-act="session" data-kind="new">10 neue lernen</button>
  </div>
  <p class="small muted">Oder ein Kapitel gezielt durcharbeiten (grau = neu, gelb = in Arbeit, grün = sicher):</p>
  <div class="list">
    ${chs.map(ch => {
      const st = chapterStats(ch.cards);
      return `<button class="item" data-act="session" data-kind="kap" data-kap="${esc(ch.kap)}">
        <div class="t"><b>${esc(ch.kap)}</b>
          <div class="bar" style="margin-top:6px"><i style="width:${st.sure / st.n * 100}%;background:var(--ok)"></i><i style="width:${st.learn / st.n * 100}%;background:var(--mid)"></i></div>
          <div class="small muted" style="margin-top:4px">${st.n} Karten${st.due ? ` · ${st.due} fällig` : ''}${st.q !== null ? ` · ${pct(st.q)} % richtig` : ''}</div>
        </div></button>`;
    }).join('')}
  </div>`;
};

V.session = () => {
  const s = S.session;
  if (s.idx >= s.queue.length) {
    const r = s.res;
    return `<div class="stack">
      <h2>Geschafft! 🎉</h2>
      <div class="kpis">
        <div class="kpi"><div class="v" style="color:var(--ok)">${r[2]}</div><div class="k">gewusst</div></div>
        <div class="kpi"><div class="v" style="color:var(--mid)">${r[1]}</div><div class="k">teilweise</div></div>
        <div class="kpi"><div class="v" style="color:var(--bad)">${r[0]}</div><div class="k">nicht gewusst</div></div>
      </div>
      <p class="muted">Nicht gewusste Karten kommen in wenigen Minuten bzw. morgen wieder, sichere in immer größeren Abständen.</p>
      <button class="primary" data-act="go" data-v="home">Zur Übersicht</button>
    </div>`;
  }
  const c = CBY[s.queue[s.idx]];
  const p = P.cards[c.id];
  return `
  <div class="row" style="margin-bottom:8px"><button class="small ghost" data-act="endsession">✕ Beenden</button><span class="grow"></span><span class="muted small">${s.idx + 1} / ${s.queue.length}</span></div>
  <div class="progress"><i style="width:${s.idx / s.queue.length * 100}%"></i></div>
  <div class="card flash">
    <div class="meta">${tag(c.fach)}<span>${esc(c.kap)}</span>${p ? `<span>· Fach ${p.box}/5</span>` : '<span>· neu</span>'}</div>
    <div class="q">${esc(c.frage)}</div>
    ${s.shown ? `<div class="a">${bookText(c.antwort)}<div class="src">Lehrbuch „Die Prüfung der Technischen Betriebswirte“, S. ${c.seite} · Frage ${pad(c.nr)} in ${esc(c.kap.split(' ')[0])}</div></div>` : ''}
  </div>
  ${s.shown
    ? `<div class="rate"><button class="r0" data-act="rate" data-r="0">Nicht gewusst</button><button class="r1" data-act="rate" data-r="1">Teilweise</button><button class="r2" data-act="rate" data-r="2">Gewusst</button></div>`
    : `<div class="rate" style="grid-template-columns:1fr"><button class="primary" data-act="show">Antwort zeigen</button></div>`}`;
};

V.tasks = () => {
  const f = S.tfach || '', st = S.tstatus || '', q = (S.tq || '').toLowerCase();
  const list = TASKS.filter(t => (!f || t.fach === f) && (!st || taskStatus(t.id) === st) && (!q || (t.thema + ' ' + t.satz).toLowerCase().includes(q)));
  return `
  <h2>Prüfungsaufgaben</h2>
  <div class="seg" role="group" aria-label="Fach">
    <button data-act="tfach" data-f="" aria-pressed="${!f}">Alle</button>
    ${FKEYS.map(k => `<button data-act="tfach" data-f="${k}" aria-pressed="${f === k}">${esc(fkurz(k))}</button>`).join('')}
  </div>
  <div class="seg" role="group" aria-label="Status" style="margin-top:8px">
    ${[['', 'Alle'], ['neu', 'Neu'], ['wdh', 'Wiederholen'], ['gut', 'Sicher']].map(([k, l]) => `<button data-act="tstatus" data-s="${k}" aria-pressed="${st === k}">${l}</button>`).join('')}
  </div>
  <input type="search" placeholder="Thema suchen, z. B. Bestellmenge" value="${esc(S.tq || '')}" data-input="tq" style="width:100%;margin:10px 0;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--panel2)">
  <p class="small muted">${list.length} Aufgaben</p>
  <div class="list">
    ${list.map(t => {
      const p = taskPct(t.id), s2 = taskStatus(t.id);
      return `<button class="item" data-act="task" data-id="${esc(t.id)}">
        <span class="dot ${s2 === 'gut' ? 'ok' : s2 === 'wdh' ? (p >= 0.5 ? 'mid' : 'bad') : ''}"></span>
        <div class="t"><b>${esc(t.thema || 'Aufgabe')}</b><span class="small muted">${f ? '' : esc(fkurz(t.fach)) + ' · '}${esc(t.satz)} · Aufg. ${pad(t.nr)} · ${num(t.punkte)} P.</span></div>
        ${p !== null ? `<span class="small">${pct(p)} %</span>` : ''}
      </button>`;
    }).join('')}
  </div>`;
};

function teilHTML(t, teil, ctx) {
  // ctx: { mode:'practice'|'write'|'grade', answers, scores, shown }
  const key = teil.label;
  const ans = ctx.answers[key] || '';
  const sc = ctx.scores[key];
  const show = ctx.mode === 'grade' || ctx.shown[key];
  let lo = t.loesungen[key] ?? '';
  if (!lo) {
    const prev = t.teile.slice(0, t.teile.indexOf(teil)).reverse().find(x => t.loesungen[x.label]);
    if (prev) lo = `*Keine eigene Musterlösung – die Lösung ist bei Teil ${prev.label}) mit aufgeführt:*\n\n${t.loesungen[prev.label]}`;
  }
  return `<div class="teil">
    ${key ? `<div class="hd"><b>Teil ${esc(key)})</b><span class="muted small">${num(teil.punkte)} P.</span></div>` : ''}
    <div class="md">${md(teil.text)}</div>
    ${ctx.mode === 'grade'
      ? `<div class="card small" style="white-space:pre-wrap;margin-top:8px">${ans ? esc(ans) : '<span class="muted">(keine Antwort notiert)</span>'}</div>`
      : `<textarea data-ans="${esc(t.id)}" data-teil="${esc(key)}" placeholder="Deine Lösung (Stichpunkte reichen) …">${esc(ans)}</textarea>`}
    ${ctx.mode === 'practice' && !show ? `<button class="small" style="margin-top:8px" data-act="reveal" data-teil="${esc(key)}">Lösung zeigen</button>` : ''}
    ${show && ctx.mode !== 'write' ? `<div class="loes md">${lo ? md(lo) : '<p class="muted">Keine Musterlösung zu diesem Teil erfasst.</p>'}</div>
      <div class="score"><span class="small muted grow">Deine Punkte:</span>
        <button class="small" data-act="pts" data-id="${esc(t.id)}" data-teil="${esc(key)}" data-d="-0.5" aria-label="Punkte verringern">−</button>
        <span class="val">${sc === undefined ? '–' : num(sc)}</span>
        <button class="small" data-act="pts" data-id="${esc(t.id)}" data-teil="${esc(key)}" data-d="0.5" aria-label="Punkte erhöhen">+</button>
        <span class="small muted">/ ${num(teil.punkte)}</span>
        <button class="small" data-act="pts" data-id="${esc(t.id)}" data-teil="${esc(key)}" data-set="0">0</button>
        <button class="small" data-act="pts" data-id="${esc(t.id)}" data-teil="${esc(key)}" data-set="${teil.punkte}">voll</button>
      </div>` : ''}
  </div>`;
}
function taskBody(t, ctx) {
  const anyShown = ctx.mode === 'grade' || Object.keys(ctx.shown).length;
  return `
    <div class="row" style="margin-bottom:4px">${tag(t.fach)}<span class="muted small">${esc(t.satz)} · Aufgabe ${pad(t.nr)} · ${num(t.punkte)} Punkte · Stand ${esc(t.stand)}</span></div>
    <h2 style="margin-top:6px">${esc(t.thema)}</h2>
    <div class="md">${md(t.intro)}</div>
    ${t.teile.map(te => teilHTML(t, te, ctx)).join('')}
    ${anyShown && t.allgemein ? `<div class="teil"><b>Allgemeine Hinweise zur Lösung</b><div class="md">${md(t.allgemein)}</div></div>` : ''}
    ${anyShown && t.quellen ? `<details class="teil"><summary class="small muted">Quellen und Rechtsgrundlagen</summary><div class="md small">${md(t.quellen)}</div></details>` : ''}`;
}

V.task = () => {
  const t = TBY[S.task];
  const st = taskStat(t.id);
  const ctx = { mode: 'practice', answers: st.answers, scores: S.scores, shown: S.shown };
  const allScored = t.teile.every(te => S.scores[te.label] !== undefined);
  const got = t.teile.reduce((s, te) => s + (S.scores[te.label] || 0), 0);
  const prev = st.attempts.length ? st.attempts[st.attempts.length - 1] : null;
  return `
  <div class="row" style="margin-bottom:8px"><button class="small ghost" data-act="go" data-v="tasks">← Aufgaben</button><span class="grow"></span>
    ${prev ? `<span class="small muted">zuletzt ${pct(prev.pts / prev.max)} % (${fmtDate(prev.date)})</span>` : ''}</div>
  ${taskBody(t, ctx)}
  <div class="teil stack">
    ${allScored ? `<div class="row"><b class="grow">Ergebnis: ${num(got)} / ${num(t.punkte)} P. (${pct(got / t.punkte)} %)</b></div>` : `<p class="small muted">Schreib deine Lösung, decke die Musterlösung je Teil auf und vergib dir ehrlich Punkte.</p>`}
    <button class="primary" data-act="savetask" ${allScored ? '' : 'disabled'}>Ergebnis speichern</button>
  </div>`;
};

V.exam = () => {
  const e = P.curExam;
  if (!e) return V.home();
  const tasks = e.ids.map(id => TBY[id]).filter(Boolean);
  const max = tasks.reduce((s, t) => s + t.punkte, 0);
  if (e.phase === 'done') {
    const r = P.exams[P.exams.length - 1];
    const p = r.pts / r.max;
    return `<div class="stack">
      <h2>Simulation ${esc(fname(e.fach))}</h2>
      <div class="card row"><div class="grow"><div class="big">${num(r.pts)} / ${num(r.max)} P.</div><div class="muted">${pct(p)} % · ${Math.round(r.min)} Minuten</div></div><div class="note" style="color:${p >= 0.5 ? 'var(--ok)' : 'var(--bad)'}">${ihkNote(p)}</div></div>
      <p class="muted small">Note nach IHK-Punkteschlüssel (100–92 = 1, 91–81 = 2, 80–67 = 3, 66–50 = 4, 49–30 = 5). Bestanden ab 50 %.</p>
      ${tasks.map(t => { const g = t.teile.reduce((s, te) => s + (e.scores[t.id]?.[te.label] || 0), 0); return `<div class="row small"><span class="grow">${esc(t.thema)}</span><b>${num(g)}/${num(t.punkte)}</b></div>`; }).join('')}
      <button class="primary" data-act="closeexam">Fertig</button>
    </div>`;
  }
  const grading = e.phase === 'grade';
  const left = e.start + e.dur * 60e3 - Date.now();
  const allScored = tasks.every(t => t.teile.every(te => e.scores[t.id]?.[te.label] !== undefined));
  return `
  <div class="timer ${left < 10 * 60e3 && !grading ? 'warn' : ''}">
    ${grading ? `<b class="grow">Bewertung · ${esc(fkurz(e.fach))}</b>` : `<span class="big" id="clock">${clock(left)}</span><span class="grow muted small">${esc(fkurz(e.fach))} · ${tasks.length} Aufgaben · ${num(max)} P.</span>`}
    ${grading ? '' : `<button class="small primary" data-act="examsubmit">Abgeben</button>`}
  </div>
  ${grading ? `<p class="small muted">Vergleiche deine Antworten mit den Musterlösungen und vergib dir je Teil Punkte – so streng wie ein IHK-Prüfer.</p>` : `<p class="small muted">Arbeite wie in der echten Prüfung: Taschenrechner, Formelsammlung und Gesetzestexte sind erlaubt. Lösungen siehst du erst nach dem Abgeben.</p>`}
  ${tasks.map((t, i) => `<div class="card" style="margin-bottom:12px"><div class="small muted">Aufgabe ${i + 1} von ${tasks.length}</div>
     ${taskBody(t, { mode: grading ? 'grade' : 'write', answers: e.answers[t.id] || {}, scores: e.scores[t.id] || {}, shown: {} })}</div>`).join('')}
  ${grading ? `<button class="primary" style="width:100%" data-act="examfinish" ${allScored ? '' : 'disabled'}>Auswerten</button>` : `<div class="row"><button class="ghost small" data-act="examcancel">Simulation abbrechen</button></div>`}`;
};
function clock(ms) {
  if (ms <= 0) return '0:00:00';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

V.stats = () => {
  const all = chapterStats(CARDS);
  const done = TASKS.filter(t => taskPct(t.id) !== null);
  const avgAll = done.length ? done.reduce((s, t) => s + taskPct(t.id), 0) / done.length : null;
  const wc = weakChapters().slice(0, 6);
  const weakT = done.filter(t => taskPct(t.id) < 0.6).sort((a, b) => taskPct(a.id) - taskPct(b.id)).slice(0, 6);
  const last14 = [...Array(14)].map((_, i) => dayKey(Date.now() - (13 - i) * DAY));
  const maxC = Math.max(10, ...last14.map(k => P.days[k]?.cards || 0));
  return `
  <h2>Fortschritt</h2>
  <div class="kpis">
    <div class="kpi"><div class="v">${all.n - all.nNew}</div><div class="k">Karten begonnen</div></div>
    <div class="kpi"><div class="v">${all.sure}</div><div class="k">Karten sicher</div></div>
    <div class="kpi"><div class="v">${avgAll === null ? '–' : pct(avgAll) + '%'}</div><div class="k">Ø Aufgaben</div></div>
  </div>

  <h3>Fächer</h3>
  <div class="stack">${FKEYS.map(k => {
    const st = chapterStats(CARDS.filter(c => c.fach === k));
    const ta = fachTaskAvg(k);
    return `<div class="card"><div class="row"><b class="grow f-${k}">${esc(fname(k))}</b></div>
      <div class="bar" style="margin:8px 0"><i style="width:${st.sure / Math.max(1, st.n) * 100}%;background:var(--ok)"></i><i style="width:${st.learn / Math.max(1, st.n) * 100}%;background:var(--mid)"></i></div>
      <div class="small muted">Karten: ${st.n - st.nNew}/${st.n} begonnen, ${st.sure} sicher${st.q !== null ? `, ${pct(st.q)} % richtig` : ''}<br>Aufgaben: ${ta ? `${ta.n} von ${TASKS.filter(t => t.fach === k).length} bearbeitet, Ø ${pct(ta.avg)} %` : `0 von ${TASKS.filter(t => t.fach === k).length} bearbeitet`}</div></div>`;
  }).join('')}</div>

  <h3>Letzte 14 Tage (Karten)</h3>
  <div class="card"><div style="display:flex;align-items:flex-end;gap:4px;height:70px">${last14.map(k => {
    const n = P.days[k]?.cards || 0;
    return `<div title="${fmtDate(k)}: ${n}" style="flex:1;height:${Math.max(2, n / maxC * 100)}%;background:${n ? 'var(--accent)' : 'var(--line)'};border-radius:3px 3px 0 0"></div>`;
  }).join('')}</div><div class="row small muted" style="margin-top:4px"><span class="grow">${fmtDate(last14[0]).slice(0, 6)}</span><span>heute</span></div></div>

  ${wc.length ? `<h3>Schwächste Kapitel</h3><div class="list">${wc.map(ch => `<button class="item" data-act="session" data-kind="kap" data-kap="${esc(ch.kap)}"><span class="dot ${ch.st.q < 0.5 ? 'bad' : 'mid'}"></span><div class="t"><b>${esc(ch.kap)}</b><span class="small muted">${esc(fkurz(ch.fach))} · ${pct(ch.st.q)} % richtig</span></div></button>`).join('')}</div>` : ''}
  ${weakT.length ? `<h3>Aufgaben zum Wiederholen</h3><div class="list">${weakT.map(t => `<button class="item" data-act="task" data-id="${esc(t.id)}"><span class="dot bad"></span><div class="t"><b>${esc(t.thema)}</b><span class="small muted">${esc(fkurz(t.fach))} · ${pct(taskPct(t.id))} %</span></div></button>`).join('')}</div>` : ''}
  ${P.exams.length ? `<h3>Simulationen</h3><div class="card stack">${P.exams.slice().reverse().map(e => `<div class="row small"><span class="grow">${fmtDate(e.date)} · ${esc(fname(e.fach))}</span><span>${pct(e.pts / e.max)} %</span><b>Note ${ihkNote(e.pts / e.max)}</b></div>`).join('')}</div>` : ''}

  <h3>Zwischenbilanz für Claude</h3>
  <div class="card stack">
    <div class="small muted">Fasst deinen Stand zusammen, damit du ihn zu Beginn einer Sitzung im Claude-Projekt „Prüfungstrainer“ einfügen kannst.</div>
    <div class="row"><button class="grow primary" data-act="bilanz">Teilen / kopieren</button><button class="grow" data-act="bilanzshow">Anzeigen</button></div>
    ${S.showBilanz ? `<textarea readonly style="min-height:260px;font-size:13px">${esc(bilanzText())}</textarea>` : ''}
  </div>

  <h3>Einstellungen</h3>
  <div class="card stack">
    <label class="f">Prüfungstermin<input type="date" id="examDate" data-set="examDate" value="${esc(P.set.examDate)}"></label>
    <label class="f">Neue Karten pro Tag<input type="number" min="0" max="200" data-set="newPerDay" value="${P.set.newPerDay}"></label>
    <label class="f">Simulationsdauer in Minuten (für ca. 100 Punkte – an die Zeit aus deiner IHK-Einladung anpassen)<input type="number" min="10" max="480" data-set="simMin" value="${P.set.simMin}"></label>
    <label class="f">Darstellung<select data-set="theme">${[['auto', 'wie Handy'], ['dark', 'dunkel'], ['light', 'hell']].map(([v, l]) => `<option value="${v}" ${P.set.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  </div>

  <h3>Daten</h3>
  <div class="card stack">
    <div class="small muted">Geladen: ${CARDS.length} Lernkarten aus dem Lehrbuch, ${TASKS.length} Prüfungsaufgaben. Lernstand und Inhalte liegen nur auf diesem Gerät.</div>
    <div class="row"><button class="grow" data-act="backup">Lernstand sichern</button><button class="grow" data-act="pick">Datei laden</button></div>
    <div class="small muted">„Datei laden“ nimmt eine Sicherung (.json) oder neue Lerninhalte (.md / .txt) an.</div>
    <button class="ghost small" style="color:var(--bad)" data-act="reset">Lernstand zurücksetzen</button>
  </div>
  <p class="small muted" style="text-align:center;margin-top:20px">Prüfungstrainer TBW · Werkbank Franken</p>`;
};

/* ---------- Rendern ---------- */
function applyTheme() {
  const t = P.set.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
function render(keepScroll) {
  const y = main.scrollTop;
  const hasData = CARDS.length || TASKS.length;
  if (!hasData && view !== 'import') view = 'import';
  main.innerHTML = V[view]();
  $('#nav').hidden = view === 'import' || view === 'exam' || view === 'session';
  const tab = { home: 'home', cards: 'cards', session: 'cards', tasks: 'tasks', task: 'tasks', stats: 'stats' }[view];
  document.querySelectorAll('#nav button').forEach(b => b.setAttribute('aria-current', b.dataset.go === tab ? 'page' : 'false'));
  const d = daysToExam();
  const cd = $('#countdown');
  cd.hidden = d === null || d < 0 || view === 'import';
  cd.textContent = d === 0 ? 'Prüfung heute' : `noch ${d} Tage`;
  cd.classList.toggle('on', d !== null && d <= 30);
  main.scrollTop = keepScroll ? y : 0;
  clearInterval(timerId);
  if (view === 'exam' && P.curExam && P.curExam.phase === 'write') timerId = setInterval(tick, 1000);
}
function go(v, keep) { view = v; render(keep); }
function tick() {
  const e = P.curExam;
  if (!e || e.phase !== 'write') return clearInterval(timerId);
  const left = e.start + e.dur * 60e3 - Date.now();
  const el = $('#clock');
  if (el) { el.textContent = clock(left); el.parentElement.classList.toggle('warn', left < 10 * 60e3); }
  if (left <= 0) {
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
    toast('Zeit abgelaufen – jetzt bewerten');
    endWriting();
  }
}
function endWriting() {
  const e = P.curExam;
  e.phase = 'grade'; e.end = Date.now();
  saveP(); render();
}

/* ---------- Aktionen ---------- */
const A = {
  go: d => { if (d.v === 'home' || d.v === 'stats') S = {}; go(d.v); if (d.focus) setTimeout(() => { const el = document.getElementById(d.focus); el && (el.scrollIntoView({ block: 'center' }), el.focus()); }, 50); },
  pick: () => $('#file').click(),
  fach: d => { S.fach = d.f; render(); },
  tfach: d => { S.tfach = d.f; render(true); },
  tstatus: d => { S.tstatus = d.s; render(true); },
  settempo: d => { P.set.newPerDay = +d.n; saveP(); render(true); toast(`${d.n} neue Karten pro Tag`); },
  session: d => {
    let q = [], title = '';
    const pool = S.fach ? CARDS.filter(c => c.fach === S.fach) : CARDS;
    if (d.kind === 'daily') q = dailyQueue();
    else if (d.kind === 'weak') q = weakCards().slice(0, 30).map(c => c.id);
    else if (d.kind === 'due') q = pool.filter(isDue).sort((a, b) => P.cards[a.id].box - P.cards[b.id].box).map(c => c.id);
    else if (d.kind === 'new') q = (S.fach ? pool.filter(isNew).slice(0, 10) : newPicks(CARDS, 10)).map(c => c.id);
    else if (d.kind === 'kap') {
      const cs = CARDS.filter(c => c.kap === d.kap);
      q = [...cs.filter(isDue), ...cs.filter(isNew)].map(c => c.id);
      if (!q.length) { q = cs.map(c => c.id); toast('Alles wiederholt – Kapitel noch einmal komplett'); }
    }
    if (!q.length) return toast('Keine Karten verfügbar');
    S.session = { queue: q, idx: 0, shown: false, res: [0, 0, 0], again: new Set() };
    go('session');
  },
  show: () => { S.session.shown = true; render(true); },
  rate: d => {
    const s = S.session, r = +d.r, id = s.queue[s.idx];
    rateCard(id, r);
    s.res[r]++;
    if (r === 0 && !s.again.has(id)) { s.again.add(id); s.queue.splice(Math.min(s.queue.length, s.idx + 5), 0, id); }
    s.idx++; s.shown = false;
    render();
  },
  endsession: () => { S = {}; go('home'); },
  task: d => { S = { ...S, task: d.id, shown: {}, scores: {} }; go('task'); },
  reveal: d => { S.shown[d.teil] = true; render(true); },
  pts: (d, b) => {
    const id = d.id, key = d.teil;
    const t = TBY[id], teil = t.teile.find(x => x.label === key);
    const store = view === 'exam' ? (P.curExam.scores[id] ??= {}) : S.scores;
    let v = d.set !== undefined ? +d.set : (store[key] ?? (+d.d > 0 ? 0 : teil.punkte)) + +d.d;
    store[key] = Math.max(0, Math.min(teil.punkte, Math.round(v * 2) / 2));
    if (view === 'exam') saveP();
    render(true);
  },
  savetask: () => {
    const t = TBY[S.task];
    const pts = t.teile.reduce((s, te) => s + (S.scores[te.label] || 0), 0);
    taskStat(t.id).attempts.push({ date: dayKey(), pts, max: t.punkte, scores: { ...S.scores } });
    day().pts += pts; day().tasks++;
    saveP();
    toast(`Gespeichert: ${pct(pts / t.punkte)} %`);
    S = { tfach: S.tfach, tstatus: S.tstatus, tq: S.tq };
    go('tasks');
  },
  exam: d => {
    if (P.curExam && P.curExam.phase !== 'done' && !confirm('Es läuft noch eine Simulation. Verwerfen und neu starten?')) { go('exam'); return; }
    const ids = pickExam(d.fach);
    if (!ids.length) return toast('Keine Aufgaben für dieses Fach geladen');
    const max = ids.reduce((s, id) => s + TBY[id].punkte, 0);
    P.curExam = { fach: d.fach, ids, start: Date.now(), dur: Math.round(P.set.simMin * max / 100), phase: 'write', answers: {}, scores: {} };
    saveP(); go('exam');
  },
  examsubmit: () => { if (confirm('Prüfung abgeben und zur Bewertung wechseln?')) endWriting(); },
  examcancel: () => { if (confirm('Simulation abbrechen? Deine Antworten gehen verloren.')) { P.curExam = null; saveP(); go('home'); } },
  examfinish: () => {
    const e = P.curExam;
    const tasks = e.ids.map(id => TBY[id]);
    let pts = 0, max = 0;
    for (const t of tasks) {
      const sc = e.scores[t.id] || {};
      const g = t.teile.reduce((s, te) => s + (sc[te.label] || 0), 0);
      pts += g; max += t.punkte;
      taskStat(t.id).attempts.push({ date: dayKey(), pts: g, max: t.punkte, scores: sc, exam: true });
    }
    P.exams.push({ date: dayKey(), fach: e.fach, pts, max, min: ((e.end || Date.now()) - e.start) / 60e3, ids: e.ids });
    day().pts += pts; day().tasks += tasks.length;
    e.phase = 'done';
    saveP(); render();
  },
  closeexam: () => { P.curExam = null; saveP(); S = {}; go('home'); },
  bilanz: () => shareText(bilanzText(), 'Zwischenbilanz Prüfungstrainer'),
  bilanzshow: () => { S.showBilanz = !S.showBilanz; render(true); },
  backup: () => {
    const blob = new Blob([JSON.stringify({ type: 'pruefungstrainer-backup', version: 1, date: new Date().toISOString(), progress: P }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pruefungstrainer-lernstand-${dayKey()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
  reset: () => {
    if (!confirm('Wirklich den gesamten Lernstand löschen? Das lässt sich nicht rückgängig machen (außer mit einer Sicherung).')) return;
    const set = P.set; localStorage.removeItem(LS); loadP(); P.set = set; saveP(); S = {}; go('home'); toast('Lernstand zurückgesetzt');
  },
};

main.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  A[b.dataset.act]?.(b.dataset, b);
});
$('#nav').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) { S = {}; go(b.dataset.go); } });

let saveT = null;
main.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.ans !== undefined) {
    const id = el.dataset.ans, key = el.dataset.teil;
    if (view === 'exam') ((P.curExam.answers[id] ??= {}))[key] = el.value;
    else taskStat(id).answers[key] = el.value;
    clearTimeout(saveT); saveT = setTimeout(saveP, 400);
  } else if (el.dataset.input === 'tq') {
    S.tq = el.value;
    clearTimeout(saveT);
    saveT = setTimeout(() => { const pos = el.selectionStart; render(true); const n = main.querySelector('[data-input="tq"]'); n.focus(); n.setSelectionRange(pos, pos); }, 250);
  }
});
main.addEventListener('change', e => {
  const el = e.target, k = el.dataset.set;
  if (!k) return;
  P.set[k] = el.type === 'number' ? Math.max(+el.min || 0, Math.min(+el.max || 1e9, +el.value || 0)) : el.value;
  saveP(); applyTheme(); render(true);
  toast('Gespeichert');
});

/* ---------- Dateien laden ---------- */
$('#file').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  let content = { cards: CARDS, tasks: TASKS, loaded: { ...(CONTENT?.loaded || {}) } };
  const msgs = [];
  for (const f of files) {
    const text = await f.text();
    if (/\.json$/i.test(f.name) || /^\s*\{/.test(text)) {
      try {
        const j = JSON.parse(text);
        if (j.type === 'pruefungstrainer-backup' && j.progress) {
          if (confirm(`Sicherung vom ${new Date(j.date).toLocaleDateString('de-DE')} laden? Der aktuelle Lernstand wird ersetzt.`)) {
            P = j.progress; saveP(); loadP(); applyTheme(); msgs.push('Lernstand wiederhergestellt');
          }
        } else msgs.push(`${f.name}: unbekanntes Format`);
      } catch { msgs.push(`${f.name}: keine gültige JSON-Datei`); }
      continue;
    }
    const kind = erkenneDatei(text);
    if (kind === 'lehrbuch') { content.cards = parseLehrbuch(text); content.loaded.lehrbuch = f.name; msgs.push(`${content.cards.length} Lernkarten`); }
    else if (kind === 'aufgaben') { content.tasks = parseAufgaben(text); content.loaded.aufgaben = f.name; msgs.push(`${content.tasks.length} Aufgaben`); }
    else msgs.push(`${f.name}: Inhalt nicht erkannt`);
  }
  if (content.cards !== CARDS || content.tasks !== TASKS) {
    try { await dbSet('content', content); } catch { msgs.push('Konnte Inhalte nicht dauerhaft speichern'); }
    setContent(content);
  }
  toast(msgs.join(' · ') || 'Nichts geladen');
  if (view === 'import' && CARDS.length && TASKS.length) go('home'); else render(true);
});

/* ---------- Start ---------- */
(async function init() {
  loadP(); applyTheme();
  try { const c = await dbGet('content'); if (c) setContent(c); } catch { /* privates Fenster o. Ä. */ }
  // Nur lokal beim Entwickeln: Inhalte aus ./quelle laden (liegt nicht im öffentlichen Repo)
  if (!CARDS.length && /[?&]devdata/.test(location.search)) {
    try {
      const [lb, au] = await Promise.all(['quelle/Lehrbuch_A_WH.txt', 'quelle/TBW_WH_Aufgaben.md'].map(u => fetch(u).then(r => r.text())));
      const c = { cards: parseLehrbuch(lb), tasks: parseAufgaben(au), loaded: { lehrbuch: 'dev', aufgaben: 'dev' } };
      await dbSet('content', c); setContent(c);
    } catch (e) { console.warn(e); }
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  view = P.curExam && P.curExam.phase !== 'done' && (CARDS.length || TASKS.length) ? 'exam' : 'home';
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
