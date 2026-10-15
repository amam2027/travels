import * as store from "./store.js";
import { HUES, BASIS, localDate, rateOf, lengthOf, itemPlanned, expenseHome, calc, pace, expensesCSV } from "./calc.js";
import { fetchLive, allCurrencies } from "./rates.js";
import { initEntry } from "./entry.js";

const KEY = "state";
const CURS = allCurrencies();
const SEED = [["Transport", [["Flights", 0, "person", "fixed"]]],
              ["Accommodation", [["Hotel", 0, "night", "fixed"]]],
              ["Car", [["Rental", 0, "fixed"], ["Gas", 0, "variable"]]],
              ["Food", [["Meals", 0, "personday", "variable"]]],
              ["Activities", []],
              ["Other", []]];
const RATE_MAX_AGE = 6 * 3600 * 1000;

let s = blank();
let view = "plan", undoData = null, toastTimer = null, detailCat = null;
let rateState = { status: "idle", error: "" };
let saveTimer = null, dirty = false, storageOk = true;

function blank() {
  return { home: "CHF", rates: { CHF: 1, USD: 0.80, EUR: 0.94, CAD: 0.58, GBP: 1.08 }, manual: {}, live: null,
    active: null, lastCat: {}, lastBackup: null, trips: [] };
}

const $ = id => document.getElementById(id);
function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); }
const nf0 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 2 });
function fmt(n) { return nf0.format(Math.round(n)); }
function money(n, c) { return (c || s.home) + " " + fmt(n); }
function moneyExact(n, c) { return (c || s.home) + " " + nf2.format(Number(n) || 0); }
function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function rate(c) { return rateOf(s, c); }
function narrow() { return window.matchMedia("(max-width:860px)").matches; }
function fmtDate(d) {
  if (!d) return "";
  const x = new Date(d.slice(0, 10) + "T00:00:00");
  const o = { day: "numeric", month: "short" };
  if (x.getFullYear() !== new Date().getFullYear()) o.year = "numeric";
  return x.toLocaleDateString("en-GB", o);
}
function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }

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
function catOf(id) { return trip().cats.find(c => c.id === id); }

// Fills in fields added since the prototype, so old data and backups still load.
function normalize(p) {
  const out = Object.assign(blank(), p || {});
  out.rates = Object.assign({}, (p && p.rates) || blank().rates);
  out.manual = out.manual || {};
  out.lastCat = out.lastCat || {};
  out.rates[out.home] = 1;
  out.trips = (out.trips || []).map(t => {
    if (!t.end && t.days) {
      if (t.start) {
        const d = new Date(t.start + "T00:00:00");
        d.setDate(d.getDate() + Math.max(0, Number(t.days) - 1));
        t.end = localDate(d);
      }
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
    const t = newTrip("Trip 1");
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
    if (!storageOk) { storageOk = true; renderBackupNote(); }
  } catch (e) {
    dirty = true;
    storageOk = false;
    renderBackupNote();
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flush();
  else if (!s.live || Date.now() - new Date(s.live.fetchedAt).getTime() > RATE_MAX_AGE) refreshRates();
});
window.addEventListener("pagehide", flush);

function toast(msg, withUndo) {
  const el = $("toast");
  (document.querySelector("dialog[open]") || document.body).appendChild(el);
  $("toastMsg").textContent = msg;
  $("undo").style.display = withUndo ? "" : "none";
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 5000);
}

function curList() {
  const t = trip();
  const list = Object.keys(s.rates);
  if (!list.includes(s.home)) list.unshift(s.home);
  if (t && t.cur && !list.includes(t.cur)) list.push(t.cur);
  return list;
}
function curOptions(sel) {
  return curList().map(c => '<option value="' + c + '"' + (c === sel ? " selected" : "") + ">" + c + "</option>").join("");
}

// ---- exchange rates
function liveRate(c) { return s.live && s.live.base === s.home ? s.live.rates[c] : undefined; }
function applyLive() {
  for (const c of Object.keys(s.rates)) {
    if (c !== s.home && !s.manual[c] && liveRate(c)) s.rates[c] = liveRate(c);
  }
}
function ensureCurrency(c) {
  if (!c || c === s.home || c in s.rates) return;
  s.rates[c] = liveRate(c) || 0;
}
function setRate(c, v) {
  s.rates[c] = Math.max(0, Number(v) || 0);
  s.manual[c] = true;
  paint(); persist();
}
async function refreshRates() {
  if (!navigator.onLine) { rateState = { status: "offline" }; renderRateStat(); return; }
  if (rateState.status === "loading") return;
  rateState = { status: "loading" };
  renderRateStat();
  try {
    const r = await fetchLive(s.home);
    s.live = { base: s.home, date: r.date, fetchedAt: new Date().toISOString(), rates: r.rates };
    applyLive();
    rateState = { status: "ok" };
    persist();
  } catch (e) {
    rateState = { status: "error", error: e.name === "AbortError" ? "timed out" : (navigator.onLine ? e.message : "offline") };
  }
  if (!$("rates").contains(document.activeElement)) renderRates();
  renderRateStat();
  paint();
}
function renderRateStat() {
  const L = s.live && s.live.base === s.home ? s.live : null;
  const d = L ? fmtDate(L.date) : "";
  let msg = "";
  if (rateState.status === "loading") msg = "Fetching today's rates…";
  else if (!navigator.onLine || rateState.status === "offline") {
    msg = L ? "Offline — using the ECB rates from " + d + "." : "Offline — rates have not been fetched yet, so check them by hand.";
  } else if (rateState.status === "error") {
    msg = L ? "Couldn't update (" + rateState.error + ") — using the ECB rates from " + d + "."
            : "Couldn't fetch rates (" + rateState.error + "). Enter them by hand.";
  } else if (L) msg = "ECB reference rates of " + d + ". Edit one to override it.";
  $("rateStat").textContent = msg;
}

// ---- rendering
function renderTabs() {
  const box = $("trips");
  box.innerHTML = "";
  s.trips.forEach(t => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = t.name || "Untitled";
    b.setAttribute("aria-current", String(t.id === s.active));
    b.addEventListener("click", () => { s.active = t.id; render(); persist(); });
    box.appendChild(b);
  });
  const add = document.createElement("button");
  add.className = "chip";
  add.textContent = "+";
  add.setAttribute("aria-label", "New trip");
  add.addEventListener("click", () => create(false));
  box.appendChild(add);
}

