import * as store from "./store.js";
import { HUES, localDate, rateOf, itemPlanned, expenseHome, calc, pace, expensesCSV } from "./calc.js";
import { fetchLive, allCurrencies } from "./rates.js";
import { $, esc, uid, plural, fmt, fmtUpTo2, money, money2, currencyName, fmtDate, fmtDay, fmtRange } from "./util.js";
import { icon, catIcon } from "./icons.js";
import { openSheet, head, confirmSheet, pickCurrency, topSheet } from "./sheets.js";
import { openEntry } from "./entry.js";

const KEY = "state";
const CURS = allCurrencies();
const SEED = [["Transport", [["Flights", 0, "person", "fixed"]]],
              ["Accommodation", [["Hotel", 0, "night", "fixed"]]],
              ["Car", [["Rental", 0, "fixed"], ["Gas", 0, "variable"]]],
              ["Food", [["Meals", 0, "personday", "variable"]]],
              ["Activities", []],
              ["Other", []]];
const BASIS = [["once", "One-off", "one-off"], ["person", "Per person", "per person"], ["day", "Per day", "per day"],
               ["night", "Per night", "per night"], ["personday", "Per person, per day", "per person per day"]];
const TABS = { home: "Home", activity: "Activity", budget: "Budget", settings: "Settings" };
const RATE_MAX_AGE = 6 * 3600 * 1000;

let s = blank();
let route = { tab: "home", detail: null };
let lastKey = "", anim = "", filter = null;
let undoData = null, toastTimer = null;
let rateState = { status: "idle", error: "" };
let saveTimer = null, dirty = false, storageOk = true;

function blank() {
  return { home: "CHF", rates: { CHF: 1, USD: 0.80, EUR: 0.94, CAD: 0.58, GBP: 1.08 }, manual: {}, live: null,
    active: null, lastCat: {}, lastBackup: null, trips: [] };
}

function newTrip(name) {
  return { id: uid(), name: name || "New trip", dest: "", cur: "", start: "", end: "", people: 1, saved: 0, cats: [], exp: [] };
}
function newCat(name) { return { id: uid(), name: name || "", items: [] }; }
function newItem(name, amount, basis, type) {
  return { id: uid(), name: name || "", amount: amount || 0, cur: s.home, basis: basis || "once", type: type || "fixed" };
}
function trip() {
  let t = s.trips.find(x => x.id === s.active);
  if (!t) { t = s.trips[0]; s.active = t ? t.id : null; }
  return t;
}
const rate = c => rateOf(s, c);
const M = n => money(n, s.home);
const M2 = n => money2(n, s.home);
const hue = (t, catId) => { const i = t.cats.findIndex(c => c.id === catId); return HUES[(i < 0 ? 0 : i) % HUES.length]; };
const today = () => localDate();

// Fills in fields added since the prototype, so old data and backups still load.
function normalize(p) {
  const out = Object.assign(blank(), p || {});
  out.rates = Object.assign({}, (p && p.rates) || blank().rates);
  out.manual = out.manual || {};
  out.lastCat = out.lastCat || {};
  out.rates[out.home] = 1;
  out.trips = (out.trips || []).map(t => {
    if (!t.end && t.days && t.start) {
      const d = new Date(t.start + "T00:00:00");
      d.setDate(d.getDate() + Math.max(0, Number(t.days) - 1));
      t.end = localDate(d);
    }
    delete t.days;
    t = Object.assign({ name: "Trip", dest: "", cur: "", start: "", end: "", people: 1, saved: 0 }, t);
    t.cats = (t.cats || []).map(c => Object.assign({ name: "" }, c, { items: c.items || [] }));
    t.exp = (t.exp || []).map(e => Object.assign({ note: "", date: "", itemId: null }, e, {
      homeAmount: e.homeAmount != null ? e.homeAmount : (Number(e.amount) || 0) * (Number(e.rate) || 0),
      home: e.home || out.home,
    }));
    return t;
  });
  if (!out.trips.length) {
    const t = newTrip("My trip");
    out.trips = [t];
    out.active = t.id;
  }
  return out;
}

// ---- saving: typing is debounced, anything structural is written at once
function persist(now) {
  dirty = true;
  clearTimeout(saveTimer);
  if (now) return flush();
  saveTimer = setTimeout(flush, 300);
}
async function flush() {
  clearTimeout(saveTimer);
  if (!dirty) return;
  dirty = false;
  try {
    await store.set(KEY, s);
    storageOk = true;
  } catch (e) {
    dirty = true;
    storageOk = false;
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flush();
  else if (!s.live || Date.now() - new Date(s.live.fetchedAt).getTime() > RATE_MAX_AGE) refreshRates();
});
window.addEventListener("pagehide", flush);

function toast(msg, withUndo) {
  const el = $("toast");
  $("toastMsg").textContent = msg;
  $("undo").style.display = withUndo ? "" : "none";
  el.classList.toggle("raised", !!topSheet());
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4500);
}

// ---- exchange rates
function curList() {
  const t = trip(), list = Object.keys(s.rates);
  if (!list.includes(s.home)) list.unshift(s.home);
  if (t && t.cur && !list.includes(t.cur)) list.push(t.cur);
  return list;
}
function liveRate(c) { return s.live && s.live.base === s.home ? s.live.rates[c] : undefined; }
function applyLive() {
  for (const c of Object.keys(s.rates)) if (c !== s.home && !s.manual[c] && liveRate(c)) s.rates[c] = liveRate(c);
}
function ensureCurrency(c) {
  if (!c || c === s.home || c in s.rates) return;
  s.rates[c] = liveRate(c) || 0;
  if (!liveRate(c)) refreshRates();
}
function setRate(c, v) {
  s.rates[c] = Math.max(0, Number(v) || 0);
  s.manual[c] = true;
  persist();
}
async function refreshRates() {
  if (!navigator.onLine) { rateState = { status: "offline" }; return; }
  if (rateState.status === "loading") return;
  rateState = { status: "loading" };
  try {
    const r = await fetchLive(s.home);
    s.live = { base: s.home, date: r.date, fetchedAt: new Date().toISOString(), rates: r.rates };
    applyLive();
    rateState = { status: "ok" };
    persist();
  } catch (e) {
    rateState = { status: "error", error: e.name === "AbortError" ? "timed out" : (navigator.onLine ? e.message : "offline") };
  }
  render();
}
function rateStatus() {
  const L = s.live && s.live.base === s.home ? s.live : null, d = L ? fmtDate(L.date) : "";
  if (rateState.status === "loading") return "Updating rates…";
  if (!navigator.onLine || rateState.status === "offline") {
    return L ? "Offline — using European Central Bank rates from " + d + "." : "Offline — rates haven't been fetched yet, so check them.";
  }
  if (rateState.status === "error") {
    return L ? "Couldn't update (" + rateState.error + ") — using rates from " + d + "." : "Couldn't fetch rates (" + rateState.error + "). Set them by hand.";
  }
  return L ? "European Central Bank reference rates of " + d + ". Tap a currency to override it." : "";
}

