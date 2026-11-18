// Wandelt die Quelldateien (Lehrbuch-Text und Aufgaben-Markdown) in Lernkarten und Prüfungsaufgaben um.
// Läuft komplett auf dem Handy; die Lerninhalte selbst liegen nicht im öffentlichen App-Code.
'use strict';

const FAECHER = {
  vwl:  { name: 'VWL/BWL', kurz: 'VWL/BWL' },
  rewe: { name: 'Rechnungswesen', kurz: 'ReWe' },
  ma:   { name: 'Material- und Absatzwirtschaft', kurz: 'Mat./Abs.' },
};

// Lehrbuch: Kapitel 1 = VWL/BWL, 2 + 3 (Finanzierung/Investition) = Rechnungswesen, 4 = Material/Absatz
function fachAusKapitel(major) {
  return major === 1 ? 'vwl' : (major === 2 || major === 3) ? 'rewe' : 'ma';
}

function vergleiche(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

const VERBINDER = /\b(der|des|und|als|sowie|von|im|in|zur|zum|mit|für|bei|unter|einer|eines|soziale|den|die|das|dem|auf|aus|nach)$/;

function parseLehrbuch(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  let first = null;
  for (const l of lines) { const m = /^S\. (\d+)\b/.exec(l); if (m) { first = +m[1]; break; } }
  let page = first ? first - 1 : 0;
  let kapKey = [0, 0, 0], kap = null, fach = 'vwl';
  let prevNr = 0, cur = null;
  const cards = [], ids = new Set();

  const fertig = () => {
    if (!cur) return;
    const a = cur.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (a.length > 3) {
      let id = cur.id;
      while (ids.has(id)) id += '+';
      ids.add(id);
      cards.push({ id, fach: cur.fach, kap: cur.kap, nr: cur.nr, frage: cur.frage, antwort: a, seite: cur.seite });
    }
    cur = null;
  };

  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    const pm = /^S\. (\d+)\s?(.*)$/.exec(l);
    if (pm) { page = +pm[1]; l = pm[2]; }

    // Kapitelüberschrift x.y.z Titel (nur aufsteigend, damit Tabellenzeilen nicht stören)
    const cm = /^([1-4])\.(\d{1,2})\.(\d{1,2}) ([A-ZÄÖÜ„"].*)$/.exec(l.trim());
    if (cm) {
      const k = [+cm[1], +cm[2], +cm[3]];
      if (vergleiche(k, kapKey) > 0 && k[2] <= 20 && k[1] <= 12) {
        fertig();
        let title = cm[4].trim();
        const nx = (lines[i + 1] || '').trim();
        if (VERBINDER.test(title) && nx && /^[A-Za-zÄÖÜäöü]/.test(nx) && nx.length < 70) { title += ' ' + nx; i++; }
        kapKey = k;
        kap = `${k.join('.')} ${title}`;
        fach = fachAusKapitel(k[0]);
        prevNr = 0;
        continue;
      }
    }

    // Frage: "01. …?" mit fortlaufender Nummer
    const qm = /^(\d{2,3})\. (.+)$/.exec(l.trim());
    if (qm && kap) {
      const n = +qm[1];
      if (n === prevNr + 1 || n === 1) {
        let q = qm[2].trim(), j = i;
        while (!/\?\s*$/.test(q) && j < i + 3 && lines[j + 1] !== undefined && !/^\d{2,3}\. /.test(lines[j + 1].trim())) {
          j++;
          q += ' ' + lines[j].replace(/^S\. \d+\s?/, '').trim();
        }
        if (/\?\s*$/.test(q) || (/\?/.test(q) && j === i)) {
          fertig();
          for (let k = i + 1; k <= j; k++) { const p2 = /^S\. (\d+)/.exec(lines[k]); if (p2) page = +p2[1]; }
          const seite = page;
          i = j;
          prevNr = n;
          cur = { id: `${kapKey.join('.')}-${String(n).padStart(2, '0')}`, fach, kap, nr: n, frage: q.replace(/\s+\?/, '?'), seite, lines: [] };
          continue;
        }
      }
    }

    if (cur) {
      const t = l.replace(/\s+$/, '');
      if (t === 'INFO') continue;
      cur.lines.push(t);
    }
  }
  fertig();
  return cards;
}

function parseAufgaben(md) {
  const blocks = md.replace(/\r/g, '').split(/^## /m).slice(1);
  const out = [];
  for (const b of blocks) {
    const nl = b.indexOf('\n');
    const head = b.slice(0, nl).trim();
    let body = b.slice(nl + 1);
    const hm = /^(.+?) – Aufgabensatz "([^"]+)" – Stand (.+?) – Aufgabe (\d+)/.exec(head);
    if (!hm) continue;
    const fach = /VWL|BWL/.test(hm[1]) ? 'vwl' : /Rechnung/.test(hm[1]) ? 'rewe' : 'ma';
    body = body.replace(/\n-{3,}\s*$/, '');

    let quellen = '';
    const ai = body.indexOf('**Aufgabenstellung:**');
    const li = body.indexOf('**Lösung / Lösungsweg:**');
    if (ai < 0 || li < 0) continue;
    const thema = (/\*\*Thema:\*\*\s*(.+)/.exec(body) || [, ''])[1].trim();
    const punkte = parseFloat(((/\*\*Punkte:\*\*\s*([\d,]+)/.exec(body) || [, '0'])[1]).replace(',', '.')) || 0;
    let aufg = body.slice(ai + 21, li);
    let loes = body.slice(li + 24);
    const qi = loes.search(/^(### |> Hinweis: Diese Aufgabe enthält)/m);
    if (qi >= 0) { quellen = loes.slice(qi).trim(); loes = loes.slice(0, qi); }

    const tp = aufg.split(/^\*\*Teil ([^)*]+)\)\.?\*\*[ \t]*$/m);
    const intro = tp[0].trim();
    const teile = [];
    for (let k = 1; k < tp.length; k += 2) {
      const text = tp[k + 1].trim();
      const ms = [...text.matchAll(/\((\d+(?:,\d+)?)?\s*P(?:unkte|kt)?\.?\)/g)].map(m => m[1] ? parseFloat(m[1].replace(',', '.')) : 0);
      teile.push({ label: tp[k].trim(), text, punkte: ms.length ? ms[ms.length - 1] : 0, summe: ms.reduce((s, x) => s + x, 0) });
    }
    // Teilpunkte als Aufzählung (z. B. 4P. + 7P. + 3P.) aufsummieren, wenn nur so die Gesamtpunktzahl aufgeht
    if (teile.reduce((s, t) => s + t.punkte, 0) !== punkte && teile.reduce((s, t) => s + t.summe, 0) === punkte) teile.forEach(t => t.punkte = t.summe);
    teile.forEach(t => delete t.summe);
    const lp = loes.split(/^\*\*zu Teil ([^)*]+)\)\.?\*\*\.?[ \t]*$/m);
    const allgemein = lp[0].trim();
    const loesungen = {};
    for (let k = 1; k < lp.length; k += 2) loesungen[lp[k].trim()] = lp[k + 1].trim();
    if (!teile.length) teile.push({ label: '', text: '', punkte });
    // fehlende Teilpunkte aus der Gesamtpunktzahl auffüllen
    const offen = teile.filter(t => !t.punkte);
    if (offen.length) {
      const rest = Math.max(0, punkte - teile.reduce((s, t) => s + t.punkte, 0));
      offen.forEach(t => t.punkte = Math.round(rest / offen.length * 2) / 2 || 1);
    }
    if (!teile[0].label) loesungen[''] = (allgemein + '\n\n' + Object.values(loesungen).join('\n\n')).trim();

    const satz = hm[2].replace(/\s+/g, ' ');
    out.push({
      id: `${fach}-${satz.replace(/\W+/g, '')}-${hm[4]}`,
      fach, satz, nr: +hm[4], stand: hm[3], thema, punkte: punkte || teile.reduce((s, t) => s + t.punkte, 0),
      intro, teile, loesungen, allgemein: teile[0].label ? allgemein : '', quellen,
    });
  }
  return out;
}

// Erkennt anhand des Inhalts, welche Datei geladen wurde.
function erkenneDatei(text) {
  if (/^## .+Aufgabensatz "/m.test(text)) return 'aufgaben';
  if (/^\d{2}\. .+\?\s*$/m.test(text) && /^S\. \d+/m.test(text)) return 'lehrbuch';
  return null;
}

if (typeof module !== 'undefined') module.exports = { parseLehrbuch, parseAufgaben, erkenneDatei, FAECHER };