function renderCats() {
  const t = trip(), box = $("cats");
  box.innerHTML = "";
  if (!t.cats.length) {
    const d = document.createElement("div");
    d.className = "panel";
    d.innerHTML = '<div class="blank">No categories yet. Make one per thing you will pay for — Car, Food, Accommodation — then put the individual costs inside it.</div>';
    box.appendChild(d);
    return;
  }
  t.cats.forEach((c, ci) => {
    const color = HUES[ci % HUES.length];
    const p = document.createElement("div");
    p.className = "panel";
    p.dataset.cat = c.id;
    const head = document.createElement("div");
    head.className = "cathead";
    head.innerHTML = '<span class="dot" style="background:' + color + '"></span>' +
      '<input class="cname" type="text" placeholder="Category name" aria-label="Category name">' +
      '<button class="sum"></button><button class="x" aria-label="Remove category">&times;</button>';
    head.querySelector(".cname").value = c.name;
    p.appendChild(head);

    c.items.forEach(it => {
      const r = document.createElement("div");
      r.className = "item" + (it.type === "variable" ? " variable" : "");
      r.dataset.item = it.id;
      r.innerHTML =
        '<div class="l1">' +
          '<input class="name" type="text" placeholder="What is it?" aria-label="Line name">' +
          '<input class="amt" type="number" min="0" step="10" inputmode="decimal" placeholder="0" aria-label="Amount">' +
          '<select class="mini cur" aria-label="Currency">' + curOptions(it.cur) + "</select>" +
        "</div>" +
        '<div class="l2">' +
          '<button class="mini type" aria-pressed="' + (it.type === "fixed") + '">' + (it.type === "fixed" ? "fixed" : "estimate") + "</button>" +
          '<select class="mini basis" aria-label="How it scales">' +
            BASIS.map(b => '<option value="' + b[0] + '"' + (b[0] === it.basis ? " selected" : "") + ">" + b[1] + "</option>").join("") +
          "</select>" +
          '<span class="grow"></span><span class="conv"></span>' +
        "</div>" +
        '<button class="del" aria-label="Remove line">&times;</button>';
      r.querySelector(".name").value = it.name;
      r.querySelector(".amt").value = it.amount || "";
      p.appendChild(r);
    });

    const add = document.createElement("div");
    add.className = "addline";
    add.innerHTML = '<button class="mini addItem">+ add a line</button>';
    p.appendChild(add);
    box.appendChild(p);
  });
}