// ---- small view helpers
function basisLabel(b) { const x = BASIS.find(z => z[0] === b); return x ? x[2] : "one-off"; }
function tripFacts(t, c) {
  const bits = [];
  if (t.start) bits.push(fmtRange(t.start, t.end));
  bits.push(plural(c.people, "traveller"));
  return bits.join(" · ");
}
function barHtml(spent, planned, h) {
  const pct = planned > 0 ? Math.min(100, spent / planned * 100) : (spent > 0 ? 100 : 0);
  const over = planned > 0 ? spent > planned + 0.5 : spent > 0;
  return '<div class="bar" style="--h:' + h + '"><i class="' + (over ? "over" : "") + '" style="width:' + pct + '%"></i></div>';
}
function sortedExp(list) {
  return list.slice().sort((a, b) => (b.date + (b.at || "")).localeCompare(a.date + (a.at || "")));
}
function expRow(e, t, withDay, inCat) {
  const c = t.cats.find(x => x.id === e.catId);
  const it = c && e.itemId ? c.items.find(x => x.id === e.itemId) : null;
  const title = it ? it.name || "Untitled" : c ? c.name || "Untitled" : "Uncategorised";
  const sub = [withDay ? fmtDay(e.date, today()) : null, it && c && !inCat ? c.name : null, e.note || null].filter(Boolean).join(" · ");
  return '<div class="swipe"><button class="del" data-act="delExp" data-id="' + e.id + '" tabindex="-1">Delete</button>' +
    '<button class="row" data-act="exp" data-id="' + e.id + '">' +
      '<span class="ic" style="--h:' + hue(t, e.catId) + '">' + catIcon(c ? c.name : "") + "</span>" +
      '<span class="main"><span class="ttl">' + esc(title) + "</span>" + (sub ? '<span class="sub">' + esc(sub) + "</span>" : "") + "</span>" +
      '<span class="end"><span class="amt">' + M2(expenseHome(e)) + "</span>" +
        (e.cur !== s.home ? '<span class="amt2">' + money2(e.amount, e.cur) + "</span>" : "") + "</span>" +
    "</button></div>";
}
function catRow(t, cc) {
  return '<button class="row" data-act="cat" data-id="' + cc.id + '">' +
    '<span class="ic" style="--h:' + cc.color + '">' + catIcon(cc.name) + "</span>" +
    '<span class="main"><span class="ttl">' + esc(cc.name || "Untitled") + "</span>" + barHtml(cc.spent, cc.planned, cc.color) + "</span>" +
    '<span class="end"><span class="amt">' + M(cc.spent) + '</span><span class="amt2">of ' + fmt(cc.planned) + "</span></span>" +
  "</button>";
}

// ---- screens
function viewHome(t, c) {
  const p = pace(t, c, today());
  let h = '<div class="lt"><button class="tripbtn" data-act="trips"><div class="eyebrow">' + esc(tripFacts(t, c)) +
    "</div><h1>" + esc(t.name || "Untitled") + icon("down") + '<span class="vh">, switch trip</span></h1></button></div>';

  if (!t.cats.length && !t.dest && !t.exp.length) {
    return h + '<div class="card welcome"><span class="ic" style="--h:#2F6F5E">' + icon("suitcase") + "</span>" +
      "<h2>Plan your next trip</h2><p>Set where and when you're going, sketch a budget, then log what you spend — even with no signal.</p>" +
      '<div class="btns"><button class="btn" data-act="editTrip">Set up this trip</button>' +
      '<button class="btn secondary" data-act="seed">Start with the usual categories</button></div></div>';
  }

  // balance card
  const planned = c.planned > 0, left = c.planned - c.spent, over = planned && left < 0;
  const segs = c.cats.filter(cc => Math.max(cc.planned, cc.spent) > 0);
  h += '<section class="hero" aria-label="Budget"><div class="lbl">' + (planned ? (over ? "Over budget by" : "Left to spend") : "Spent so far") + "</div>" +
    '<div class="big' + (over ? " over" : "") + '"><span class="cur">' + s.home + "</span>" + fmt(planned ? Math.abs(left) : c.spent) + "</div>" +
    '<div class="meta">' + (c.planned > 0 ? "<b>" + M(c.spent) + "</b> spent of " + M(c.planned) + " planned" : "Add costs in Budget to see what's left.") + "</div>" +
    (segs.length
      ? '<div class="alloc" role="img" aria-label="Budget by category">' + segs.map(cc => {
          const size = Math.max(cc.planned, cc.spent);
          return '<span class="s" style="--h:' + cc.color + ";flex:" + size + '"><i style="width:' + Math.min(100, cc.spent / size * 100) + '%"></i></span>';
        }).join("") + "</div>" +
        '<div class="legend">' + segs.map(cc => '<span style="--h:' + cc.color + '">' + esc(cc.name || "Untitled") + "</span>").join("") + "</div>"
      : '<div class="alloc empty"></div>') +
    '<div class="hero-actions"><button data-act="log">' + icon("plus") + "Add expense</button>" +
    '<button data-act="tab" data-tab="budget">' + icon("budget") + "Budget</button></div></section>";

  h += paceCard(t, c, p);
  if ((p.phase === "before" || (p.phase === "unknown" && t.start)) && c.planned > 0) h += savingsCard(t, c);

  // backup nudge
  const stale = !s.lastBackup || Date.now() - new Date(s.lastBackup).getTime() > 14 * 86400000;
  const hasExp = s.trips.some(x => x.exp.length);
  if (hasExp && stale) {
    h += '<div class="section"><div class="list"><button class="row" data-act="backup"><span class="ic plain">' + icon("upload") + "</span>" +
      '<span class="main"><span class="ttl">Back up your trips</span><span class="sub">' +
      (s.lastBackup ? "Last backup " + fmtDate(s.lastBackup) : "Your data lives only on this phone") + "</span></span>" + icon("chevron", "chev") + "</button></div></div>";
  }

  if (t.cats.length) {
    h += '<div class="section"><div class="sh"><h2>Categories</h2><button class="link" data-act="tab" data-tab="budget">Edit</button></div>' +
      '<div class="list">' + c.cats.map(cc => catRow(t, cc)).join("") + "</div></div>";
  }
  if (t.exp.length) {
    h += '<div class="section"><div class="sh"><h2>Recent</h2><button class="link" data-act="tab" data-tab="activity">See all</button></div>' +
      '<div class="list">' + sortedExp(t.exp).slice(0, 5).map(e => expRow(e, t, true)).join("") + "</div></div>";
  }
  return h;
}

