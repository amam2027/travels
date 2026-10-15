export const $ = id => document.getElementById(id);

export function esc(t) {
  return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); }
export function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }

const nf0 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfUpTo2 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 2 });

export function fmt(n) { return nf0.format(Math.round(n)); }
export function fmt2(n) { return nf2.format(Number(n) || 0); }
export function fmtUpTo2(n) { return nfUpTo2.format(Number(n) || 0); }
export function money(n, cur) { return cur + " " + fmt(n); }
export function money2(n, cur) { return cur + " " + fmt2(n); }

let names = null;
export function currencyName(code) {
  try {
    names = names || new Intl.DisplayNames(["en"], { type: "currency" });
    const n = names.of(code);
    return n && n !== code ? n : "";
  } catch (e) { return ""; }
}

function day(s) { return new Date(s.slice(0, 10) + "T00:00:00"); }

export function fmtDate(d) {
  if (!d) return "";
  const x = day(d), o = { day: "numeric", month: "short" };
  if (x.getFullYear() !== new Date().getFullYear()) o.year = "numeric";
  return x.toLocaleDateString("en-GB", o);
}

// "Today", "Yesterday", or "Mon 13 Oct"
export function fmtDay(d, today) {
  const x = day(d), t = day(today);
  const diff = Math.round((t - x) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff === -1) return "Tomorrow";
  const o = { weekday: "short", day: "numeric", month: "short" };
  if (x.getFullYear() !== t.getFullYear()) o.year = "numeric";
  return x.toLocaleDateString("en-GB", o);
}

export function fmtRange(a, b) {
  if (!a) return "";
  const x = day(a);
  if (!b) return "From " + fmtDate(a);
  const y = day(b);
  const sameYear = x.getFullYear() === y.getFullYear();
  const thisYear = y.getFullYear() === new Date().getFullYear();
  if (sameYear && x.getMonth() === y.getMonth()) {
    return x.getDate() + "–" + y.getDate() + " " + y.toLocaleDateString("en-GB", { month: "short" }) + (thisYear ? "" : " " + y.getFullYear());
  }
  const o = { day: "numeric", month: "short" };
  return x.toLocaleDateString("en-GB", sameYear ? o : { ...o, year: "numeric" }) + " – " +
    y.toLocaleDateString("en-GB", thisYear ? o : { ...o, year: "numeric" });
}