function renderRates() {
  const box = $("rates");
  box.innerHTML = "";
  Object.keys(s.rates).forEach(c => {
    if (c === s.home) return;
    const live = liveRate(c);
    const d = document.createElement("div");
    d.className = "rate";
    d.dataset.cur = c;
    d.innerHTML = "<span>1 " + c + ' =</span><input type="number" step="any" min="0" inputmode="decimal" aria-label="Rate for ' + c + '">' +
      "<span>" + s.home + "</span>" +
      (s.manual[c] && live ? '<button class="reset" aria-label="Use the live rate for ' + c + '">live</button>'
        : (!live ? '<span class="src">manual</span>' : "")) +
      '<button class="rm" aria-label="Remove ' + c + '">&times;</button>';
    d.querySelector("input").value = s.rates[c] || "";
    box.appendChild(d);
  });
  if (box.children.length === 0) {
    box.innerHTML = '<div class="blank" style="padding:6px 0">Only ' + s.home + " so far. Add a currency for where you are going.</div>";
  }
  $("addRate").innerHTML = '<option value="">+ Add currency</option>' +
    CURS.filter(c => c !== s.home && !(c in s.rates)).map(c => "<option>" + c + "</option>").join("");
  renderRateStat();
}

function sortedExp(list) {
  return list.slice().sort((a, b) => (b.date + (b.at || "")).localeCompare(a.date + (a.at || "")));
}
function expRow(e, t) {
  const c = t.cats.find(x => x.id === e.catId);
  const it = c && e.itemId ? c.items.find(x => x.id === e.itemId) : null;
  const d = document.createElement("div");
  d.className = "exp";
  d.dataset.id = e.id;
  const title = (c ? c.name || "Untitled" : "?") + (it ? " — " + (it.name || "Untitled") : "");
  d.innerHTML = '<div class="w"><div class="t">' + esc(title) + "</div>" +
    '<div class="d">' + esc(fmtDate(e.date) + (e.note ? " · " + e.note : "")) + "</div></div>" +
    '<div class="v">' + money(expenseHome(e)) + (e.cur !== s.home ? "<small>" + moneyExact(e.amount, e.cur) + " @ " + e.rate + "</small>" : "") + "</div>" +
    '<button class="del" aria-label="Remove expense">&times;</button>';
  return d;
}
function renderExp() {
  const t = trip(), box = $("expList");
  box.innerHTML = "";
  if (!t.exp.length) {
    box.innerHTML = '<div class="blank">Nothing logged yet. Every time you pay for something, tap Log expense.</div>';
    $("expTotal").textContent = "";
    return;
  }
  sortedExp(t.exp).forEach(e => box.appendChild(expRow(e, t)));
  $("expTotal").textContent = money(calc(s, t).spent);
}

function progBar(spent, planned, color) {
  const pct = planned > 0 ? Math.min(100, spent / planned * 100) : (spent > 0 ? 100 : 0);
  const over = planned > 0 ? spent > planned : spent > 0;
  return '<div class="prog"><i class="' + (over ? "over" : "") + '" style="width:' + pct + "%;background:" + color + '"></i></div>';
}
function renderCatList() {
  const t = trip(), box = $("catList"), c = calc(s, t);
  if (!t.cats.length) {
    box.innerHTML = '<div class="blank">Add categories under Plan first.</div>';
    return;
  }
  box.innerHTML = c.cats.map(cc =>
    '<button class="catrow" data-cat="' + cc.id + '">' +
      '<span class="nm"><span class="dot" style="background:' + cc.color + '"></span><span>' + esc(cc.name || "Untitled") + "</span></span>" +
      '<span class="vv"><b>' + money(cc.spent) + "</b> of " + money(cc.planned) + "</span>" +
      progBar(cc.spent, cc.planned, cc.color) +
    "</button>").join("");
}