function daysBar(p, days) {
  if (days > 60) return "";
  let h = '<div class="days" aria-hidden="true">';
  for (let d = 1; d <= days; d++) {
    const cls = p.phase === "after" ? "done" : p.phase === "during" ? (d < p.day ? "done" : d === p.day ? "today" : "") : "";
    h += '<i class="' + cls + '"></i>';
  }
  return h + "</div>";
}

function paceCard(t, c, p) {
  let lbl = "", chip = "", big = "", note = "", extra = "";
  if (p.phase === "unknown") {
    return '<div class="card pace"><div class="lbl">Daily allowance</div><p class="note">Add your travel dates to see how much you can spend each day.</p>' +
      '<div class="btns"><button class="btn secondary" data-act="editTrip">' + icon("calendar") + "Add dates</button></div></div>";
  }
  if (c.variable <= 0 && p.phase !== "after") {
    lbl = p.phase === "during" ? "Today · day " + p.day + " of " + p.days : "Daily allowance";
    big = "—";
    note = "Mark flexible costs like food and activities as estimates in Budget to get a daily allowance.";
  } else if (p.phase === "before") {
    lbl = "Daily allowance";
    chip = '<span class="chip neutral">' + (p.daysToGo === 1 ? "Starts tomorrow" : "Starts in " + plural(p.daysToGo, "day")) + "</span>";
    big = M(p.daily) + "<small>/ day</small>";
    note = "What you can spend on estimated costs each day once you leave. Booked costs are already counted.";
    extra = daysBar(p, c.days);
  } else if (p.phase === "during") {
    lbl = "Today · day " + p.day + " of " + p.days;
    if (p.left < 0) {
      big = '<span class="over">' + M(-p.left) + "</span><small>over</small>";
      chip = '<span class="chip over">Over estimate</span>';
      note = "Estimated spending has gone past what you planned for the whole trip.";
    } else {
      big = M(p.daily) + "<small>/ day left</small>";
      chip = Math.abs(p.ahead) < 1 ? '<span class="chip neutral">On pace</span>'
        : p.ahead > 0 ? '<span class="chip over">' + M(p.ahead) + " over pace</span>"
        : '<span class="chip pos">' + M(-p.ahead) + " under pace</span>";
      note = M(p.left) + " of estimates left for " + (p.remainingDays > 1 ? "today and the next " + plural(p.remainingDays - 1, "day") : "today") + ".";
    }
    extra = daysBar(p, c.days);
  } else {
    lbl = "Trip finished";
    big = M(Math.abs(p.diff)) + "<small>" + (p.diff > 0 ? "over" : "under") + "</small>";
    chip = '<span class="chip ' + (p.diff > 0 ? "over" : "pos") + '">' + (p.diff > 0 ? "Over estimate" : "Under estimate") + "</span>";
    note = "Compared with what you estimated for flexible spending.";
    extra = daysBar(p, c.days);
  }
  return '<div class="card pace"><div class="top"><div class="lbl">' + lbl + "</div>" + chip + "</div>" +
    '<div class="big">' + big + "</div>" + extra + '<p class="note">' + note + "</p></div>";
}

function savingsCard(t, c) {
  const need = Math.max(0, c.planned - (Number(t.saved) || 0));
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const months = Math.ceil((new Date(t.start + "T00:00:00") - now) / (1000 * 60 * 60 * 24 * 30.44));
  let big, note;
  if (need <= 0) { big = "Covered"; note = "You've saved enough for the whole plan."; }
  else if (months <= 0) { big = M(need); note = "Still to find before you go."; }
  else { big = M(need / months) + "<small>/ month</small>"; note = "for " + plural(months, "month") + " to cover " + M(need) + "."; }
  return '<button class="card pace tripcard" data-act="editTrip" style="display:block">' +
    '<div class="top"><div class="lbl">To be ready in time</div>' + (t.saved > 0 ? '<span class="chip pos">' + M(t.saved) + " saved</span>" : "") + "</div>" +
    '<div class="big">' + big + '</div><p class="note">' + note + "</p></button>";
}

function viewActivity(t, c) {
  let h = '<div class="lt"><div class="eyebrow">' + esc(t.name || "Untitled") + "</div><h1>Activity</h1></div>";
  if (!t.exp.length) {
    return h + '<div class="emptystate"><span class="ic plain">' + icon("activity") + "</span><h3>No expenses yet</h3>" +
      "<p>Every time you pay for something, tap + and it lands here.</p>" +
      '<button class="btn" data-act="log">' + icon("plus") + "Add expense</button></div>";
  }
  if (filter && !t.cats.some(x => x.id === filter)) filter = null;
  h += '<div class="hscroll" role="toolbar" aria-label="Filter by category"><button class="fchip" data-act="filter" data-id="" aria-pressed="' + !filter + '">All</button>' +
    c.cats.filter(cc => cc.spent > 0).map(cc => '<button class="fchip" style="--h:' + cc.color + '" data-act="filter" data-id="' + cc.id + '" aria-pressed="' +
      (filter === cc.id) + '"><span class="dot"></span>' + esc(cc.name || "Untitled") + "</button>").join("") + "</div>";
  const list = sortedExp(t.exp.filter(e => !filter || e.catId === filter));
  const days = [];
  for (const e of list) {
    const last = days[days.length - 1];
    if (last && last.date === e.date) last.items.push(e); else days.push({ date: e.date, items: [e] });
  }
  h += days.map(d => '<div class="dayh"><span>' + esc(fmtDay(d.date, today())) + "</span><span>" +
    M2(d.items.reduce((a, e) => a + expenseHome(e), 0)) + '</span></div><div class="list">' + d.items.map(e => expRow(e, t, false)).join("") + "</div>").join("");
  return h;
}

