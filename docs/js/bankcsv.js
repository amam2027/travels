// Reads a bank's CSV export into transactions. Pure functions, no DOM, so it runs under node too.
// Works out the layout from the file itself: delimiter, where the table starts, which column is what.

export function decode(bytes) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch (e) { text = new TextDecoder("windows-1252").decode(bytes); }   // older Swiss bank exports
  return text.replace(/^﻿/, "");
}

export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).slice(0, 30);
  let best = ",", bestScore = -1;
  for (const d of [";", ",", "\t", "|"]) {
    const counts = lines.map(l => l.split(d).length - 1).filter(n => n > 0);
    const score = counts.length ? counts.reduce((a, b) => a + b, 0) : 0;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

export function parseCSV(text, delim) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(c => c.trim()));
}

// Column roles, matched against lower-cased header text (English, German, French, Italian).
const ROLES = {
  date: [
    // The day you actually paid beats the day the bank booked it.
    [/^(trade date|transaction date|abschlussdatum|transaktionsdatum|date de transaction|date d'opération|data operazione|purchase date)$/, 5],
    [/^(booking date|buchungsdatum|date de comptabilisation|data di registrazione|posting date)$/, 4],
    [/^(value date|valuta|valutadatum|date de valeur|data valuta)$/, 2],
    [/date|datum|data\b/, 1],
  ],
  debit: [[/^(debit|belastung|débit|debit amount|withdrawal|withdrawals|money out|lastschrift|addebito|ausgang)( \(?\w{3}\)?)?$/, 5], [/debit|belastung|débit|lastschrift/, 2]],
  credit: [[/^(credit|gutschrift|crédit|credit amount|deposit|deposits|money in|accredito|eingang)( \(?\w{3}\)?)?$/, 5], [/credit|gutschrift|crédit/, 2]],
  amount: [[/^(amount|betrag|montant|importo|individual amount|einzelbetrag|transaction amount|amount \(?\w{3}\)?)$/, 5], [/amount|betrag|montant|importo/, 2]],
  currency: [[/^(currency|währung|waehrung|monnaie|devise|valuta della transazione|ccy|curr\.?)$/, 5], [/currency|währung|devise/, 2]],
  desc: [[/^(description|beschreibung|text|details|booking text|buchungstext|libellé|libelle|descrizione|merchant|payee|recipient|counterparty|narrative|description ?\d)$/, 5],
         [/descr|beschreib|buchungstext|libell|text|merchant|payee|details/, 2]],
  ref: [[/transaction no|transaktions-nr|reference|referenz|référence|riferimento/, 3]],
  bankcat: [[/^(category|kategorie|catégorie|categoria|rubrik)$/, 5]],
  balance: [[/balance|saldo|solde/, 5]],
};

function scoreHeader(h, role) {
  let best = 0;
  for (const [re, sc] of ROLES[role]) if (re.test(h) && sc > best) best = sc;
  return best;
}

// Picks the best column for each role. Description can span several columns.
export function mapColumns(headers) {
  const hs = headers.map(h => h.toLowerCase().replace(/\s+/g, " ").trim());
  const m = { date: -1, debit: -1, credit: -1, amount: -1, currency: -1, desc: [], ref: -1, bankcat: -1 };
  const taken = new Set();
  hs.forEach((h, i) => { if (scoreHeader(h, "balance")) taken.add(i); });
  for (const role of ["date", "debit", "credit", "amount", "currency", "ref", "bankcat"]) {
    let bi = -1, bs = 0;
    hs.forEach((h, i) => { if (taken.has(i)) return; const sc = scoreHeader(h, role); if (sc > bs) { bs = sc; bi = i; } });
    if (bi >= 0) { m[role] = bi; taken.add(bi); }
  }
  hs.forEach((h, i) => { if (!taken.has(i) && scoreHeader(h, "desc")) m.desc.push(i); });
  return m;
}

function usable(m) { return m.date >= 0 && (m.debit >= 0 || m.amount >= 0); }

// Finds the header row: banks often put account details above the table.
export function findTable(rows) {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const r = rows[i];
    if (r.filter(Boolean).length < 3) continue;
    const m = mapColumns(r);
    if (usable(m)) return { headerIndex: i, headers: r, map: m };
  }
  return null;
}

// "1'234.50", "1.234,50", "-12.30", "(12.30)", "12.30-", "CHF 12.30" → number, or NaN.
export function parseAmount(s) {
  if (s == null) return NaN;
  let t = String(s).trim();
  if (!t) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  t = t.replace(/[A-Za-z]{3}\s*/g, "").replace(/[\s'’`]/g, "");
  if (/-$/.test(t)) { neg = true; t = t.slice(0, -1); }
  if (/^[-−]/.test(t)) { neg = true; t = t.slice(1); }
  if (t.startsWith("+")) t = t.slice(1);
  const lastComma = t.lastIndexOf(","), lastDot = t.lastIndexOf(".");
  if (lastComma > lastDot) {
    // comma is the decimal mark when followed by 1–2 digits, otherwise a thousands separator
    t = /,\d{1,2}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else t = t.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
  const n = Number(t);
  return neg ? -n : n;
}

// "13.10.2026", "13.10.26", "13/10/2026", "2026-10-13", "2026-10-13 14:02" → "2026-10-13", or "".
export function parseDate(s) {
  const t = String(s || "").trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return iso(y, +m[2], +m[1]);
  }
  return "";
}
function iso(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

// Turns rows into outgoing payments using a column map. Credits (money in) are left out.
export function extract(rows, headerIndex, map, fallbackCur) {
  const body = rows.slice(headerIndex + 1);
  let signed = false;
  if (map.debit < 0 && map.amount >= 0) signed = body.some(r => parseAmount(r[map.amount]) < 0);
  const out = [];
  for (const r of body) {
    const date = parseDate(r[map.date]);
    if (!date) continue;
    let amount;
    if (map.debit >= 0) {
      const dv = parseAmount(r[map.debit]);
      if (!(Math.abs(dv) > 0)) continue;           // no debit: a credit or a summary line
      amount = Math.abs(dv);
    } else {
      const a = parseAmount(r[map.amount]);
      if (!(Math.abs(a) > 0)) continue;
      if (signed && a > 0) continue;               // positive = money in
      amount = Math.abs(a);
    }
    const desc = map.desc.map(i => r[i]).filter(Boolean).join(" · ").replace(/\s+/g, " ").trim();
    const cur = (map.currency >= 0 && /^[A-Z]{3}$/.test(r[map.currency] || "") ? r[map.currency] : fallbackCur);
    const ref = map.ref >= 0 && r[map.ref] ? r[map.ref] : date + "|" + amount.toFixed(2) + "|" + desc.slice(0, 40);
    const bankCat = map.bankcat >= 0 ? r[map.bankcat] || "" : "";
    out.push({ date, amount: Math.round(amount * 100) / 100, cur, desc, ref, bankCat });
  }
  return out;
}

export function readStatement(text, fallbackCur) {
  const delim = detectDelimiter(text);
  const rows = parseCSV(text, delim);
  const table = findTable(rows);
  if (!table) return { ok: false, rows, delim };
  return { ok: true, delim, rows, ...table, tx: extract(rows, table.headerIndex, table.map, fallbackCur) };
}

// Suggests an icon-kind for a merchant description; the app maps kinds to the trip's categories.
const MERCHANT = [
  ["plane", /flights?\b|airlines?\b|airline|airways|\bair\b|easyjet|ryanair|swiss int|lufthansa|\bklm\b|tap air|iberia|vueling|wizz|edelweiss|flight/i],
  ["bed", /accommodation|lodging|unterkunft|hébergement|hotel|hostel|airbnb|booking\.com|marriott|hilton|ibis|accor|novotel|lodg|guesthouse|pension|b&b/i],
  ["car", /\bfuel|petrol|\bgas station|tankstelle|\bshell\b|\besso\b|\bbp\b|galp|repsol|parking|parkhaus|toll|hertz|europcar|sixt|avis/i],
  ["train", /public transport|öffentlicher verkehr|transports? publics?|mobility|\buber\b|\bbolt\b|taxi|cabify|metro|subway|\bbus\b|train|rail|\bsbb\b|\bcff\b|\bffs\b|renfe|sncf|trenitalia|comboios|ferry|transit|tfl|carris|ticketautomat/i],
  ["food", /groceries|lebensmittel|alimentation|dining|eating out|food & drink|restaurant|ristorante|resto|café|cafe|coffee|starbucks|\bbar\b|pizz|burger|mcdonald|kfc|bakery|boulangerie|bäckerei|pastel|tasca|food|grocery|supermarket|migros|\bcoop\b|lidl|aldi|carrefour|\bspar\b|pingo doce|continente|mercadona|delhaize|tesco|sainsbury|monoprix|franprix|7-eleven|eat|kitchen|bistro|brasserie/i],
  ["star", /leisure|entertainment|freizeit|loisirs|culture|sport|museum|museu|musée|ticket|tour|\bpark\b|zoo|aquarium|cinema|theatre|theater|concert|getyourguide|viator|klook|tiqets|admission|entrance/i],
  ["bag", /shopping|clothing|kleidung|vêtements|shop|store|boutique|\bzara\b|h&m|uniqlo|apple store|fnac|souvenir|primark|decathlon|el corte/i],
];
// The merchant text wins; the bank's own category ("Groceries") is the fallback.
export function guessKind(desc, bankCat) {
  for (const text of [desc, bankCat]) for (const [kind, re] of MERCHANT) if (re.test(text || "")) return kind;
  return null;
}

// Drops masked card numbers, expiry dates and generic words from a bank description.
const GENERIC = /^(card payment|debit card|kartenzahlung|zahlung debitkarte|paiement (par )?carte|pagamento carta|purchase|e-banking|einkauf|achat)$/i;
export function cleanDesc(desc) {
  return (desc || "").split(" · ").map(part => part
    .replace(/\b\d{4}[X*x•]{4,}\d{0,4}\b/g, "")      // 4397XXXXXXXX4974
    .replace(/\b(0[1-9]|1[0-2])\/\d{2}\b/g, "")         // 03/28
    .replace(/\s{2,}/g, " ").trim())
    .filter(p => p && !GENERIC.test(p)).slice(0, 2).join(" · ").slice(0, 80);
}