function renderPace(t, c) {
  const p = pace(t, c, localDate());
  const title = $("paceTitle"), n = $("paceN"), sub = $("paceSub");
  n.className = "n";
  if (p.phase === "unknown") {
    title.textContent = "Pace"; n.textContent = "—";
    sub.textContent = "Add travel dates to see a daily allowance.";
  } else if (c.variable <= 0 && p.phase !== "after") {
    title.textContent = p.phase === "during" ? "Day " + p.day + " of " + p.days : "Daily allowance";
    n.textContent = "—";
    sub.textContent = "Mark some lines as estimates (food, activities…) to get a daily allowance to pace against.";
  } else if (p.phase === "before") {
    title.textContent = "Daily allowance";
    n.textContent = money(p.daily);
    sub.textContent = "a day for variable spending, once you leave in " + plural(p.daysToGo, "day") + ". Fixed costs are not included.";
  } else if (p.phase === "during") {
    title.textContent = "Day " + p.day + " of " + p.days;
    if (p.left < 0) {
      n.textContent = money(-p.left) + " over";
      n.className = "n over";
      sub.textContent = "Variable spending has gone past its estimate for the whole trip.";
    } else {
      n.textContent = money(p.daily) + " a day";
      const diff = Math.abs(p.ahead) < 1 ? "Right on plan" :
        p.ahead > 0 ? money(p.ahead) + " ahead of plan — spending faster than budgeted" :
                      money(-p.ahead) + " behind plan — spending slower than budgeted";
      n.className = "n " + (p.ahead > 0 ? "over" : "ok");
      sub.textContent = diff + ". That allowance covers today" +
        (p.remainingDays > 1 ? " and the " + plural(p.remainingDays - 1, "day") + " after it." : ".");
    }
  } else {
    title.textContent = "Trip finished";
    n.textContent = money(Math.abs(p.diff));
    n.className = "n " + (p.diff > 0 ? "over" : "ok");
    sub.textContent = (p.diff > 0 ? "over" : "under") + " the estimate for variable spending.";
  }
  return p;
}

function renderBackupNote() {
  const el = $("backupNote");
  if (!storageOk) { el.textContent = "This browser is refusing to save. Back up now so nothing is lost."; return; }
  el.textContent = s.lastBackup
    ? "Last backup " + fmtDate(s.lastBackup) + ". Your data lives only on this device."
    : "No backup yet. Your data lives only on this device — back up to iCloud Drive or Files now and then.";
}

function paint() {
  const t = trip(), c = calc(s, t);
  const left = c.planned - c.spent;

  $("big").textContent = c.planned > 0 ? money(Math.abs(left)) : "—";
  $("big").className = "big" + (left < 0 ? " over" : "");
  $("bigCap").textContent = left < 0 ? "over the budget" : (t.dest ? "left of the " + t.dest + " budget" : "left of the budget");
  $("sPlanned").textContent = money(c.planned);
  $("sSpent").textContent = money(c.spent);
  $("sPer").textContent = money(c.planned / c.people);

  document.querySelectorAll(".homeName").forEach(el => { el.textContent = s.home; });

  if (c.known) {
    $("lenA").textContent = plural(c.days, "day");
    $("lenB").textContent = plural(c.nights, "night");
  } else if (t.start && t.end) {
    $("lenA").textContent = ""; $("lenB").textContent = "ends before it starts";
  } else {
    $("lenA").textContent = ""; $("lenB").textContent = t.start ? "add a return date" : "";
  }

  // category headers + item conversions
  t.cats.forEach((cat, ci) => {
    const p = document.querySelector('.panel[data-cat="' + cat.id + '"]');
    if (!p) return;
    const cc = c.cats[ci];
    const sum = p.querySelector(".sum");
    sum.innerHTML = cc.spent > 0 ? ("<b>" + money(cc.spent) + "</b> of " + money(cc.planned)) : ("<b>" + money(cc.planned) + "</b>");
    sum.setAttribute("aria-label", (cat.name || "Category") + ": " + sum.textContent + ". Show expenses");
    cat.items.forEach(it => {
      const r = p.querySelector('.item[data-item="' + it.id + '"]');
      if (!r) return;
      const val = itemPlanned(it, rate(it.cur), c.days, c.nights, c.people);
      r.querySelector(".conv").innerHTML = (it.cur !== s.home || it.basis !== "once") ? "= " + money(val) : "";
    });
  });

  // stack
  // Scale to the sum of segments, so an overspent category never pushes the last one out of the box.
  const base = Math.max(1, c.cats.reduce((a, cc) => a + Math.max(cc.planned, cc.spent), 0)), vert = !narrow();
  let h = "", run = 0;
  c.cats.forEach(cc => {
    if (cc.planned <= 0 && cc.spent <= 0) return;
    const size = Math.max(cc.planned, cc.spent);
    const p = size / base * 100;
    const pos = vert ? ("left:0;right:0;top:" + run + "%;height:" + p + "%")
                     : ("top:0;bottom:0;left:" + run + "%;width:" + p + "%;right:auto");
    run += p;
    const fillPct = size > 0 ? Math.min(100, cc.spent / size * 100) : 0;
    const label = (cc.name || "Untitled") + " — " + money(cc.spent) + " of " + money(cc.planned);
    h += '<div class="seg" role="button" tabindex="0" data-cat="' + cc.id + '" style="' + pos + ";background:" + cc.color +
      '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' +
      '<div class="fill" style="width:' + fillPct + '%"></div>' +
      (vert && p > 9 ? "<span>" + esc(cc.name || "Untitled") + "</span>" + (p > 17 ? "<em>" + money(cc.planned) + "</em>" : "") : "") + "</div>";
  });
  $("stack").innerHTML = h;

  // saving plan
  const need = Math.max(0, c.planned - (Number(t.saved) || 0));
  let months = 0;
  if (t.start) {
    const d = new Date(t.start + "T00:00:00"), now = new Date();
    now.setHours(0, 0, 0, 0);
    months = Math.ceil((d - now) / (1000 * 60 * 60 * 24 * 30.44));
  }
  const pm = $("perMonth"), sub = $("monthSub");
  if (!t.start) { pm.textContent = "—"; pm.className = "n"; sub.textContent = "Add a start date to see how much to put aside each month."; }
  else if (months <= 0) {
    pm.textContent = need > 0 ? money(need) : "Covered"; pm.className = "n" + (need > 0 ? " over" : "");
    sub.textContent = need > 0 ? "Departure has arrived — this is the gap still open." : "Fully funded.";
  } else {
    pm.textContent = money(need / months); pm.className = "n";
    sub.textContent = "a month for " + plural(months, "month") + ", to cover " + money(need) + ".";
  }

  $("fvSub").innerHTML = c.planned > 0
    ? "<b>" + money(c.fixed) + "</b> locked in, <b>" + money(c.variable) + "</b> in estimates. " +
      Math.round(c.variable / c.planned * 100) + "% of this budget can still move."
    : "Mark each line fixed or estimate to see how much of the trip is still uncertain.";

  renderPace(t, c);
  renderCatList();

  const n = $("note");
  if (c.planned <= 0) n.textContent = "Build the categories first — rough numbers are fine, you can correct them as you book.";
  else if (c.spent > c.planned) n.textContent = "You are " + money(c.spent - c.planned) + " past the plan. The category bars show where it went.";
  else if (c.spent > 0) {
    let worst = null;
    c.cats.forEach(cc => { if (cc.planned > 0 && (!worst || cc.spent / cc.planned > worst.spent / worst.planned)) worst = cc; });
    n.textContent = worst && worst.spent > 0
      ? (worst.name || "Untitled") + " is the furthest along at " + Math.round(worst.spent / worst.planned * 100) + "% of its budget."
      : "";
  } else n.textContent = "";

  if ($("detail").open) renderDetail();
}