function viewBudget(t, c) {
  let h = '<div class="lt"><div class="eyebrow">' + esc(t.name || "Untitled") + "</div><h1>Budget</h1></div>";
  const facts = [];
  facts.push('<span>' + icon("calendar") + (c.known ? esc(fmtRange(t.start, t.end)) + " · " + plural(c.nights, "night") : "Add dates") + "</span>");
  facts.push('<span>' + icon("users") + plural(c.people, "traveller") + "</span>");
  facts.push('<span>' + icon("globe") + esc(t.cur || s.home) + "</span>");
  h += '<button class="card tripcard" data-act="editTrip"><span class="ic plain">' + icon("pin") + '</span><span class="main"><span class="ttl">' +
    esc(t.dest || "Where to?") + '</span><span class="facts">' + facts.join("") + "</span></span>" + icon("chevron", "chev") + "</button>";

  if (c.planned > 0) {
    h += '<div class="section stats">' +
      '<div class="stat"><div class="v">' + M(c.planned) + '</div><div class="l">Planned</div></div>' +
      '<div class="stat"><div class="v">' + M(c.fixed) + '</div><div class="l">Booked</div></div>' +
      '<div class="stat"><div class="v">' + M(c.variable) + '</div><div class="l">Estimates</div></div></div>' +
      '<p class="ffoot" style="margin:10px 6px 0">' + Math.round(c.variable / c.planned * 100) + "% of the plan can still move · " + M(c.planned / c.people) + " per person</p>";
  }

  t.cats.forEach((cat, ci) => {
    const cc = c.cats[ci];
    h += '<div class="section"><div class="list">' +
      '<button class="row" data-act="cat" data-id="' + cat.id + '"><span class="ic" style="--h:' + cc.color + '">' + catIcon(cat.name) + "</span>" +
      '<span class="main"><span class="ttl">' + esc(cat.name || "Untitled") + '</span><span class="sub">' + plural(cat.items.length, "cost") + "</span></span>" +
      '<span class="end"><span class="amt">' + M(cc.planned) + "</span></span>" + icon("chevron", "chev") + "</button>" +
      cat.items.map(it => {
        const val = itemPlanned(it, rate(it.cur), c.days, c.nights, c.people);
        return '<button class="row noicon" data-act="line" data-cat="' + cat.id + '" data-id="' + it.id + '"><span class="main"><span class="ttl">' +
          esc(it.name || "Untitled") + '</span><span class="sub">' + esc(it.cur + " " + fmtUpTo2(it.amount) + " " + basisLabel(it.basis)) + " · " +
          (it.type === "variable" ? "estimate" : "booked") + '</span></span><span class="end"><span class="amt">' + M(val) + "</span></span></button>";
      }).join("") +
      '<button class="row noicon center" data-act="addLine" data-cat="' + cat.id + '"><span class="ttl">Add a cost</span></button>' +
      "</div></div>";
  });

  h += '<div class="btns" style="margin-top:28px"><button class="btn secondary" data-act="addCat">' + icon("plus") + "Add category</button>";
  if (SEED.some(sc => !t.cats.some(x => x.name.toLowerCase() === sc[0].toLowerCase()))) {
    h += '<button class="btn secondary" data-act="seed">Add the usual categories</button>';
  }
  return h + "</div>";
}

function viewSettings(t) {
  let h = '<div class="lt"><h1>Settings</h1></div>';
  h += '<p class="ftitle">Trips</p><div class="list form">' +
    '<button class="row" data-act="trips"><span class="ic plain">' + icon("suitcase") + '</span><span class="main"><span class="ttl">' + esc(t.name || "Untitled") +
      '</span><span class="sub">' + plural(s.trips.length, "trip") + " · tap to switch</span></span>" + icon("chevron", "chev") + "</button>" +
    '<button class="row" data-act="editTrip"><span class="ic plain">' + icon("pin") + '</span><span class="main"><span class="ttl">Trip details</span></span>' + icon("chevron", "chev") + "</button>" +
    '<button class="row" data-act="dupTrip"><span class="ic plain">' + icon("copy") + '</span><span class="main"><span class="ttl">Duplicate trip</span><span class="sub">Same budget, no expenses</span></span></button>' +
    '<button class="row danger" data-act="delTrip"><span class="ic plain">' + icon("trash") + '</span><span class="main"><span class="ttl">Delete trip</span></span></button></div>';

  h += '<p class="ftitle">Currencies</p><div class="list form">' +
    '<button class="row" data-act="home"><span class="ic plain">' + icon("wallet") + '</span><span class="main"><span class="ttl">Home currency</span>' +
      '<span class="sub">Totals are shown in this</span></span><span class="val">' + s.home + "</span>" + icon("chevron", "chev") + "</button>" +
    Object.keys(s.rates).filter(c => c !== s.home).map(c => {
      const live = liveRate(c), manual = s.manual[c] || !live;
      return '<button class="row" data-act="rate" data-cur="' + c + '"><span class="ic plain"><span class="letter" style="font-size:12px">' + c + "</span></span>" +
        '<span class="main"><span class="ttl">' + esc(currencyName(c) || c) + '</span><span class="sub">' + (manual ? "Set by you" : "Live rate") + "</span></span>" +
        '<span class="val">' + (s.rates[c] ? String(+Number(s.rates[c]).toPrecision(4)) : "—") + "</span>" + icon("chevron", "chev") + "</button>";
    }).join("") +
    '<button class="row noicon center" data-act="addRate"><span class="ttl">Add currency</span></button></div>' +
    (rateStatus() ? '<p class="ffoot">' + esc(rateStatus()) + "</p>" : "");

  h += '<p class="ftitle">Your data</p><div class="list form">' +
    '<button class="row" data-act="backup"><span class="ic plain">' + icon("upload") + '</span><span class="main"><span class="ttl">Back up all data</span><span class="sub">' +
      (s.lastBackup ? "Last backup " + fmtDate(s.lastBackup) : "Never backed up") + "</span></span></button>" +
    '<button class="row" data-act="restore"><span class="ic plain">' + icon("download") + '</span><span class="main"><span class="ttl">Restore a backup</span></span></button>' +
    '<button class="row" data-act="csv"><span class="ic plain">' + icon("file") + '</span><span class="main"><span class="ttl">Export expenses</span><span class="sub">CSV for ' +
      esc(t.name || "this trip") + "</span></span></button></div>" +
    '<p class="ffoot">' + (storageOk ? "Everything stays on this device. The only thing the app fetches is exchange rates."
      : "This device is refusing to save. Back up now so nothing is lost.") + "</p>";
  return h;
}

function viewCategory(id, t, c) {
  const ci = t.cats.findIndex(x => x.id === id);
  if (ci < 0) { route.detail = null; return viewHome(t, c); }
  const cat = t.cats[ci], k = c.cats[ci], left = k.planned - k.spent;
  const mine = t.exp.filter(e => e.catId === id);
  let h = '<div class="dhead"><span class="ic" style="--h:' + k.color + '">' + catIcon(cat.name) + "</span><h1>" + esc(cat.name || "Untitled") + "</h1>" +
    '<div class="big' + (k.planned > 0 && left < 0 ? " over" : "") + '">' + M(k.spent) + "</div>" +
    '<div class="sub">' + (k.planned > 0 ? "of " + M(k.planned) + " · " + (left >= 0 ? M(left) + " left" : M(-left) + " over") : "Nothing planned yet") + "</div>" +
    barHtml(k.spent, k.planned, k.color) + "</div>";

  h += '<div class="sh"><h2>Planned costs</h2></div><div class="list">' + cat.items.map(it => {
    const sp = mine.filter(e => e.itemId === it.id).reduce((a, e) => a + expenseHome(e), 0);
    const pl = itemPlanned(it, rate(it.cur), c.days, c.nights, c.people);
    return '<button class="row noicon" data-act="line" data-cat="' + id + '" data-id="' + it.id + '"><span class="main"><span class="ttl">' + esc(it.name || "Untitled") +
      '</span><span class="sub">' + (it.type === "variable" ? "Estimate" : "Booked") + " · " + basisLabel(it.basis) + '</span></span><span class="end"><span class="amt">' +
      M(sp) + '</span><span class="amt2">of ' + fmt(pl) + "</span></span></button>";
  }).join("") + '<button class="row noicon center" data-act="addLine" data-cat="' + id + '"><span class="ttl">Add a cost</span></button></div>';

  h += '<div class="section"><div class="sh"><h2>Expenses</h2></div>' + (mine.length
    ? '<div class="list">' + sortedExp(mine).map(e => expRow(e, t, true, true)).join("") + "</div>"
    : '<div class="card"><p class="note" style="color:var(--muted);text-align:center">Nothing logged here yet.</p></div>') + "</div>";
  return h;
}

