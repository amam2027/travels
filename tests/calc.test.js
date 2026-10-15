import { test } from "node:test";
import assert from "node:assert/strict";
import { lengthOf, itemPlanned, calc, pace, expenseHome, isVariableExpense, expensesCSV, rateOf, sharedBalance } from "../docs/js/calc.js";

const state = { home: "CHF", rates: { CHF: 1, EUR: 0.9 } };

function trip(extra) {
  return {
    id: "t", name: "Rome", dest: "Rome", cur: "EUR", start: "2026-05-01", end: "2026-05-05", people: 2, saved: 0,
    cats: [
      { id: "a", name: "Hotel", items: [{ id: "a1", name: "Room", amount: 100, cur: "EUR", basis: "night", type: "fixed" }] },
      { id: "b", name: "Food", items: [{ id: "b1", name: "Meals", amount: 20, cur: "CHF", basis: "personday", type: "variable" }] },
    ],
    exp: [],
    ...extra,
  };
}

test("trip length comes from dates: nights = end - start, days = nights + 1", () => {
  assert.deepEqual(lengthOf({ start: "2026-05-01", end: "2026-05-05" }), { days: 5, nights: 4, known: true });
  assert.deepEqual(lengthOf({ start: "2026-05-01", end: "2026-05-01" }), { days: 1, nights: 0, known: true });
  assert.equal(lengthOf({ start: "2026-05-05", end: "2026-05-01" }).known, false);
  assert.equal(lengthOf({ start: "", end: "" }).known, false);
});

test("trip length is not thrown off by a daylight-saving change", () => {
  assert.equal(lengthOf({ start: "2026-03-28", end: "2026-03-30" }).nights, 2);
});

test("planned cost scales by basis", () => {
  const it = b => ({ amount: 10, basis: b });
  assert.equal(itemPlanned(it("once"), 2, 5, 4, 3), 20);
  assert.equal(itemPlanned(it("person"), 2, 5, 4, 3), 60);
  assert.equal(itemPlanned(it("day"), 2, 5, 4, 3), 100);
  assert.equal(itemPlanned(it("night"), 2, 5, 4, 3), 80);
  assert.equal(itemPlanned(it("personday"), 2, 5, 4, 3), 300);
});

test("a weekly budget is pro-rated over the trip's days", () => {
  const wk = { amount: 100, basis: "week" };
  assert.equal(itemPlanned(wk, 1, 7, 6, 2), 100);
  assert.equal(itemPlanned(wk, 1, 14, 13, 2), 200);
  assert.ok(Math.abs(itemPlanned(wk, 1, 10, 9, 2) - 142.857) < 0.001);
});

test("home currency always has rate 1", () => {
  assert.equal(rateOf(state, "CHF"), 1);
  assert.equal(rateOf(state, "EUR"), 0.9);
  assert.equal(rateOf(state, "THB"), 0);
});

test("trip totals split fixed and variable", () => {
  const c = calc(state, trip());
  assert.equal(c.fixed, 100 * 0.9 * 4);        // 4 nights
  assert.equal(c.variable, 20 * 5 * 2);        // 5 days x 2 people
  assert.equal(c.planned, c.fixed + c.variable);
  assert.equal(c.cats[0].planned + c.cats[1].planned, c.planned);
});

test("an expense keeps the rate it was logged at", () => {
  const t = trip({ exp: [{ id: "e", catId: "b", itemId: null, amount: 10, cur: "EUR", rate: 0.95, homeAmount: 9.5, date: "2026-05-02" }] });
  const before = calc(state, t).spent;
  const after = calc({ ...state, rates: { CHF: 1, EUR: 0.5 } }, t).spent;
  assert.equal(before, 9.5);
  assert.equal(after, 9.5);
});

test("old expenses without homeAmount fall back to amount x rate", () => {
  assert.equal(expenseHome({ amount: 10, rate: 0.9 }), 9);
});

test("category totals: spent against planned, including whole-category expenses", () => {
  const t = trip({ exp: [
    { id: "1", catId: "b", itemId: "b1", amount: 30, cur: "CHF", rate: 1, homeAmount: 30 },
    { id: "2", catId: "b", itemId: null, amount: 12, cur: "CHF", rate: 1, homeAmount: 12 },
  ] });
  const c = calc(state, t);
  assert.equal(c.cats[1].spent, 42);
  assert.equal(c.spent, 42);
});

test("variable spend excludes expenses on fixed lines", () => {
  const t = trip();
  assert.equal(isVariableExpense({ itemId: "a1" }, t), false);
  assert.equal(isVariableExpense({ itemId: "b1" }, t), true);
  assert.equal(isVariableExpense({ itemId: null }, t), true);
});