function render() {
  const t = trip();
  if (!t) { create(false); return; }
  $("dest").value = t.dest || "";
  $("start").value = t.start || "";
  $("end").value = t.end || "";
  $("people").value = t.people || "";
  $("saved").value = t.saved || "";
  $("home").innerHTML = CURS.map(c => "<option" + (c === s.home ? " selected" : "") + ">" + c + "</option>").join("");
  $("tcur").innerHTML = '<option value="">' + s.home + " (home)</option>" +
    CURS.filter(c => c !== s.home).map(c => "<option" + (c === t.cur ? " selected" : "") + ">" + c + "</option>").join("");
  renderTabs(); renderCats(); renderRates(); renderExp(); renderBackupNote(); paint();
}

function setView(v) {
  view = v;
  $("tPlan").setAttribute("aria-selected", String(v === "plan"));
  $("tSpend").setAttribute("aria-selected", String(v === "spend"));
  $("planView").classList.toggle("hide", v !== "plan");
  $("spendView").classList.toggle("hide", v !== "spend");
}
$("tPlan").addEventListener("click", () => setView("plan"));
$("tSpend").addEventListener("click", () => { setView("spend"); renderExp(); paint(); });

// ---- category detail
function openDetail(catId) {
  detailCat = catId;
  renderDetail();
  if (!$("detail").open) $("detail").showModal();
}
function renderDetail() {
  const t = trip(), c = calc(s, t);
  const ci = t.cats.findIndex(x => x.id === detailCat);
  if (ci < 0) { if ($("detail").open) $("detail").close(); return; }
  const cat = t.cats[ci], k = c.cats[ci];
  $("dDot").style.background = k.color;
  $("dTitle").textContent = cat.name || "Untitled";
  $("dN").textContent = money(k.spent);
  $("dN").className = "n" + (k.planned > 0 && k.spent > k.planned ? " over" : "");
  const left = k.planned - k.spent;
  $("dSub").textContent = k.planned > 0
    ? "spent of " + money(k.planned) + " planned — " + (left >= 0 ? money(left) + " left" : money(-left) + " over")
    : "spent — nothing planned for this category yet";
  const prog = $("detail").querySelector(".dsum .prog");
  prog.outerHTML = progBar(k.spent, k.planned, k.color);

  const mine = t.exp.filter(e => e.catId === cat.id);
  const lines = cat.items.map(it => {
    const spent = mine.filter(e => e.itemId === it.id).reduce((a, e) => a + expenseHome(e), 0);
    const planned = itemPlanned(it, rate(it.cur), c.days, c.nights, c.people);
    return '<div class="dline"><span>' + esc(it.name || "Untitled") + (it.type === "variable" ? " <i>(estimate)</i>" : "") + "</span>" +
      '<span class="vv"><b>' + money(spent) + "</b> of " + money(planned) + "</span></div>";
  });
  const whole = mine.filter(e => !e.itemId || !cat.items.some(it => it.id === e.itemId)).reduce((a, e) => a + expenseHome(e), 0);
  if (whole > 0 || !cat.items.length) lines.push('<div class="dline"><span>Whole category</span><span class="vv"><b>' + money(whole) + "</b></span></div>");
  $("dLines").innerHTML = lines.join("");

  const box = $("dList");
  box.innerHTML = "";
  if (!mine.length) box.innerHTML = '<div class="blank">Nothing logged here yet.</div>';
  sortedExp(mine).forEach(e => box.appendChild(expRow(e, t)));
  $("dTotal").textContent = mine.length ? plural(mine.length, "expense") : "";
}
$("dClose").addEventListener("click", () => $("detail").close());
$("catList").addEventListener("click", e => { const b = e.target.closest(".catrow"); if (b) openDetail(b.dataset.cat); });
$("stack").addEventListener("click", e => { const b = e.target.closest(".seg"); if (b) openDetail(b.dataset.cat); });
$("stack").addEventListener("keydown", e => {
  const b = e.target.closest(".seg");
  if (b && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openDetail(b.dataset.cat); }
});