// ---- render + navigation
function render() {
  const t = trip(), c = calc(s, t);
  const key = route.tab + "/" + (route.detail || "");
  let html;
  if (route.detail) html = viewCategory(route.detail, t, c);
  else html = ({ home: viewHome, activity: viewActivity, budget: viewBudget, settings: viewSettings })[route.tab](t, c);
  const view = $("view");
  view.innerHTML = html;
  if (key !== lastKey) {
    view.className = "view";
    void view.offsetWidth;
    view.className = "view " + (anim || "fade");
    lastKey = key;
  } else view.className = "view still";
  anim = "";

  const tb = $("topbar");
  tb.classList.toggle("pushed", !!route.detail);
  if (route.detail) {
    const cat = t.cats.find(x => x.id === route.detail);
    $("tbL").innerHTML = '<button class="navbtn" data-act="back">' + icon("back") + TABS[route.tab] + "</button>";
    $("tbT").textContent = cat ? cat.name || "Untitled" : "";
    $("tbR").innerHTML = '<button class="navbtn" data-act="editCat" data-id="' + route.detail + '">Edit</button>';
  } else {
    $("tbL").innerHTML = "";
    $("tbT").textContent = route.tab === "home" ? t.name || "Untitled" : TABS[route.tab];
    $("tbR").innerHTML = "";
  }
  document.querySelectorAll(".tab[data-tab]").forEach(b => {
    if (b.dataset.tab === route.tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  onScroll();
  bindSwipes();
}

function onScroll() { $("topbar").classList.toggle("solid", window.scrollY > 28); }
window.addEventListener("scroll", onScroll, { passive: true });

function go(tab) {
  if (route.tab === tab && !route.detail) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  route = { tab, detail: null };
  anim = "fade";
  render();
  window.scrollTo(0, 0);
}
function push(catId) {
  route.detail = catId;
  anim = "push";
  history.pushState({ detail: catId }, "");
  render();
  window.scrollTo(0, 0);
}
function pop() {
  if (!route.detail) return;
  route.detail = null;
  anim = "pop";
  render();
  window.scrollTo(0, 0);
}
window.addEventListener("popstate", pop);

// Swipe left on an expense to reveal Delete.
function bindSwipes() {
  $("view").querySelectorAll(".swipe .row").forEach(row => {
    let x0 = null, y0 = 0, dx = 0, mode = null;
    row.addEventListener("pointerdown", e => {
      if (e.pointerType === "mouse") return;
      x0 = e.clientX; y0 = e.clientY; mode = null; dx = 0;
    });
    row.addEventListener("pointermove", e => {
      if (x0 === null) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (!mode) {
        if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.3) {
          mode = "h"; row.classList.add("dragging");
          try { row.setPointerCapture(e.pointerId); } catch (x) {}
        } else if (Math.abs(my) > 10) { mode = "v"; return; }
        else return;
      }
      if (mode !== "h") return;
      const base = row.classList.contains("open") ? -96 : 0;
      dx = Math.min(0, Math.max(-150, base + mx));
      row.style.transform = "translateX(" + dx + "px)";
    });
    const end = () => {
      if (mode === "h") {
        row.classList.remove("dragging");
        const open = dx < -48;
        row.classList.toggle("open", open);
        row.style.transform = open ? "translateX(-96px)" : "";
        row.dataset.justSwiped = "1";
        setTimeout(() => delete row.dataset.justSwiped, 60);
      }
      x0 = null; mode = null;
    };
    row.addEventListener("pointerup", end);
    row.addEventListener("pointercancel", end);
  });
}
function closeSwipes(except) {
  document.querySelectorAll(".swipe .row.open").forEach(r => { if (r !== except) { r.classList.remove("open"); r.style.transform = ""; } });
}

// ---- actions
const actions = {
  tab: d => go(d.tab),
  log: () => openEntry(entryCtx()),
  cat: d => push(d.id),
  back: () => { if (history.state && history.state.detail) history.back(); else pop(); },
  filter: d => { filter = d.id || null; render(); },
  exp: (d, el) => {
    if (el.dataset.justSwiped) return;
    if (el.classList.contains("open")) { closeSwipes(); return; }
    const e = trip().exp.find(x => x.id === d.id);
    if (e) openEntry(entryCtx(), e);
  },
  delExp: d => removeExpense(d.id),
  trips: openTrips,
  editTrip: openTripEdit,
  editCat: d => openCatEdit(d.id),
  addCat: () => openCatEdit(null),
  line: d => openLineEdit(d.cat, d.id),
  addLine: d => openLineEdit(d.cat, null),
  seed: seedCats,
  rate: d => openRateEdit(d.cur),
  addRate: async () => {
    const c = await pickCurrency({ title: "Add currency", suggested: [trip().cur], all: CURS.filter(x => x !== s.home && !(x in s.rates)) });
    if (!c) return;
    ensureCurrency(c);
    persist(true); render();
    if (!liveRate(c)) openRateEdit(c);
  },
  home: changeHome,
  dupTrip: () => createTrip(true),
  delTrip: deleteTrip,
  backup, restore: () => $("restoreFile").click(), csv: exportCSV,
};
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el || el.closest(".sheet-wrap")) { if (!e.target.closest(".swipe")) closeSwipes(); return; }
  if (!el.closest(".swipe")) closeSwipes();
  const fn = actions[el.dataset.act];
  if (fn) fn(el.dataset, el, e);
});

$("undo").addEventListener("click", () => {
  if (!undoData) return;
  const t = s.trips.find(x => x.id === undoData.tripId) || trip();
  if (undoData.type === "cat") { t.cats.splice(undoData.index, 0, undoData.cat); t.exp = t.exp.concat(undoData.exp); }
  else if (undoData.type === "item") undoData.cat.items.splice(undoData.index, 0, undoData.item);
  else if (undoData.type === "add") t.exp = t.exp.filter(x => x.id !== undoData.item.id);
  else if (undoData.type === "edit") { const i = t.exp.findIndex(x => x.id === undoData.item.id); if (i >= 0) t.exp[i] = undoData.item; }
  else t.exp.splice(undoData.index, 0, undoData.item);
  undoData = null;
  $("toast").classList.remove("show");
  persist(true); render();
});

