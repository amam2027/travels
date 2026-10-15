// Pure budget maths. No DOM, no storage, so it can be tested under node.

export const HUES = ["#4F6F8F", "#8C6A4F", "#4F7F7A", "#7E6B8F", "#A08948", "#93656A", "#5F7355", "#5C6E8C", "#7A7168", "#6B7F9E"];
export const BASIS = [["once", "one-off"], ["person", "per person"], ["day", "per day"], ["night", "per night"], ["personday", "per person/day"]];

const DAY = 86400000;

function parseDay(s) { return new Date(s + "T00:00:00"); }

export function localDate(d = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

// 1 unit of `cur` = how many home units.
export function rateOf(s, cur) {
  return cur === s.home ? 1 : (Number(s.rates[cur]) || 0);
}

export function lengthOf(t) {
  if (!t.start || !t.end) return { days: 1, nights: 0, known: false };
  const nights = Math.round((parseDay(t.end) - parseDay(t.start)) / DAY);
  if (isNaN(nights) || nights < 0) return { days: 1, nights: 0, known: false };
  return { days: nights + 1, nights, known: true };
}

export function itemPlanned(it, rate, days, nights, people) {
  const b = (Number(it.amount) || 0) * rate;
  if (it.basis === "person") return b * people;
  if (it.basis === "day") return b * days;
  if (it.basis === "night") return b * nights;
  if (it.basis === "personday") return b * days * people;
  return b;
}

// Home-currency value, fixed at the rate stored when it was logged.
export function expenseHome(e) {
  if (e.homeAmount != null && !isNaN(Number(e.homeAmount))) return Number(e.homeAmount);
  return (Number(e.amount) || 0) * (Number(e.rate) || 0);
}

// An expense counts against the variable budget unless it is attached to a fixed line.
export function isVariableExpense(e, t) {
  if (!e.itemId) return true;
  for (const c of t.cats) {
    const it = c.items.find(x => x.id === e.itemId);
    if (it) return it.type === "variable";
  }
  return true;
}

export function calc(s, t) {
  const people = Math.max(1, Number(t.people) || 1);
  const { days, nights, known } = lengthOf(t);
  let planned = 0, fixed = 0, variable = 0, spent = 0, variableSpent = 0;
  const cats = t.cats.map((c, ci) => {
    let p = 0, sp = 0;
    for (const it of c.items) {
      const val = itemPlanned(it, rateOf(s, it.cur), days, nights, people);
      p += val;
      if (it.type === "variable") variable += val; else fixed += val;
    }
    for (const e of t.exp) if (e.catId === c.id) sp += expenseHome(e);
    planned += p;
    return { id: c.id, name: c.name, planned: p, spent: sp, color: HUES[ci % HUES.length] };
  });
  for (const e of t.exp) {
    const v = expenseHome(e);
    spent += v;
    if (isVariableExpense(e, t)) variableSpent += v;
  }
  return { people, days, nights, known, planned, fixed, variable, spent, variableSpent, cats };
}

// Variable spending against a straight-line plan across the trip's days.
export function pace(t, c, today) {
  if (!c.known) return { phase: "unknown" };
  const start = parseDay(t.start), end = parseDay(t.end), now = parseDay(today);
  if (now < start) {
    return { phase: "before", daysToGo: Math.round((start - now) / DAY), daily: c.variable / c.days };
  }
  if (now > end) {
    return { phase: "after", diff: c.variableSpent - c.variable };
  }
  const day = Math.round((now - start) / DAY) + 1;     // today is day N of the trip
  const expected = c.variable * day / c.days;          // plan through the end of today
  const remainingDays = c.days - day + 1;              // today plus the days after it
  const left = c.variable - c.variableSpent;
  return {
    phase: "during", day, days: c.days, expected,
    ahead: c.variableSpent - expected,                 // > 0 means spending faster than planned
    left, remainingDays, daily: Math.max(0, left) / remainingDays,
  };
}

export function csvCell(v) {
  const t = v == null ? "" : String(v);
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}

export function expensesCSV(s, t) {
  const rows = [["date", "category", "line", "note", "amount", "currency", "rate", "home_amount", "home_currency"]];
  const sorted = t.exp.slice().sort((a, b) => (a.date + (a.at || "")).localeCompare(b.date + (b.at || "")));
  for (const e of sorted) {
    const c = t.cats.find(x => x.id === e.catId);
    const it = c && e.itemId ? c.items.find(x => x.id === e.itemId) : null;
    rows.push([e.date, c ? c.name : "", it ? it.name : "", e.note || "", e.amount, e.cur, e.rate,
      Math.round(expenseHome(e) * 100) / 100, e.home || s.home]);
  }
  return rows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