test("pace: before, during and after the trip", () => {
  const t = trip({ exp: [{ id: "1", catId: "b", itemId: "b1", amount: 100, cur: "CHF", rate: 1, homeAmount: 100 }] });
  const c = calc(state, t);                     // variable plan 200 over 5 days = 40/day
  assert.deepEqual(pace(t, c, "2026-04-28"), { phase: "before", daysToGo: 3, daily: 40 });
  const p = pace(t, c, "2026-05-02");           // day 2: plan says 80 by tonight
  assert.equal(p.phase, "during");
  assert.equal(p.day, 2);
  assert.equal(p.expected, 80);
  assert.equal(p.ahead, 20);
  assert.equal(p.remainingDays, 4);
  assert.equal(p.daily, 25);                    // (200 - 100) / 4
  assert.deepEqual(pace(t, c, "2026-05-09"), { phase: "after", diff: -100 });
  const open = trip({ end: "" });
  assert.equal(pace(open, calc(state, open), "2026-05-02").phase, "unknown");
});

test("CSV export quotes awkward values and lists oldest first", () => {
  const t = trip({ exp: [
    { id: "2", catId: "b", itemId: null, amount: 5, cur: "CHF", rate: 1, homeAmount: 5, date: "2026-05-03", note: "" },
    { id: "1", catId: "b", itemId: "b1", amount: 10, cur: "EUR", rate: 0.95, homeAmount: 9.5, date: "2026-05-02", note: 'pizza, "best"' },
  ] });
  const lines = expensesCSV(state, t).trim().split("\r\n");
  assert.equal(lines[0], "date,category,line,note,amount,currency,rate,split_between,paid_by,settled,my_share_home,home_currency");
  assert.equal(lines[1], '2026-05-02,Food,Meals,"pizza, ""best""",10,EUR,0.95,1,me,,9.5,CHF');
  assert.equal(lines[2], "2026-05-03,Food,,,5,CHF,1,1,me,,5,CHF");
});

test("a whole-category expense counts as booked when the category's budget is all booked", () => {
  const t = trip();
  assert.equal(isVariableExpense({ catId: "a", itemId: null }, t), false);   // Hotel: booked
  assert.equal(isVariableExpense({ catId: "b", itemId: null }, t), true);    // Food: estimate
  const empty = trip({ cats: [{ id: "z", name: "Misc", items: [] }] });
  assert.equal(isVariableExpense({ catId: "z", itemId: null }, empty), true);
});

test("a split expense counts only your share, and the shared balance nets out", () => {
  const t = trip({ exp: [
    // You paid USD 250 for a room for 4: your share is 62.50, friends owe you 187.50 (rate 1 for simplicity).
    { id: "1", catId: "a", itemId: null, amount: 250, cur: "CHF", rate: 1, homeAmount: 62.5, split: 4, paidBy: "me" },
    // A friend paid 100 for dinner for 4: your share is 25, which you owe.
    { id: "2", catId: "b", itemId: null, amount: 100, cur: "CHF", rate: 1, homeAmount: 25, split: 4, paidBy: "other" },
    { id: "3", catId: "b", itemId: null, amount: 10, cur: "CHF", rate: 1, homeAmount: 10 },
  ] });
  assert.equal(calc(state, t).spent, 97.5);
  assert.deepEqual(sharedBalance(t), { owed: 187.5, owe: 25, net: 162.5 });
  const csv = expensesCSV(state, t).trim().split("\r\n");
  assert.ok(csv.some(l => l.endsWith(",250,CHF,1,4,me,no,62.5,CHF")));
  assert.ok(csv.some(l => l.endsWith(",100,CHF,1,4,someone else,no,25,CHF")));
});

test("settled shared costs drop out of the balance but still count as spending", () => {
  const t = trip({ exp: [
    { id: "1", catId: "a", itemId: null, amount: 250, cur: "CHF", rate: 1, homeAmount: 62.5, split: 4, paidBy: "me" },
    { id: "2", catId: "b", itemId: null, amount: 100, cur: "CHF", rate: 1, homeAmount: 25, split: 4, paidBy: "other", settled: true },
  ] });
  assert.deepEqual(sharedBalance(t), { owed: 187.5, owe: 0, net: 187.5 });
  assert.equal(calc(state, t).spent, 87.5);
  assert.ok(expensesCSV(state, t).includes(",4,someone else,yes,25,CHF"));
});