function entryCtx() {
  return {
    state: () => s, trip, rate, curList, allCurrencies: CURS, ensureCurrency, setRate, hues: HUES,
    save(exp, isNew) {
      const t = trip();
      if (isNew) {
        t.exp.push(exp);
        undoData = { type: "add", tripId: t.id, item: exp };
        toast("Added " + money2(exp.amount, exp.cur), true);
      } else {
        const i = t.exp.findIndex(x => x.id === exp.id);
        undoData = { type: "edit", tripId: t.id, item: t.exp[i] };
        t.exp[i] = exp;
        toast("Expense updated", true);
      }
      s.lastCat[t.id] = exp.catId;
      persist(true); render();
    },
    remove: removeExpense,
  };
}

function removeExpense(id) {
  const t = trip(), i = t.exp.findIndex(x => x.id === id);
  if (i < 0) return;
  undoData = { type: "exp", tripId: t.id, index: i, item: t.exp[i] };
  t.exp.splice(i, 1);
  persist(true); render();
  toast("Expense deleted", true);
}

function seedCats() {
  const t = trip();
  SEED.forEach(sc => {
    if (t.cats.some(c => c.name.toLowerCase() === sc[0].toLowerCase())) return;
    const c = newCat(sc[0]);
    sc[1].forEach(si => c.items.push(si.length === 4 ? newItem(si[0], si[1], si[2], si[3]) : newItem(si[0], si[1], "once", si[2])));
    t.cats.push(c);
  });
  persist(true);
  if (route.tab !== "budget") go("budget"); else render();
  toast("Added the usual categories", false);
}

// ---- sheets
function openTrips() {
  openSheet({
    label: "Trips",
    render(el, api) {
      el.insertAdjacentHTML("beforeend", head("Trips", '<button class="txtbtn" data-close>Close</button>', "") +
        '<div class="sheet-body"><div class="list">' + s.trips.map(t => {
          const c = calc(s, t);
          return '<button class="row" data-trip="' + t.id + '"><span class="ic plain">' + icon("suitcase") + '</span><span class="main"><span class="ttl">' +
            esc(t.name || "Untitled") + '</span><span class="sub">' + esc([t.start ? fmtRange(t.start, t.end) : "No dates", M(c.planned) + " planned"].join(" · ")) +
            "</span></span>" + (t.id === s.active ? icon("check", "tick") : "") + "</button>";
        }).join("") + '</div><div class="btns"><button class="btn" data-new>' + icon("plus") + "New trip</button></div></div>");
      el.querySelector(".list").addEventListener("click", e => {
        const b = e.target.closest("[data-trip]");
        if (!b) return;
        s.active = b.dataset.trip;
        filter = null;
        persist(true);
        api.close();
        route = { tab: route.tab, detail: null };
        lastKey = ""; render();
      });
      el.querySelector("[data-new]").addEventListener("click", () => { api.close(); createTrip(false); });
    },
  });
}

function createTrip(dup) {
  let t;
  if (dup) {
    t = JSON.parse(JSON.stringify(trip()));
    t.id = uid(); t.name = (t.name || "Trip") + " copy"; t.saved = 0; t.exp = [];
    t.cats.forEach(c => { c.id = uid(); c.items.forEach(i => { i.id = uid(); }); });
  } else t = newTrip("New trip");
  s.trips.push(t);
  s.active = t.id;
  persist(true);
  route = { tab: dup ? route.tab : "home", detail: null };
  lastKey = ""; render(); window.scrollTo(0, 0);
  if (dup) toast("Trip duplicated", false); else openTripEdit();
}

async function deleteTrip() {
  const t = trip();
  const ok = await confirmSheet({ title: "Delete " + (t.name || "this trip") + "?",
    message: "Its budget and " + plural(t.exp.length, "expense") + " will be removed from this device. This can't be undone." });
  if (!ok) return;
  const i = s.trips.indexOf(t);
  s.trips.splice(i, 1);
  if (!s.trips.length) s.trips.push(newTrip("My trip"));
  s.active = s.trips[Math.max(0, Math.min(i - 1, s.trips.length - 1))].id;
  undoData = null;
  persist(true);
  route = { tab: "home", detail: null };
  render();
  toast("Trip deleted", false);
}

function openTripEdit() {
  const t = trip();
  const d = { dest: t.dest, start: t.start, end: t.end, people: Math.max(1, Number(t.people) || 1), cur: t.cur, saved: Number(t.saved) || 0 };
  openSheet({
    label: "Trip details",
    render(el, api) {
      el.insertAdjacentHTML("beforeend", head("Trip details", '<button class="txtbtn" data-close>Cancel</button>', '<button class="txtbtn strong" data-done>Done</button>') +
        '<div class="sheet-body">' +
          '<p class="ftitle">Destination</p><div class="form"><label class="frow big"><input data-f="dest" placeholder="Where to?" autocomplete="off" aria-label="Destination"></label></div>' +
          '<p class="ftitle">Dates</p><div class="form"><label class="frow"><span class="k">Leaving</span><input type="date" data-f="start"></label>' +
          '<label class="frow"><span class="k">Coming back</span><input type="date" data-f="end"></label></div><p class="ffoot" data-len></p>' +
          '<div class="form"><div class="frow"><span class="k">Travellers</span><div class="stepper"><button data-step="-1" aria-label="Fewer travellers">−</button>' +
            '<output aria-live="polite"></output><button data-step="1" aria-label="More travellers">+</button></div></div>' +
          '<button class="frow" data-curpick style="width:100%"><span class="k">Local currency</span><span class="pick"><span data-cur></span>' + icon("chevron") + "</span></button></div>" +
          '<p class="ffoot">Expenses start in this currency.</p>' +
          '<p class="ftitle">Savings</p><div class="form"><label class="frow"><span class="k">Already saved</span><input data-f="saved" inputmode="decimal" placeholder="0" aria-label="Already saved, in ' +
            s.home + '"><span style="color:var(--muted)">' + s.home + "</span></label></div>" +
        "</div>");
      const q = x => el.querySelector(x);
      q('[data-f="dest"]').value = d.dest;
      q('[data-f="start"]').value = d.start;
      q('[data-f="end"]').value = d.end;
      q('[data-f="saved"]').value = d.saved || "";
      function draw() {
        q("output").textContent = d.people;
        q('[data-step="-1"]').disabled = d.people <= 1;
        q("[data-cur]").textContent = d.cur ? d.cur + (currencyName(d.cur) ? " · " + currencyName(d.cur) : "") : s.home + " (home)";
        const len = (() => {
          if (!d.start || !d.end) return d.start ? "Add a return date to get daily figures." : "";
          const n = Math.round((new Date(d.end + "T00:00:00") - new Date(d.start + "T00:00:00")) / 86400000);
          return n < 0 ? "The return date is before the start." : plural(n + 1, "day") + " · " + plural(n, "night");
        })();
        q("[data-len]").textContent = len;
        q("[data-len]").style.display = len ? "" : "none";
      }
      el.addEventListener("input", e => {
        const f = e.target.dataset.f;
        if (f === "saved") d.saved = Math.max(0, Number(e.target.value.replace(",", ".")) || 0);
        else if (f) d[f] = e.target.value;
        draw();
      });
      el.querySelectorAll("[data-step]").forEach(b => b.addEventListener("click", () => { d.people = Math.max(1, d.people + Number(b.dataset.step)); draw(); }));
      q("[data-curpick]").addEventListener("click", async () => {
        const c = await pickCurrency({ title: "Local currency", current: d.cur || s.home, suggested: [s.home, ...curList()], all: CURS });
        if (c) { d.cur = c === s.home ? "" : c; draw(); }
      });
      q("[data-done]").addEventListener("click", () => {
        Object.assign(t, { dest: d.dest.trim(), start: d.start, end: d.end, people: d.people, cur: d.cur, saved: d.saved });
        if (t.dest) t.name = t.dest;
        ensureCurrency(t.cur);
        persist(true);
        api.close();
        render();
      });
      draw();
    },
  });
}