// ---- expenses
function afterExpenseChange() { renderExp(); paint(); }
function removeExpense(id) {
  const t = trip();
  const i = t.exp.findIndex(x => x.id === id);
  if (i < 0) return;
  undoData = { type: "exp", index: i, item: t.exp[i] };
  t.exp.splice(i, 1);
  persist(true);
  afterExpenseChange();
  toast("Expense removed", true);
}
document.addEventListener("click", e => {
  const del = e.target.closest(".exp .del");
  if (del) removeExpense(del.closest(".exp").dataset.id);
});

const entry = initEntry({
  state: () => s, trip, money, moneyExact, rate, curList, ensureCurrency, setRate, hues: HUES,
  save(exp) {
    const t = trip();
    t.exp.push(exp);
    s.lastCat[t.id] = exp.catId;
    persist(true);
    undoData = { type: "exp", index: t.exp.length - 1, item: exp };
    afterExpenseChange();
    toast("Added " + moneyExact(exp.amount, exp.cur), true);
  },
});
$("logBtn").addEventListener("click", () => entry.open());

// ---- categories & items
$("cats").addEventListener("input", e => {
  const p = e.target.closest(".panel"); if (!p) return;
  const c = catOf(p.dataset.cat); if (!c) return;
  if (e.target.classList.contains("cname")) { c.name = e.target.value; paint(); persist(); return; }
  const r = e.target.closest(".item"); if (!r) return;
  const it = c.items.find(x => x.id === r.dataset.item); if (!it) return;
  if (e.target.classList.contains("name")) it.name = e.target.value;
  else if (e.target.classList.contains("amt")) it.amount = Math.max(0, Number(e.target.value) || 0);
  paint(); persist();
});
$("cats").addEventListener("change", e => {
  const p = e.target.closest(".panel"); if (!p) return;
  const c = catOf(p.dataset.cat); if (!c) return;
  const r = e.target.closest(".item"); if (!r) return;
  const it = c.items.find(x => x.id === r.dataset.item); if (!it) return;
  if (e.target.classList.contains("cur")) it.cur = e.target.value;
  if (e.target.classList.contains("basis")) it.basis = e.target.value;
  paint(); persist();
});
$("cats").addEventListener("click", e => {
  const p = e.target.closest(".panel"); if (!p) return;
  const c = catOf(p.dataset.cat); if (!c) return;

  if (e.target.closest(".sum")) { openDetail(c.id); return; }
  if (e.target.closest(".addItem")) {
    c.items.push(newItem()); renderCats(); paint(); persist();
    const rows = document.querySelectorAll('.panel[data-cat="' + c.id + '"] .item');
    if (rows.length) rows[rows.length - 1].querySelector(".name").focus();
    return;
  }
  if (e.target.closest(".cathead .x")) {
    const t = trip(), ci = t.cats.indexOf(c);
    undoData = { type: "cat", index: ci, cat: c, exp: t.exp.filter(x => x.catId === c.id) };
    t.cats.splice(ci, 1);
    t.exp = t.exp.filter(x => x.catId !== c.id);
    renderCats(); renderExp(); paint(); persist(true);
    toast((c.name || "Category") + " removed", true);
    return;
  }
  const r = e.target.closest(".item"); if (!r) return;
  const idx = c.items.findIndex(x => x.id === r.dataset.item);
  if (idx < 0) return;
  if (e.target.closest(".type")) {
    const it = c.items[idx];
    it.type = it.type === "fixed" ? "variable" : "fixed";
    const b = r.querySelector(".type");
    b.setAttribute("aria-pressed", String(it.type === "fixed"));
    b.textContent = it.type === "fixed" ? "fixed" : "estimate";
    r.classList.toggle("variable", it.type === "variable");
    paint(); persist(); return;
  }
  if (e.target.closest(".del")) {
    undoData = { type: "item", cat: c, index: idx, item: c.items[idx] };
    c.items.splice(idx, 1);
    renderCats(); paint(); persist(true);
    toast((undoData.item.name || "Line") + " removed", true);
  }
});
$("cats").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const r = e.target.closest(".item"); if (!r) return;
  const c = catOf(e.target.closest(".panel").dataset.cat); if (!c) return;
  e.preventDefault();
  c.items.push(newItem()); renderCats(); paint(); persist();
  const rows = document.querySelectorAll('.panel[data-cat="' + c.id + '"] .item');
  if (rows.length) rows[rows.length - 1].querySelector(".name").focus();
});

