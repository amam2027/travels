import * as store from "./store.js";
import { HUES, localDate, rateOf, lengthOf, itemPlanned, expenseHome, calc, pace, expensesCSV, sharedBalance } from "./calc.js";
import { fetchLive, allCurrencies } from "./rates.js";
import { $, esc, uid, plural, fmt, fmtUpTo2, money, money2, currencyName, fmtDate, fmtDay, fmtRange } from "./util.js";
import { icon, catIcon } from "./icons.js";
import { openSheet, head, confirmSheet, pickCurrency, topSheet } from "./sheets.js";
import { openEntry } from "./entry.js";
import { openNewTrip, PRESETS } from "./newtrip.js";
import { calendar } from "./calendar.js";
import { importFile } from "./importer.js";

const KEY = "state";
const CURS = allCurrencies();
const BASIS = [["once", "Whole trip", "for the whole trip"], ["day", "Per day", "per day"], ["week", "Per week", "per week"], ["night", "Per night", "per night"],
               ["person", "Per person", "per person"], ["personday", "Per person, per day", "per person, per day"]];
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
function trip() {
  let t = s.trips.find(x => x.id === s.active);
  if (!t) { t = s.trips[0]; s.active = t ? t.id : null; }
  return t;
}
// A trip nobody has touched yet: shown as the welcome screen rather than an empty "My trip".
function pristine(t) { return !t.dest && !t.start && !t.cats.length && !t.exp.length; }
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
    t.exp = (t.exp || []).map(e => Object.assign({ note: "", date: "", itemId: null, split: 1, paidBy: "me" }, e, {
      homeAmount: e.homeAmount != null ? e.homeAmount : (Number(e.amount) || 0) * (Number(e.rate) || 0),
      home: e.home || out.home,
    }));
    return t;
  });
  if (!out.trips.length) {
    const t = newTrip("New trip");
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
  if (!topSheet()) render();
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
function basisLabel(b) { const x = BASIS.find(z => z[0] === b); return x ? x[2] : "for the whole trip"; }
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
// One-line description of a category's budget, e.g. "EUR 120 per night · booked".
function budgetText(cat) {
  const items = cat.items.filter(i => Number(i.amount) > 0);
  if (!items.length) return "No budget yet";
  if (cat.items.length === 1) {
    const it = cat.items[0];
    return it.cur + " " + fmtUpTo2(it.amount) + " " + basisLabel(it.basis) + (it.type === "fixed" ? " · booked" : "");
  }
  const booked = cat.items.every(i => i.type === "fixed") ? " · booked" : "";
  return plural(cat.items.length, "cost") + booked;
}
function multiplier(basis, c) {
  const p = plural(c.people, "person").replace("persons", "people");
  const weeks = Math.round(c.days / 7 * 10) / 10;
  return { once: "", person: "× " + p, day: "× " + plural(c.days, "day"), week: "× " + (weeks === 1 ? "1 week" : weeks + " weeks"),
    night: "× " + plural(c.nights, "night"),
    personday: "× " + plural(c.days, "day") + " × " + p }[basis] || "";
}
function expRow(e, t, withDay, inCat) {
  const c = t.cats.find(x => x.id === e.catId);
  const it = c && e.itemId && c.items.length > 1 ? c.items.find(x => x.id === e.itemId) : null;
  const title = e.note || (it ? it.name || "Untitled" : c ? c.name || "Untitled" : "Uncategorised");
  const titledByCat = !e.note && !it;   // the title already is the category name
  const sub = [withDay ? fmtDay(e.date, today()) : null, !inCat && c && !titledByCat ? c.name : null, e.note && it ? it.name : null].filter(Boolean).join(" · ");
  const status = e.split > 1 ? (e.settled ? '<span class="st ok">' + icon("check") + "settled</span>"
    : e.paidBy === "other" ? '<span class="st owe">you owe ' + M2(expenseHome(e)) + "</span>"
    : '<span class="st owed">owed to you ' + M2(expenseHome(e) * (e.split - 1)) + "</span>") : "";
  return '<div class="swipe"><button class="del" data-act="delExp" data-id="' + e.id + '" tabindex="-1">Delete</button>' +
    '<button class="row" data-act="exp" data-id="' + e.id + '">' +
      '<span class="ic" style="--h:' + hue(t, e.catId) + '">' + catIcon(c ? c.name : "") + "</span>" +
      '<span class="main"><span class="ttl">' + esc(title) + "</span>" + (sub || status ? '<span class="sub">' + esc(sub) + (sub && status ? " · " : "") + status + "</span>" : "") + "</span>" +
      '<span class="end"><span class="amt">' + M2(expenseHome(e)) + "</span>" +
        (e.split > 1 ? '<span class="amt2">÷' + e.split + " of " + money2(e.amount, e.cur) + "</span>"
          : e.cur !== s.home ? '<span class="amt2">' + money2(e.amount, e.cur) + "</span>" : "") + "</span>" +
    "</button></div>";
}
function catRow(t, cc) {
  return '<button class="row" data-act="cat" data-id="' + cc.id + '">' +
    '<span class="ic" style="--h:' + cc.color + '">' + catIcon(cc.name) + "</span>" +
    '<span class="main"><span class="ttl">' + esc(cc.name || "Untitled") + "</span>" + barHtml(cc.spent, cc.planned, cc.color) + "</span>" +
    '<span class="end"><span class="amt">' + M(cc.spent) + '</span><span class="amt2">' + (cc.planned > 0 ? "of " + fmt(cc.planned) : "no budget") + "</span></span>" +
  "</button>";
}
function needTrip(title) {
  return '<div class="lt"><h1>' + title + '</h1></div><div class="emptystate"><span class="ic plain">' + icon("suitcase") + "</span>" +
    "<h3>No trip yet</h3><p>Plan a trip first — it only takes a minute.</p>" +
    '<button class="btn" data-act="newTrip">Plan a trip</button></div>';
}

// ---- screens
function viewWelcome() {
  return '<div class="hello"><div class="hello-art" aria-hidden="true"><i style="--h:#4F6F8F;flex:3;--w:70%"></i><i style="--h:#8C6A4F;flex:2.2;--w:40%"></i>' +
    '<i style="--h:#4F7F7A;flex:1.6;--w:84%"></i><i style="--h:#7E6B8F;flex:1.2;--w:25%"></i></div>' +
    "<h1>Plan the trip.<br>Know what you can spend.</h1>" +
    "<p>Set a rough budget in a minute, log what you spend as you go — even with no signal — and see every day what's left.</p>" +
    '<button class="btn" data-act="newTrip">Plan a trip</button>' +
    '<button class="txtbtn" data-act="restore">Restore from a backup</button></div>';
}

function viewHome(t, c) {
  if (pristine(t)) return viewWelcome();
  const p = pace(t, c, today());
  let h = '<div class="lt"><button class="tripbtn" data-act="trips"><div class="eyebrow">' + esc(tripFacts(t, c)) +
    "</div><h1>" + esc(t.name || "Untitled") + icon("down") + '<span class="vh">, switch trip</span></h1></button></div>';

  // balance card
  const planned = c.planned > 0, left = c.planned - c.spent, over = planned && left < 0;
  const segs = c.cats.filter(cc => Math.max(cc.planned, cc.spent) > 0);
  h += '<section class="hero" aria-label="Budget"><div class="lbl">' + (planned ? (over ? "Over budget by" : "Left to spend") : "Spent so far") + "</div>" +
    '<div class="big' + (over ? " over" : "") + '"><span class="cur">' + s.home + "</span>" + fmt(planned ? Math.abs(left) : c.spent) + "</div>" +
    '<div class="meta">' + (planned ? "<b>" + M(c.spent) + "</b> spent of " + M(c.planned) + " budget" : "No budget set yet") + "</div>" +
    (segs.length
      ? '<div class="alloc" role="img" aria-label="Budget by category">' + segs.map(cc => {
          const size = Math.max(cc.planned, cc.spent);
          return '<span class="s" style="--h:' + cc.color + ";flex:" + size + '"><i style="width:' + Math.min(100, cc.spent / size * 100) + '%"></i></span>';
        }).join("") + "</div>"
      : "") +
    '<div class="hero-actions"><button data-act="log">' + icon("plus") + "Add expense</button>" +
    '<button data-act="tab" data-tab="budget">' + icon("budget") + (planned ? "Budget" : "Set budget") + "</button></div></section>";

  h += paceCard(t, c, p);
  if ((p.phase === "before" || (p.phase === "unknown" && t.start)) && planned) h += savingsCard(t, c);

  const stale = !s.lastBackup || Date.now() - new Date(s.lastBackup).getTime() > 14 * 86400000;
  if (s.trips.some(x => x.exp.length) && stale) {
    h += '<div class="section"><div class="list"><button class="row" data-act="backup"><span class="ic plain">' + icon("upload") + "</span>" +
      '<span class="main"><span class="ttl">Back up your trips</span><span class="sub">' +
      (s.lastBackup ? "Last backup " + fmtDate(s.lastBackup) : "Your data lives only on this phone") + "</span></span>" + icon("chevron", "chev") + "</button></div></div>";
  }

  if (t.cats.length) {
    h += '<div class="section"><div class="sh"><h2>Categories</h2></div><div class="list">' + c.cats.map(cc => catRow(t, cc)).join("") + "</div></div>";
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
    return '<button class="tint pace" data-act="editTrip"><div class="top"><div class="lbl">Daily allowance</div></div>' +
      '<p class="note">Add your travel dates to see how much you can spend each day.</p><span class="link">Add dates</span></button>';
  }
  if (c.variable <= 0 && p.phase !== "after") {
    return '<button class="tint pace" data-act="tab" data-tab="budget"><div class="top"><div class="lbl">' +
      (p.phase === "during" ? "Today · day " + p.day + " of " + p.days : "Daily allowance") + "</div></div>" +
      '<p class="note">Set a flexible budget for things like food and activities, and this shows what you can spend each day.</p>' +
      '<span class="link">Set budget</span></button>';
  }
  if (p.phase === "before") {
    lbl = "Daily allowance";
    chip = '<span class="chip neutral">' + (p.daysToGo === 1 ? "Starts tomorrow" : "Starts in " + plural(p.daysToGo, "day")) + "</span>";
    big = M(p.daily) + "<small>/ day</small>";
    note = "What you can spend each day from your flexible budget once you leave" + (c.days >= 7 ? " — about " + M(p.daily * 7) + " a week." : ".");
    extra = daysBar(p, c.days);
  } else if (p.phase === "during") {
    lbl = "Today · day " + p.day + " of " + p.days;
    if (p.left < 0 && p.leftToday <= 0) {
      big = '<span class="over">' + M(-p.left) + "</span><small>over budget</small>";
      chip = '<span class="chip over">Over budget</span>';
      note = "Flexible spending has gone past its budget for the whole trip.";
    } else {
      const over = p.leftToday < 0;
      big = over ? '<span class="over">' + M(-p.leftToday) + "</span><small>over today</small>"
                 : M(p.leftToday) + "<small>left today</small>";
      chip = over ? '<span class="chip over">Over today</span>' : "";
      extra = '<div class="todaybox"><div class="bar" style="--h:var(--pos)"><i class="' + (over ? "over" : "") + '" style="width:' +
        (p.daily > 0 ? Math.min(100, p.todaySpent / p.daily * 100) : (p.todaySpent > 0 ? 100 : 0)) + '%"></i></div>' +
        '<div class="todaylbl"><span><b>' + M(p.todaySpent) + "</b> of " + M(p.daily) + " spent today</span></div></div>";
      // Why today's number differs from the plan: earlier days' savings or overspending, spread over the days left.
      const sofar = p.day === 1 ? "" : Math.abs(p.ahead) < 1 ? "You were right on plan before today."
        : "You spent " + M(Math.abs(p.ahead)) + (p.ahead < 0 ? " less" : " more") + " than planned before today, so today's allowance is " +
          M(p.daily) + " instead of the planned " + M(p.plan) + ".";
      // Only worth saying when today's spending changes the days ahead, i.e. when it went over.
      const ahead = !over ? "" : p.tomorrow == null ? "It's the last day of the trip."
        : "Going over today trims the next " + plural(p.remainingDays - 1, "day") + " to <b>" + M(p.tomorrow) + "</b> a day.";
      note = [sofar, ahead].filter(Boolean).join(" ") || "Whatever you don't spend today rolls over to the days after.";
    }
  } else {
    lbl = "Trip finished";
    big = M(Math.abs(p.diff)) + "<small>" + (p.diff > 0 ? "over" : "under") + "</small>";
    chip = '<span class="chip ' + (p.diff > 0 ? "over" : "pos") + '">' + (p.diff > 0 ? "Over budget" : "Under budget") + "</span>";
    note = "Flexible spending compared with its budget.";
    extra = daysBar(p, c.days);
  }
  return '<div class="tint pace"><div class="top"><div class="lbl">' + lbl + "</div>" + chip + "</div>" +
    '<div class="big">' + big + "</div>" + extra + (p.phase === "during" ? daysBar(p, c.days) : "") + '<p class="note">' + note + "</p></div>";
}

function savingsCard(t, c) {
  const need = Math.max(0, c.planned - (Number(t.saved) || 0));
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const months = Math.ceil((new Date(t.start + "T00:00:00") - now) / (1000 * 60 * 60 * 24 * 30.44));
  let big, note;
  if (need <= 0) { big = "Covered"; note = "You've saved enough for the whole budget."; }
  else if (months <= 1) { big = M(need); note = "still to save before you leave."; }
  else { big = M(need / months) + "<small>/ month</small>"; note = "to save for " + plural(months, "month") + " to cover " + M(need) + "."; }
  return '<button class="plainblock pace" data-act="editTrip">' +
    '<div class="top"><div class="lbl">To be ready in time</div>' + (t.saved > 0 ? '<span class="chip pos">' + M(t.saved) + " saved</span>" : "") + "</div>" +
    '<div class="big">' + big + '</div><p class="note">' + note + "</p></button>";
}

function viewActivity(t, c) {
  if (pristine(t)) return needTrip("Activity");
  let h = '<div class="lt ltrow"><div><div class="eyebrow">' + esc(t.name || "Untitled") + "</div><h1>Activity</h1></div>" +
    (t.exp.length ? '<button class="link" data-act="import">' + icon("download") + "Import</button>" : "") + "</div>";
  if (!t.exp.length) {
    return h + '<div class="emptystate"><span class="ic plain">' + icon("activity") + "</span><h3>No expenses yet</h3>" +
      "<p>Every time you pay for something, tap + and it lands here. Or bring in card payments from your bank's CSV export.</p>" +
      '<button class="btn" data-act="log">' + icon("plus") + "Add expense</button>" +
      '<button class="txtbtn" data-act="import" style="margin-top:8px">Import from bank (CSV)</button></div>';
  }
  const hasShared = t.exp.some(e => e.split > 1);
  if (filter && filter !== "shared" && !t.cats.some(x => x.id === filter)) filter = null;
  if (filter === "shared" && !hasShared) filter = null;
  if (hasShared) {
    const b = sharedBalance(t);
    const line = Math.abs(b.net) < 0.01 ? "You're all square" : b.net > 0 ? "Friends owe you " + M2(b.net) : "You owe " + M2(-b.net);
    h += '<button class="tint shared" data-act="filter" data-id="shared"><div class="top"><div class="lbl">Shared costs</div>' + icon("users") + "</div>" +
      '<div class="big">' + line + '</div><p class="note">' + (b.owed > 0 && b.owe > 0 ? M2(b.owed) + " owed to you · " + M2(b.owe) + " you owe" : "") + "</p></button>";
  }
  h += '<div class="hscroll" role="toolbar" aria-label="Filter by category"><button class="fchip" data-act="filter" data-id="" aria-pressed="' + !filter + '">All</button>' +
    (hasShared ? '<button class="fchip" data-act="filter" data-id="shared" aria-pressed="' + (filter === "shared") + '">' + icon("users") + "Shared</button>" : "") +
    c.cats.filter(cc => cc.spent > 0).map(cc => '<button class="fchip" style="--h:' + cc.color + '" data-act="filter" data-id="' + cc.id + '" aria-pressed="' +
      (filter === cc.id) + '"><span class="dot"></span>' + esc(cc.name || "Untitled") + "</button>").join("") + "</div>";
  const list = sortedExp(t.exp.filter(e => !filter || (filter === "shared" ? e.split > 1 : e.catId === filter)));
  if (filter === "shared" && t.exp.some(e => e.split > 1 && !e.settled)) {
    h += '<div class="list"><button class="row center" data-act="settleAll"><span class="ttl">' + icon("check") + "Mark all as settled</span></button></div>";
  }
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
  if (pristine(t)) return needTrip("Budget");
  let h = '<div class="lt"><button class="eyebrow linkish" data-act="editTrip">' + esc([t.name || "Untitled", tripFacts(t, c)].join(" · ")) +
    icon("chevron") + "</button><h1>Budget</h1></div>";

  h += '<div class="bsum"><div class="big">' + M(c.planned) + '</div><div class="sub">' +
    (c.planned > 0 ? "for " + (c.known ? plural(c.days, "day") + ", " : "") + plural(c.people, "traveller") : "Tap a category to set its budget") + "</div>";
  if (c.planned > 0) {
    h += '<div class="split" role="img" aria-label="Booked ' + M(c.fixed) + ", flexible " + M(c.variable) + '"><i class="b" style="flex:' + (c.fixed || 0.0001) +
      '"></i><i class="f" style="flex:' + (c.variable || 0.0001) + '"></i></div>' +
      '<div class="legend2"><span class="b"><b>' + M(c.fixed) + "</b> booked</span><span class=\"f\"><b>" + M(c.variable) + "</b> flexible</span></div>";
  }
  h += "</div>";

  if (!t.cats.length) {
    h += '<div class="emptystate"><h3>No categories yet</h3><p>Start with the usual ones — flights, stay, food — and set an amount for each.</p>' +
      '<button class="btn" data-act="seed">Add the usual categories</button></div>';
  } else {
    h += '<div class="list section">' + t.cats.map((cat, ci) => {
      const cc = c.cats[ci];
      return '<button class="row" data-act="budgetCat" data-id="' + cat.id + '"><span class="ic" style="--h:' + cc.color + '">' + catIcon(cat.name) + "</span>" +
        '<span class="main"><span class="ttl">' + esc(cat.name || "Untitled") + '</span><span class="sub">' + esc(budgetText(cat)) + "</span></span>" +
        '<span class="end">' + (cc.planned > 0 ? '<span class="amt">' + M(cc.planned) + "</span>" : '<span class="set">Set</span>') + "</span>" + icon("chevron", "chev") + "</button>";
    }).join("") + "</div>";
  }
  h += '<div class="list"><button class="row center" data-act="addCat"><span class="ttl">' + icon("plus") + "Add category</span></button></div>";
  h += '<p class="foot">Booked costs are paid or committed. Flexible budgets — food, activities — are what your daily allowance is worked out from.</p>';
  return h;
}

function viewSettings(t) {
  let h = '<div class="lt"><h1>Settings</h1></div>';
  h += '<p class="ftitle">Trips</p><div class="list">' +
    '<button class="row" data-act="trips"><span class="ic plain">' + icon("suitcase") + '</span><span class="main"><span class="ttl">' + esc(pristine(t) ? "No trip yet" : t.name || "Untitled") +
      '</span><span class="sub">' + plural(s.trips.filter(x => !pristine(x)).length, "trip") + " · switch or plan a new one</span></span>" + icon("chevron", "chev") + "</button>" +
    (pristine(t) ? "" :
      '<button class="row" data-act="editTrip"><span class="ic plain">' + icon("pin") + '</span><span class="main"><span class="ttl">Trip details</span><span class="sub">Destination, dates, travellers</span></span>' + icon("chevron", "chev") + "</button>" +
      '<button class="row" data-act="dupTrip"><span class="ic plain">' + icon("copy") + '</span><span class="main"><span class="ttl">Duplicate trip</span><span class="sub">Same budget, no expenses</span></span></button>') +
    "</div>";

  h += '<p class="ftitle">Currencies</p><div class="list">' +
    '<button class="row" data-act="home"><span class="ic plain">' + icon("wallet") + '</span><span class="main"><span class="ttl">Home currency</span>' +
      '<span class="sub">Totals are shown in this</span></span><span class="val">' + s.home + "</span>" + icon("chevron", "chev") + "</button>" +
    Object.keys(s.rates).filter(c => c !== s.home).map(c => {
      const live = liveRate(c), manual = s.manual[c] || !live;
      return '<button class="row" data-act="rate" data-cur="' + c + '"><span class="ic plain"><span class="letter" style="font-size:12px">' + c + "</span></span>" +
        '<span class="main"><span class="ttl">' + esc(currencyName(c) || c) + '</span><span class="sub">' + (manual ? "Set by you" : "Live rate") + "</span></span>" +
        '<span class="val">' + (s.rates[c] ? String(+Number(s.rates[c]).toPrecision(4)) : "—") + "</span>" + icon("chevron", "chev") + "</button>";
    }).join("") +
    '<button class="row center" data-act="addRate"><span class="ttl">' + icon("plus") + "Add currency</span></button></div>" +
    (rateStatus() ? '<p class="foot">' + esc(rateStatus()) + "</p>" : "");

  h += '<p class="ftitle">Your data</p><div class="list">' +
    '<button class="row" data-act="backup"><span class="ic plain">' + icon("upload") + '</span><span class="main"><span class="ttl">Back up all data</span><span class="sub">' +
      (s.lastBackup ? "Last backup " + fmtDate(s.lastBackup) : "Never backed up") + "</span></span></button>" +
    '<button class="row" data-act="restore"><span class="ic plain">' + icon("download") + '</span><span class="main"><span class="ttl">Restore a backup</span></span></button>' +
    '<button class="row" data-act="import"><span class="ic plain">' + icon("download") + '</span><span class="main"><span class="ttl">Import from bank</span><span class="sub">Card payments from a CSV export</span></span></button>' +
    '<button class="row" data-act="csv"><span class="ic plain">' + icon("file") + '</span><span class="main"><span class="ttl">Export expenses</span><span class="sub">CSV for ' +
      esc(t.name || "this trip") + "</span></span></button></div>" +
    '<p class="foot">' + (storageOk ? "Everything stays on this device. The only thing the app fetches is exchange rates."
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
    '<div class="sub">' + (k.planned > 0 ? "spent of " + M(k.planned) + " · " + (left >= 0 ? M(left) + " left" : M(-left) + " over") : "spent · no budget yet") + "</div>" +
    barHtml(k.spent, k.planned, k.color) + "</div>";

  h += '<div class="list"><button class="row" data-act="budgetCat" data-id="' + id + '"><span class="ic plain">' + icon("budget") + '</span><span class="main"><span class="ttl">Budget</span>' +
    '<span class="sub">' + esc(budgetText(cat)) + '</span></span><span class="end">' + (k.planned > 0 ? '<span class="amt">' + M(k.planned) + "</span>" : '<span class="set">Set</span>') +
    "</span>" + icon("chevron", "chev") + "</button></div>";

  h += '<div class="section"><div class="sh"><h2>Expenses</h2>' + (mine.length ? '<span class="count">' + mine.length + "</span>" : "") + "</div>" + (mine.length
    ? '<div class="list">' + sortedExp(mine).map(e => expRow(e, t, true, true)).join("") + "</div>"
    : '<p class="foot" style="text-align:center;padding:20px 0">Nothing logged here yet.</p>') + "</div>";
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
  view.className = "view";
  if (key !== lastKey && anim) { void view.offsetWidth; view.className = "view " + anim; }
  lastKey = key;
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
    $("tbT").textContent = route.tab === "home" ? (pristine(t) ? "" : t.name || "Untitled") : TABS[route.tab];
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

// Tab switches are instant, like iOS. Only drilling into a category animates.
function go(tab) {
  if (route.tab === tab && !route.detail) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  route = { tab, detail: null };
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
  log: () => {
    const t = trip();
    if (pristine(t)) { startNewTrip(); return; }
    openEntry(entryCtx());
  },
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
  settleAll: async () => {
    const t = trip(), open = t.exp.filter(e => e.split > 1 && !e.settled);
    const b = sharedBalance(t);
    const ok = await confirmSheet({ title: "Mark all as settled?", confirm: "Mark settled", destructive: false,
      message: plural(open.length, "shared expense") + (b.owe > 0 ? " · you've paid back " + M2(b.owe) : "") + (b.owed > 0 ? " · you've been paid " + M2(b.owed) : "") + "." });
    if (!ok) return;
    open.forEach(e => { e.settled = true; });
    undoData = { type: "settle", tripId: t.id, ids: open.map(e => e.id) };
    persist(true); render();
    toast("All settled", true);
  },
  trips: openTrips,
  newTrip: startNewTrip,
  editTrip: openTripSheet,
  editCat: d => openCatEdit(d.id),
  addCat: () => openCatEdit(null),
  budgetCat: d => openBudget(d.id),
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
  dupTrip: duplicateTrip,
  backup, restore: () => $("restoreFile").click(), csv: exportCSV,
  import: () => {
    const t = trip();
    if (pristine(t)) { startNewTrip(); return; }
    if (!t.cats.length) { toast("Add a category first", false); return; }
    $("importFile").click();
  },
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
  else if (undoData.type === "bulk") t.exp = t.exp.filter(x => !undoData.ids.includes(x.id));
  else if (undoData.type === "settle") t.exp.forEach(x => { if (undoData.ids.includes(x.id)) x.settled = false; });
  else if (undoData.type === "edit") { const i = t.exp.findIndex(x => x.id === undoData.item.id); if (i >= 0) t.exp[i] = undoData.item; }
  else if (undoData.type === "trip") {
    s.trips = s.trips.filter(x => !pristine(x));
    s.trips.splice(Math.min(undoData.index, s.trips.length), 0, undoData.trip);
    s.active = undoData.trip.id;
  }
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
        const nowSettled = exp.settled && !t.exp[i].settled;
        t.exp[i] = exp;
        toast(nowSettled ? "Marked as paid back" : "Expense updated", true);
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

function presetCat(p, t) {
  const c = newCat(p.name);
  c.items.push({ id: uid(), name: p.name, amount: p.amount || 0, cur: p.cur || (p.home ? s.home : t.cur || s.home), basis: p.basis, type: p.type });
  return c;
}
function seedCats() {
  const t = trip();
  PRESETS.forEach(p => { if (!t.cats.some(c => c.name.toLowerCase() === p.name.toLowerCase())) t.cats.push(presetCat(p, t)); });
  persist(true); render();
}

// ---- trips
function startNewTrip() {
  openNewTrip({
    home: s.home, rate, allCurrencies: CURS, suggested: curList(), hues: HUES,
    finish(d) {
      let t = trip();
      if (!t || !pristine(t)) { t = newTrip(); s.trips.push(t); }
      Object.assign(t, { name: d.dest || "New trip", dest: d.dest, cur: d.cur && d.cur !== s.home ? d.cur : "", start: d.start, end: d.end, people: d.people });
      ensureCurrency(t.cur);
      t.cats = d.budget.map(b => presetCat(b, t));
      s.active = t.id;
      filter = null;
      persist(true);
      route = { tab: "home", detail: null };
      anim = "fade"; lastKey = "";
      render(); window.scrollTo(0, 0);
      toast(t.name + " is ready", false);
    },
  });
}

function openTrips() {
  const real = s.trips.filter(t => !pristine(t));
  openSheet({
    label: "Trips",
    render(el, api) {
      el.insertAdjacentHTML("beforeend", head("Trips", '<button class="txtbtn" data-close>Close</button>', "") +
        '<div class="sheet-body">' + (real.length ? '<div class="list">' + real.map(t => {
          const c = calc(s, t);
          return '<button class="row" data-trip="' + t.id + '"><span class="ic plain">' + icon("suitcase") + '</span><span class="main"><span class="ttl">' +
            esc(t.name || "Untitled") + '</span><span class="sub">' + esc([t.start ? fmtRange(t.start, t.end) : "No dates", c.planned > 0 ? M(c.planned) + " budget" : null].filter(Boolean).join(" · ")) +
            "</span></span>" + (t.id === s.active ? icon("check", "tick") : "") + "</button>";
        }).join("") + "</div>" : "") +
        '<div class="btns"><button class="btn" data-new>' + icon("plus") + "Plan a new trip</button>" +
        (real.some(t => t.id === s.active) ? '<button class="btn secondary" data-edit>Edit ' + esc(trip().name || "trip") + "</button>" : "") + "</div></div>");
      el.addEventListener("click", e => {
        const b = e.target.closest("[data-trip]");
        if (b) {
          s.active = b.dataset.trip;
          s.trips = s.trips.filter(x => !pristine(x) || x.id === s.active);
          filter = null;
          persist(true);
          api.close();
          route = { tab: route.tab, detail: null };
          lastKey = ""; render();
        } else if (e.target.closest("[data-new]")) { api.close(); startNewTrip(); }
        else if (e.target.closest("[data-edit]")) { api.close(); openTripSheet(); }
      });
    },
  });
}

function duplicateTrip() {
  const t = JSON.parse(JSON.stringify(trip()));
  t.id = uid(); t.name = (t.name || "Trip") + " copy"; t.saved = 0; t.exp = [];
  t.cats.forEach(c => { c.id = uid(); c.items.forEach(i => { i.id = uid(); }); });
  s.trips.push(t);
  s.active = t.id;
  persist(true); render();
  toast("Trip duplicated", false);
}

function pickDates(start, end) {
  return new Promise(resolve => {
    let result = null, d = { start, end };
    openSheet({
      label: "Dates", cls: "tall plain",
      render(el, api) {
        el.insertAdjacentHTML("beforeend", head("Dates", '<button class="txtbtn" data-close>Cancel</button>', '<button class="txtbtn strong" data-done>Done</button>') +
          '<p class="datesum"></p><div class="sheet-body"></div>');
        const sum = el.querySelector(".datesum"), done = el.querySelector("[data-done]");
        const cal = calendar({ start, end, onChange: (a, b) => { d = { start: a, end: b }; draw(); } });
        el.querySelector(".sheet-body").appendChild(cal.el);
        function draw() {
          const len = lengthOf(d);
          sum.textContent = !d.start ? "Tap your first day, then your last." : !d.end ? "Now tap your last day." :
            fmtRange(d.start, d.end) + " · " + plural(len.days, "day") + ", " + plural(len.nights, "night");
          done.disabled = !!d.start && !d.end;
        }
        done.addEventListener("click", () => { result = d; api.close(); });
        draw();
        requestAnimationFrame(() => cal.scrollToSelection());
      },
      onClose: () => resolve(result),
    });
  });
}

function openTripSheet() {
  const t = trip();
  if (pristine(t)) { startNewTrip(); return; }
  const d = { dest: t.dest || t.name, start: t.start, end: t.end, people: Math.max(1, Number(t.people) || 1), cur: t.cur, saved: Number(t.saved) || 0 };
  openSheet({
    label: "Trip", cls: "tall",
    render(el, api) {
      el.insertAdjacentHTML("beforeend", head("Trip", '<button class="txtbtn" data-close>Cancel</button>', '<button class="txtbtn strong" data-done>Done</button>') +
        '<div class="sheet-body">' +
          '<input class="bigfield" data-dest placeholder="Where to?" autocomplete="off" aria-label="Destination">' +
          '<div class="list">' +
            '<button class="row" data-dates><span class="ic plain">' + icon("calendar") + '</span><span class="main"><span class="ttl">Dates</span><span class="sub" data-dsub></span></span>' + icon("chevron", "chev") + "</button>" +
            '<div class="row"><span class="ic plain">' + icon("users") + '</span><span class="main"><span class="ttl">Travellers</span></span>' +
              '<div class="stepper"><button data-step="-1" aria-label="Fewer travellers">−</button><output aria-live="polite"></output><button data-step="1" aria-label="More travellers">+</button></div></div>' +
            '<button class="row" data-curpick><span class="ic plain">' + icon("globe") + '</span><span class="main"><span class="ttl">Local currency</span><span class="sub">Expenses start in this</span></span>' +
              '<span class="val" data-cur></span>' + icon("chevron", "chev") + "</button>" +
            '<label class="row"><span class="ic plain">' + icon("wallet") + '</span><span class="main"><span class="ttl">Saved so far</span><span class="sub">For the "ready in time" plan</span></span>' +
              '<span class="amtfield"><input data-saved inputmode="decimal" placeholder="0" aria-label="Saved so far in ' + s.home + '"><em>' + s.home + "</em></span></label>" +
          "</div>" +
          '<button class="btn secondary danger" data-del style="margin-top:28px">' + icon("trash") + "Delete trip</button>" +
        "</div>");
      const q = x => el.querySelector(x);
      q("[data-dest]").value = d.dest;
      q("[data-saved]").value = d.saved || "";
      function draw() {
        const len = lengthOf(d);
        q("[data-dsub]").textContent = d.start ? fmtRange(d.start, d.end) + (len.known ? " · " + plural(len.days, "day") : "") : "Add dates";
        q("output").textContent = d.people;
        q('[data-step="-1"]').disabled = d.people <= 1;
        q("[data-cur]").textContent = d.cur || s.home;
      }
      q("[data-dest]").addEventListener("input", e => { d.dest = e.target.value; });
      q("[data-saved]").addEventListener("input", e => { d.saved = Math.max(0, Number(e.target.value.replace(",", ".")) || 0); });
      el.querySelectorAll("[data-step]").forEach(b => b.addEventListener("click", () => { d.people = Math.max(1, Math.min(30, d.people + Number(b.dataset.step))); draw(); }));
      q("[data-dates]").addEventListener("click", async () => {
        const r = await pickDates(d.start, d.end);
        if (r) { d.start = r.start; d.end = r.end; draw(); }
      });
      q("[data-curpick]").addEventListener("click", async () => {
        const c = await pickCurrency({ title: "Local currency", current: d.cur || s.home, suggested: [s.home, ...curList()], all: CURS });
        if (c) { d.cur = c === s.home ? "" : c; draw(); }
      });
      q("[data-done]").addEventListener("click", () => {
        Object.assign(t, { dest: d.dest.trim(), start: d.start, end: d.end, people: d.people, cur: d.cur, saved: d.saved });
        if (t.dest) t.name = t.dest;
        ensureCurrency(t.cur);
        persist(true); api.close(); render();
      });
      q("[data-del]").addEventListener("click", async () => {
        const ok = await confirmSheet({ title: "Delete " + (t.name || "this trip") + "?",
          message: "Its budget and " + plural(t.exp.length, "expense") + " will be removed from this device." });
        if (!ok) return;
        api.close();
        const i = s.trips.indexOf(t);
        s.trips.splice(i, 1);
        undoData = { type: "trip", index: i, trip: t };
        if (!s.trips.length) s.trips.push(newTrip("New trip"));
        s.active = s.trips[Math.max(0, Math.min(i - 1, s.trips.length - 1))].id;
        persist(true);
        route = { tab: "home", detail: null };
        render();
        toast((t.name || "Trip") + " deleted", true);
      });
      draw();
    },
  });
}

// ---- categories and their budgets
function openCatEdit(catId) {
  const t = trip(), cat = catId ? t.cats.find(x => x.id === catId) : null;
  openSheet({
    label: cat ? "Edit category" : "New category",
    render(el, api) {
      el.insertAdjacentHTML("beforeend", head(cat ? "Edit category" : "New category", '<button class="txtbtn" data-close>Cancel</button>',
        '<button class="txtbtn strong" data-done>' + (cat ? "Done" : "Next") + "</button>") +
        '<div class="sheet-body"><input class="bigfield" data-name placeholder="e.g. Food, Car, Gifts" autocomplete="off" aria-label="Category name" enterkeyhint="done" autofocus>' +
        (cat ? '<button class="btn secondary danger" data-del>' + icon("trash") + "Delete category</button>" : "") + "</div>");
      const input = el.querySelector("[data-name]");
      input.value = cat ? cat.name : "";
      const done = () => {
        const name = input.value.trim();
        if (cat) { cat.name = name; persist(true); api.close(); render(); return; }
        api.close();
        if (!name) return;
        const nc = newCat(name);
        t.cats.push(nc);
        persist(true); render();
        openBudget(nc.id);
      };
      el.querySelector("[data-done]").addEventListener("click", done);
      input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); done(); } });
      if (cat) el.querySelector("[data-del]").addEventListener("click", async () => {
        const n = t.exp.filter(x => x.catId === cat.id).length;
        const ok = await confirmSheet({ title: "Delete " + (cat.name || "category") + "?",
          message: n ? "Its budget and " + plural(n, "expense") + " go with it." : "" });
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

const nfInt = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });

// A category's budget: one amount on the keypad, how it adds up, and whether it's booked.
function openBudget(catId) {
  const t = trip(), cat = t.cats.find(x => x.id === catId);
  if (!cat) return;
  if (cat.items.length > 1) return openBudgetSplit(cat);
  const it = cat.items[0];
  const d = it ? { ...it } : { name: cat.name, amount: 0, cur: t.cur || s.home, basis: "once", type: "variable" };
  let amt = d.amount ? String(d.amount) : "";
  ensureCurrency(d.cur);

  openSheet({
    label: (cat.name || "Category") + " budget", cls: "tall plain entry",
    render(el, api) {
      el.insertAdjacentHTML("beforeend",
        head(cat.name || "Budget", '<button class="txtbtn" data-close>Cancel</button>', '<button class="txtbtn" data-more>Rename</button>') +
        '<div class="sheet-body">' +
          '<div class="amt-area"><button class="curpill" data-cur aria-label="Change currency"><span></span>' + icon("down") + "</button>" +
            '<div class="amt-big" aria-live="polite"></div><div class="conv" data-prev></div></div>' +
          '<div class="chipwrap basisrow" role="radiogroup" aria-label="How it adds up">' +
            BASIS.map(b => '<button class="linechip" role="radio" data-basis="' + b[0] + '">' + b[1] + "</button>").join("") + "</div>" +
          '<div class="switchrow"><div><div class="ttl">Already booked</div><div class="sub">Paid or committed, so not part of your daily allowance</div></div>' +
            '<button class="switch" role="switch" data-booked aria-label="Already booked"><i></i></button></div>' +
        "</div>" +
        '<div class="entry-foot"><div class="keypad">' + ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"].map(k =>
          '<button data-k="' + k + '"' + (k === "del" ? ' aria-label="Delete last digit">' + icon("del") : k === "." ? ' aria-label="Decimal point">.' : ">" + k) + "</button>").join("") +
        '</div><button class="btn" data-save>Save budget</button><button class="txtbtn delbtn" data-split>Split into several costs</button></div>');
      const q = x => el.querySelector(x);
      const value = () => Number(amt) || 0;
      const display = () => { if (!amt) return "0"; const [i, f] = amt.split("."); return nfInt.format(Number(i) || 0) + (f !== undefined ? "." + f : ""); };

      function draw() {
        q(".curpill span").textContent = d.cur;
        const big = q(".amt-big"), txt = display();
        big.textContent = txt;
        big.classList.toggle("zero", !amt);
        big.style.fontSize = txt.length > 10 ? "40px" : txt.length > 7 ? "50px" : "";
        el.querySelectorAll("[data-basis]").forEach(b => b.setAttribute("aria-checked", b.dataset.basis === d.basis));
        q("[data-booked]").setAttribute("aria-checked", d.type === "fixed");
        const c = calc(s, t);
        const needsDates = ["day", "week", "night", "personday"].includes(d.basis) && !c.known;
        const total = itemPlanned({ amount: value(), basis: d.basis }, rate(d.cur), c.days, c.nights, c.people);
        const mult = multiplier(d.basis, c);
        q("[data-prev]").textContent = !value() ? basisLabel(d.basis).replace(/^./, x => x.toUpperCase()) :
          needsDates ? "Add trip dates to work out the total" :
          (mult ? mult + " = " : "") + M(total) + " for the trip";
      }
      function key(k) {
        if (k === "del") amt = amt.slice(0, -1);
        else if (k === ".") { if (!amt.includes(".")) amt = (amt || "0") + "."; }
        else {
          const [i, f] = amt.split(".");
          if (f !== undefined && f.length >= 2) return;
          if (f === undefined && i.length >= 9) return;
          amt = amt === "0" ? k : amt + k;
        }
        draw();
      }
      function commit() {
        d.amount = value();
        if (it) Object.assign(it, d);
        else if (d.amount) cat.items.push({ ...d, id: uid(), name: cat.name });
      }
      q(".keypad").addEventListener("click", e => { const b = e.target.closest("[data-k]"); if (b) key(b.dataset.k); });
      el.querySelectorAll("[data-basis]").forEach(b => b.addEventListener("click", () => { d.basis = b.dataset.basis; draw(); }));
      q("[data-booked]").addEventListener("click", () => { d.type = d.type === "fixed" ? "variable" : "fixed"; draw(); });
      q("[data-cur]").addEventListener("click", async () => {
        const c = await pickCurrency({ title: "Currency", current: d.cur, suggested: [t.cur, s.home, ...curList()], all: CURS });
        if (c) { ensureCurrency(c); d.cur = c; draw(); }
      });
      q("[data-save]").addEventListener("click", () => { commit(); persist(true); api.close(); render(); });
      q("[data-more]").addEventListener("click", () => { api.close(); openCatEdit(cat.id); });
      q("[data-split]").addEventListener("click", () => {
        commit();
        persist(true); api.close(); render();
        openLineEdit(cat.id, null);
      });
      el.addEventListener("keydown", e => {
        if (e.target.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
        if (/^[0-9]$/.test(e.key)) { key(e.key); e.preventDefault(); }
        else if (e.key === "." || e.key === ",") { key("."); e.preventDefault(); }
        else if (e.key === "Backspace") { key("del"); e.preventDefault(); }
        else if (e.key === "Enter" && !e.target.closest("button")) { commit(); persist(true); api.close(); render(); e.preventDefault(); }
      });
      draw();
    },
  });
}

// A category split into several costs: list them, each opens its own editor.
function openBudgetSplit(cat) {
  const t = trip();
  openSheet({
    label: (cat.name || "Category") + " budget",
    render(el, api) {
      const c = calc(s, t), k = c.cats[t.cats.indexOf(cat)];
      el.insertAdjacentHTML("beforeend", head(cat.name || "Budget", '<button class="txtbtn" data-close>Done</button>', '<button class="txtbtn" data-more>Rename</button>') +
        '<div class="sheet-body"><div class="bsum center"><div class="big">' + M(k.planned) + '</div><div class="sub">across ' + plural(cat.items.length, "cost") + "</div></div>" +
        '<div class="list">' + cat.items.map(it => '<button class="row noicon" data-item="' + it.id + '"><span class="main"><span class="ttl">' + esc(it.name || "Untitled") +
          '</span><span class="sub">' + esc(it.cur + " " + fmtUpTo2(it.amount) + " " + basisLabel(it.basis) + (it.type === "fixed" ? " · booked" : "")) + "</span></span>" +
          '<span class="end"><span class="amt">' + M(itemPlanned(it, rate(it.cur), c.days, c.nights, c.people)) + "</span></span>" + icon("chevron", "chev") + "</button>").join("") +
        '<button class="row center" data-add><span class="ttl">' + icon("plus") + "Add a cost</span></button></div></div>");
      el.addEventListener("click", e => {
        const b = e.target.closest("[data-item]");
        if (b) { api.close(); openLineEdit(cat.id, b.dataset.item); }
        else if (e.target.closest("[data-add]")) { api.close(); openLineEdit(cat.id, null); }
        else if (e.target.closest("[data-more]")) { api.close(); openCatEdit(cat.id); }
      });
    },
  });
}

function openLineEdit(catId, itemId) {
  const t = trip(), cat = t.cats.find(x => x.id === catId);
  if (!cat) return;
  const it = itemId ? cat.items.find(x => x.id === itemId) : null;
  const d = it ? { ...it } : { name: "", amount: 0, cur: t.cur || s.home, basis: "once", type: "variable" };
  ensureCurrency(d.cur);
  openSheet({
    label: it ? "Edit cost" : "New cost", cls: "tall",
    render(el, api) {
      el.insertAdjacentHTML("beforeend", head(it ? "Edit cost" : "New cost", '<button class="txtbtn" data-close>Cancel</button>',
        '<button class="txtbtn strong" data-done>' + (it ? "Done" : "Add") + "</button>") +
        '<div class="sheet-body">' +
          '<p class="ftitle">' + esc(cat.name || "Category") + '</p><input class="bigfield" data-name placeholder="What is it? e.g. Hotel" autocomplete="off" aria-label="Name"' + (it ? "" : " autofocus") + ">" +
          '<div class="list"><label class="row noicon"><span class="main"><span class="ttl">Amount</span></span><span class="amtfield"><input data-amt inputmode="decimal" placeholder="0" aria-label="Amount"></span></label>' +
          '<button class="row noicon" data-curpick><span class="main"><span class="ttl">Currency</span></span><span class="val" data-cur></span>' + icon("chevron", "chev") + "</button></div>" +
          '<p class="ftitle" style="margin-top:22px">How it adds up</p><div class="chipwrap" role="radiogroup" aria-label="How it adds up">' +
            BASIS.map(b => '<button class="linechip" role="radio" data-basis="' + b[0] + '">' + b[1] + "</button>").join("") + "</div>" +
          '<div class="switchrow"><div><div class="ttl">Already booked</div><div class="sub">Paid or committed, so not part of your daily allowance</div></div>' +
            '<button class="switch" role="switch" data-booked aria-label="Already booked"><i></i></button></div>' +
          '<p class="preview" data-prev></p>' +
          (it ? '<button class="btn secondary danger" data-del>' + icon("trash") + "Delete cost</button>" : "") +
        "</div>");
      const q = x => el.querySelector(x);
      q("[data-name]").value = d.name;
      q("[data-amt]").value = d.amount || "";
      function draw() {
        q("[data-cur]").textContent = d.cur;
        el.querySelectorAll("[data-basis]").forEach(b => b.setAttribute("aria-checked", b.dataset.basis === d.basis));
        q("[data-booked]").setAttribute("aria-checked", d.type === "fixed");
        const c = calc(s, t), val = itemPlanned(d, rate(d.cur), c.days, c.nights, c.people);
        q("[data-prev]").innerHTML = d.amount > 0 ? "Comes to <b>" + M(val) + "</b> for this trip" : "";
      }
      q("[data-name]").addEventListener("input", e => { d.name = e.target.value; });
      q("[data-amt]").addEventListener("input", e => { d.amount = Math.max(0, Number(e.target.value.replace(",", ".")) || 0); draw(); });
      el.querySelectorAll("[data-basis]").forEach(b => b.addEventListener("click", () => { d.basis = b.dataset.basis; draw(); }));
      q("[data-booked]").addEventListener("click", () => { d.type = d.type === "fixed" ? "variable" : "fixed"; draw(); });
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
$("importFile").addEventListener("change", e => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  importFile({
    state: () => s, trip, rate, ensureCurrency, hues: HUES, today,
    add(list) {
      const t = trip();
      t.exp.push(...list);
      undoData = { type: "bulk", tripId: t.id, ids: list.map(x => x.id) };
      persist(true);
      if (route.tab !== "activity" || route.detail) { route = { tab: "activity", detail: null }; }
      render();
      toast("Imported " + plural(list.length, "expense"), true);
    },
  }, f).catch(err => { console.error("Import failed:", err); toast("Couldn't read that file", false); });
});

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
window.addEventListener("offline", () => { rateState = { status: "offline" }; if (!topSheet()) render(); });

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