function openCatEdit(catId) {
  const t = trip(), cat = catId ? t.cats.find(x => x.id === catId) : null;
  openSheet({
    label: cat ? "Edit category" : "New category",
    render(el, api) {
      el.insertAdjacentHTML("beforeend", head(cat ? "Edit category" : "New category", '<button class="txtbtn" data-close>Cancel</button>',
        '<button class="txtbtn strong" data-done>' + (cat ? "Done" : "Add") + "</button>") +
        '<div class="sheet-body"><div class="form"><label class="frow big"><input data-name placeholder="e.g. Food, Car, Hotels" autocomplete="off" aria-label="Category name" autofocus></label></div>' +
        (cat ? '<button class="btn secondary danger" data-del>' + icon("trash") + "Delete category</button>" : "") + "</div>");
      const input = el.querySelector("[data-name]");
      input.value = cat ? cat.name : "";
      const done = () => {
        const name = input.value.trim();
        if (cat) cat.name = name;
        else if (name) t.cats.push(newCat(name));
        else return api.close();
        persist(true); api.close(); render();
      };
      el.querySelector("[data-done]").addEventListener("click", done);
      input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); done(); } });
      if (cat) el.querySelector("[data-del]").addEventListener("click", async () => {
        const n = t.exp.filter(x => x.catId === cat.id).length;
        const ok = await confirmSheet({ title: "Delete " + (cat.name || "category") + "?",
          message: n ? "Its " + plural(cat.items.length, "planned cost") + " and " + plural(n, "expense") + " go with it." : "" });
        if (!ok) return;
        const ci = t.cats.indexOf(cat);
        undoData = { type: "cat", tripId: t.id, index: ci, cat, exp: t.exp.filter(x => x.catId === cat.id) };
        t.cats.splice(ci, 1);
        t.exp = t.exp.filter(x => x.catId !== cat.id);
        api.close();
        if (route.detail === cat.id) { route.detail = null; anim = "pop"; }
        persist(true); render();
        toast((cat.name || "Category") + " deleted", true);
      });
    },
  });
}

function openLineEdit(catId, itemId) {
  const t = trip(), cat = t.cats.find(x => x.id === catId);
  if (!cat) return;
  const it = itemId ? cat.items.find(x => x.id === itemId) : null;
  const d = it ? { ...it } : { name: "", amount: 0, cur: t.cur || s.home, basis: "once", type: "fixed" };
  ensureCurrency(d.cur);
  openSheet({
    label: it ? "Edit cost" : "New cost", cls: "tall",
    render(el, api) {
      el.insertAdjacentHTML("beforeend", head(it ? "Edit cost" : "New cost", '<button class="txtbtn" data-close>Cancel</button>',
        '<button class="txtbtn strong" data-done>' + (it ? "Done" : "Add") + "</button>") +
        '<div class="sheet-body">' +
          '<p class="ftitle">' + esc(cat.name || "Category") + '</p><div class="form"><label class="frow big"><input data-name placeholder="What is it? e.g. Hotel" autocomplete="off" aria-label="Name"' +
            (it ? "" : " autofocus") + "></label></div>" +
          '<div class="form"><label class="frow"><span class="k">Amount</span><input data-amt inputmode="decimal" placeholder="0" aria-label="Amount"></label>' +
          '<button class="frow" data-curpick style="width:100%"><span class="k">Currency</span><span class="pick"><span data-cur></span>' + icon("chevron") + "</span></button></div>" +
          '<p class="ftitle">How it adds up</p><div class="list form" role="radiogroup" aria-label="How it adds up">' +
            BASIS.map(b => '<button class="row noicon" role="radio" data-basis="' + b[0] + '"><span class="main"><span class="ttl">' + b[1] + "</span></span>" + icon("check", "tick") + "</button>").join("") +
          "</div>" +
          '<div class="form"><div class="frow"><span class="k">Status</span><div class="seg" role="group" aria-label="Status"><button data-type="fixed">Booked</button><button data-type="variable">Estimate</button></div></div></div>' +
          '<p class="ffoot">Booked costs are committed. Estimates are what your daily allowance is built from.</p>' +
          '<p class="preview" data-prev></p>' +
          (it ? '<button class="btn secondary danger" data-del>' + icon("trash") + "Delete cost</button>" : "") +
        "</div>");
      const q = x => el.querySelector(x);
      q("[data-name]").value = d.name;
      q("[data-amt]").value = d.amount || "";
      function draw() {
        q("[data-cur]").textContent = d.cur;
        el.querySelectorAll("[data-basis]").forEach(b => {
          const on = b.dataset.basis === d.basis;
          b.setAttribute("aria-checked", on);
          b.querySelector(".tick").style.visibility = on ? "" : "hidden";
        });
        el.querySelectorAll("[data-type]").forEach(b => b.setAttribute("aria-pressed", b.dataset.type === d.type));
        const c = calc(s, t), val = itemPlanned(d, rate(d.cur), c.days, c.nights, c.people);
        q("[data-prev]").innerHTML = d.amount > 0 ? "Comes to <b>" + M(val) + "</b> for this trip" +
          (!c.known && ["day", "night", "personday"].includes(d.basis) ? " — add dates for the real total" : "") : "";
      }
      q("[data-name]").addEventListener("input", e => { d.name = e.target.value; });
      q("[data-amt]").addEventListener("input", e => { d.amount = Math.max(0, Number(e.target.value.replace(",", ".")) || 0); draw(); });
      el.querySelectorAll("[data-basis]").forEach(b => b.addEventListener("click", () => { d.basis = b.dataset.basis; draw(); }));
      el.querySelectorAll("[data-type]").forEach(b => b.addEventListener("click", () => { d.type = b.dataset.type; draw(); }));
      q("[data-curpick]").addEventListener("click", async () => {
        const c = await pickCurrency({ title: "Currency", current: d.cur, suggested: [t.cur, s.home, ...curList()], all: CURS });
        if (c) { ensureCurrency(c); d.cur = c; draw(); }
      });
      q("[data-done]").addEventListener("click", () => {
        d.name = d.name.trim();
        if (it) Object.assign(it, d);
        else if (d.name || d.amount) cat.items.push({ ...d, id: uid() });
        persist(true); api.close(); render();
      });
      if (it) q("[data-del]").addEventListener("click", () => {
        const idx = cat.items.indexOf(it);
        undoData = { type: "item", tripId: t.id, cat, index: idx, item: it };
        cat.items.splice(idx, 1);
        persist(true); api.close(); render();
        toast((it.name || "Cost") + " deleted", true);
      });
      draw();
    },
  });
}