$("addCat").addEventListener("click", () => {
  trip().cats.push(newCat("")); renderCats(); paint(); persist(true);
  const all = document.querySelectorAll("#cats .cname");
  if (all.length) all[all.length - 1].focus();
});
$("seedCats").addEventListener("click", () => {
  const t = trip();
  SEED.forEach(sc => {
    if (t.cats.some(c => c.name.toLowerCase() === sc[0].toLowerCase())) return;
    const c = newCat(sc[0]);
    sc[1].forEach(si => {
      c.items.push(si.length === 4 ? newItem(si[0], si[1], si[2], si[3]) : newItem(si[0], si[1], "once", si[2]));
    });
    t.cats.push(c);
  });
  renderCats(); paint(); persist(true);
});

// ---- rates
$("rates").addEventListener("input", e => {
  const d = e.target.closest(".rate"); if (!d || e.target.tagName !== "INPUT") return;
  setRate(d.dataset.cur, e.target.value);
});
$("rates").addEventListener("change", () => renderRates());
$("rates").addEventListener("click", e => {
  const d = e.target.closest(".rate"); if (!d) return;
  const c = d.dataset.cur;
  if (e.target.closest(".reset")) {
    delete s.manual[c];
    applyLive();
    renderRates(); paint(); persist();
  } else if (e.target.closest(".rm")) {
    delete s.rates[c];
    delete s.manual[c];
    renderRates(); renderCats(); paint(); persist();
  }
});
$("addRate").addEventListener("change", e => {
  const c = e.target.value;
  if (!c) return;
  ensureCurrency(c);
  renderRates(); renderCats(); paint(); persist();
  const inp = $("rates").querySelector('.rate[data-cur="' + c + '"] input');
  if (inp && !s.rates[c]) inp.focus();
  if (!liveRate(c)) refreshRates();
});

$("undo").addEventListener("click", () => {
  if (!undoData) return;
  const t = trip();
  if (undoData.type === "cat") { t.cats.splice(undoData.index, 0, undoData.cat); t.exp = t.exp.concat(undoData.exp); }
  else if (undoData.type === "item") undoData.cat.items.splice(undoData.index, 0, undoData.item);
  else {
    const i = t.exp.findIndex(x => x.id === undoData.item.id);
    if (i >= 0) t.exp.splice(i, 1); else t.exp.splice(undoData.index, 0, undoData.item);
  }
  undoData = null;
  $("toast").classList.remove("show");
  renderCats(); renderExp(); paint(); persist(true);
});