function openRateEdit(cur) {
  const live = liveRate(cur);
  openSheet({
    label: cur + " rate",
    render(el, api) {
      el.insertAdjacentHTML("beforeend", head(currencyName(cur) || cur, '<button class="txtbtn" data-close>Cancel</button>', '<button class="txtbtn strong" data-done>Save</button>') +
        '<div class="sheet-body"><div class="rateedit"><span>1 ' + cur + ' =</span><input inputmode="decimal" aria-label="Rate in ' + s.home + '" autofocus><span>' + s.home + "</span></div>" +
        '<p class="preview">' + (live ? "European Central Bank rate of " + fmtDate(s.live.date) + ": <b>" + live + "</b>" : "The European Central Bank doesn't publish " + cur + ", so set it yourself.") + "</p>" +
        '<p class="preview">Past expenses keep the rate they were logged at.</p>' +
        '<div class="btns">' + (live && s.manual[cur] ? '<button class="btn secondary" data-live>Use the live rate</button>' : "") +
        '<button class="btn secondary danger" data-rm>Remove ' + cur + "</button></div></div>");
      const input = el.querySelector("input");
      input.value = s.rates[cur] || "";
      const save = () => {
        const v = Number(input.value.replace(",", ".")) || 0;
        if (live && Math.abs(v - live) < 1e-9) delete s.manual[cur];
        else if (v !== s.rates[cur]) s.manual[cur] = true;
        s.rates[cur] = v;
        persist(true); api.close(); render();
      };
      el.querySelector("[data-done]").addEventListener("click", save);
      input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); save(); } });
      const lb = el.querySelector("[data-live]");
      if (lb) lb.addEventListener("click", () => { delete s.manual[cur]; s.rates[cur] = live; persist(true); api.close(); render(); });
      el.querySelector("[data-rm]").addEventListener("click", () => { delete s.rates[cur]; delete s.manual[cur]; persist(true); api.close(); render(); });
    },
  });
}

// Switching home currency rescales every stored home amount, so totals stay meaningful.
async function changeHome() {
  const nh = await pickCurrency({ title: "Home currency", current: s.home, suggested: [s.home, ...Object.keys(s.rates)], all: CURS });
  const oh = s.home;
  if (!nh || nh === oh) return;
  const x = Number(s.rates[nh]) || 0;     // old-home units per 1 new-home unit
  const hasExp = s.trips.some(t => t.exp.length);
  if (!x && hasExp) {
    toast("Add a rate for " + nh + " first", false);
    return;
  }
  if (hasExp && !(await confirmSheet({ title: "Switch to " + nh + "?", message: "Past expenses will be converted at 1 " + nh + " = " + x + " " + oh + ".", confirm: "Switch", destructive: false }))) return;
  if (x) {
    for (const c of Object.keys(s.rates)) s.rates[c] = Number((s.rates[c] / x).toPrecision(6));
    s.rates[oh] = Number((1 / x).toPrecision(6));
    s.trips.forEach(t => {
      t.saved = Math.round((Number(t.saved) || 0) / x);
      t.exp.forEach(ex => { ex.rate = Number((ex.rate / x).toPrecision(6)); ex.homeAmount = ex.homeAmount / x; ex.home = nh; });
    });
  } else {
    for (const c of Object.keys(s.rates)) s.rates[c] = 0;
  }
  s.home = nh;
  s.rates[nh] = 1;
  delete s.manual[nh];
  persist(true); render();
  refreshRates();
}

// ---- files: CSV export, backup, restore
async function saveFile(name, text, type) {
  const file = new File([text], name, { type });
  if (matchMedia("(pointer:coarse)").matches && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; }
    catch (e) { if (e.name === "AbortError") return false; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return true;
}
function slug(t) { return (t || "trip").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "trip"; }

function exportCSV() {
  const t = trip();
  if (!t.exp.length) { toast("No expenses to export yet", false); return; }
  saveFile(slug(t.name) + "-expenses.csv", expensesCSV(s, t), "text/csv");
}
async function backup() {
  await flush();
  const data = JSON.stringify({ app: "travels", version: 1, exportedAt: new Date().toISOString(), state: s }, null, 1);
  if (await saveFile("trips-backup-" + localDate() + ".json", data, "application/json")) {
    s.lastBackup = new Date().toISOString();
    persist(true); render();
    toast("Backup saved", false);
  }
}
$("restoreFile").addEventListener("change", async e => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  let p;
  try {
    const j = JSON.parse(await f.text());
    p = j && j.state ? j.state : j;
    if (!p || !Array.isArray(p.trips)) throw new Error("not a backup");
  } catch (err) {
    toast("That file isn't a Trips backup", false);
    return;
  }
  const nExp = p.trips.reduce((a, t) => a + ((t.exp && t.exp.length) || 0), 0);
  if (!(await confirmSheet({ title: "Restore this backup?", message: "It has " + plural(p.trips.length, "trip") + " and " + plural(nExp, "expense") +
    ". Everything currently on this device will be replaced.", confirm: "Replace and restore" }))) return;
  s = normalize(p);
  route = { tab: "home", detail: null };
  await persist(true);
  render();
  toast("Backup restored", false);
  refreshRates();
});

window.addEventListener("online", refreshRates);
window.addEventListener("offline", () => { rateState = { status: "offline" }; render(); });

(async function start() {
  let p = null;
  try { p = await store.get(KEY); }
  catch (e) { storageOk = false; }
  s = normalize(p);
  history.replaceState({}, "");
  render();
  if (!p) persist(true);
  store.persist();
  refreshRates();
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !location.search.includes("sw");
  if ("serviceWorker" in navigator && !local) {
    // When a new version takes over, reload into it — but never while a sheet is open.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", async () => {
      if (!hadController || topSheet()) return;
      await flush();
      location.reload();
    });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  }
})();