// ---- trip fields
function bind(id, key, num) {
  $(id).addEventListener("input", e => {
    const t = trip();
    t[key] = num ? Math.max(num.min, Number(e.target.value) || num.min) : e.target.value;
    if (key === "dest") { t.name = e.target.value || "Untitled"; renderTabs(); }
    paint(); persist();
  });
}
bind("dest", "dest"); bind("start", "start"); bind("end", "end");
bind("people", "people", { min: 1 }); bind("saved", "saved", { min: 0 });

$("tcur").addEventListener("change", e => {
  const t = trip();
  t.cur = e.target.value;
  ensureCurrency(t.cur);
  renderRates(); renderCats(); paint(); persist();
  if (t.cur && !liveRate(t.cur)) refreshRates();
});

// Switching home currency rescales every stored home amount, so totals stay meaningful.
$("home").addEventListener("change", e => {
  const nh = e.target.value, oh = s.home;
  if (nh === oh) return;
  const x = Number(s.rates[nh]) || 0;     // old-home units per 1 new-home unit
  const hasExp = s.trips.some(t => t.exp.length);
  if (!x && hasExp) {
    e.target.value = oh;
    toast("Add a rate for " + nh + " first, so past expenses can be converted", false);
    return;
  }
  if (hasExp && !confirm("Past expenses will be converted from " + oh + " to " + nh + " at 1 " + nh + " = " + x + " " + oh + ".")) {
    e.target.value = oh;
    return;
  }
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
  render(); persist(true);
  refreshRates();
});

function create(dup) {
  let t;
  if (dup && trip()) {
    t = JSON.parse(JSON.stringify(trip()));
    t.id = uid(); t.name = (t.name || "Trip") + " copy"; t.saved = 0; t.exp = [];
    t.cats.forEach(c => { c.id = uid(); c.items.forEach(i => { i.id = uid(); }); });
  } else {
    t = newTrip("Trip " + (s.trips.length + 1));
  }
  s.trips.push(t); s.active = t.id; render(); persist(true); $("dest").focus();
}
$("newTrip").addEventListener("click", () => create(false));
$("dupTrip").addEventListener("click", () => create(true));
$("delTrip").addEventListener("click", () => {
  const t = trip(); if (!t) return;
  if ((t.exp.length || t.cats.length) && !confirm("Delete " + (t.name || "this trip") + " and everything in it? This can't be undone.")) return;
  const i = s.trips.indexOf(t);
  s.trips.splice(i, 1);
  if (!s.trips.length) s.trips.push(newTrip("Trip 1"));
  s.active = s.trips[Math.max(0, Math.min(i - 1, s.trips.length - 1))].id;
  undoData = null; render(); persist(true); toast("Trip deleted", false);
});

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

$("csv").addEventListener("click", () => {
  const t = trip();
  if (!t.exp.length) { toast("No expenses to export yet", false); return; }
  saveFile(slug(t.name) + "-expenses.csv", expensesCSV(s, t), "text/csv");
});
$("backup").addEventListener("click", async () => {
  await flush();
  const data = JSON.stringify({ app: "travels", version: 1, exportedAt: new Date().toISOString(), state: s }, null, 1);
  if (await saveFile("trips-backup-" + localDate() + ".json", data, "application/json")) {
    s.lastBackup = new Date().toISOString();
    persist(true);
    renderBackupNote();
  }
});
$("restore").addEventListener("click", () => $("restoreFile").click());
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
  if (!confirm("Replace everything on this device with this backup (" + plural(p.trips.length, "trip") + ", " + plural(nExp, "expense") + ")?")) return;
  s = normalize(p);
  render(); setView(view);
  await persist(true);
  toast("Backup restored", false);
  refreshRates();
});

let rt = null;
window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(paint, 120); });
window.addEventListener("online", refreshRates);
window.addEventListener("offline", () => { rateState = { status: "offline" }; renderRateStat(); });

(async function start() {
  let p = null;
  try { p = await store.get(KEY); }
  catch (e) { storageOk = false; }
  s = normalize(p);
  render();
  const t = trip(), ph = pace(t, calc(s, t), localDate()).phase;
  setView(ph === "during" ? "spend" : "plan");
  if (!p) persist(true);
  store.persist();
  refreshRates();
  if ("serviceWorker" in navigator) {
    // When a new version takes over, reload into it — but never while an expense is half-entered.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", async () => {
      if (!hadController || document.querySelector("dialog[open]")) return;
      await flush();
      location.reload();
    });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  }
})();
