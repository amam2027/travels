// Scrolling month calendar for picking a date range: tap the first day, then the last.
import { localDate } from "./calc.js";

const WD = ["M", "T", "W", "T", "F", "S", "S"];

function iso(y, m, d) { return localDate(new Date(y, m, d)); }

// opts: { start, end, onChange(start, end) }. Returns { el, scrollToSelection() }.
export function calendar(opts) {
  let start = opts.start || "", end = opts.end || "";
  const today = localDate();
  const anchor = new Date((start || today) + "T00:00:00");
  const first = new Date(Math.min(anchor, new Date()));
  first.setDate(1);
  first.setMonth(first.getMonth() - 1);

  const el = document.createElement("div");
  el.className = "cal";
  let h = '<div class="cal-wd" aria-hidden="true">' + WD.map(d => "<span>" + d + "</span>").join("") + '</div><div class="cal-months">';
  for (let i = 0; i < 18; i++) {
    const m = new Date(first.getFullYear(), first.getMonth() + i, 1);
    const y = m.getFullYear(), mo = m.getMonth();
    const days = new Date(y, mo + 1, 0).getDate();
    const lead = (m.getDay() + 6) % 7;
    h += '<section class="cal-m" data-m="' + iso(y, mo, 1).slice(0, 7) + '"><h3>' +
      m.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) + '</h3><div class="cal-grid">';
    for (let b = 0; b < lead; b++) h += "<span></span>";
    for (let d = 1; d <= days; d++) {
      const k = iso(y, mo, d);
      h += '<button class="d' + (k === today ? " today" : "") + '" data-d="' + k + '" aria-label="' +
        new Date(y, mo, d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) + '"><span>' + d + "</span></button>";
    }
    h += "</div></section>";
  }
  el.innerHTML = h + "</div>";

  function paint() {
    el.querySelectorAll(".d").forEach(b => {
      const k = b.dataset.d;
      const isS = k === start, isE = k === end;
      b.classList.toggle("start", isS);
      b.classList.toggle("end", isE || (isS && !end));
      b.classList.toggle("single", isS && (!end || end === start));
      b.classList.toggle("in", !!(start && end && k > start && k < end));
      b.setAttribute("aria-pressed", isS || isE);
    });
  }

  el.addEventListener("click", e => {
    const b = e.target.closest(".d");
    if (!b) return;
    const k = b.dataset.d;
    if (!start || end) { start = k; end = ""; }
    else if (k < start) start = k;
    else end = k;
    paint();
    opts.onChange(start, end);
  });

  paint();
  return {
    el,
    scrollToSelection() {
      const key = (start || today).slice(0, 7);
      const sec = el.querySelector('.cal-m[data-m="' + key + '"]');
      const scroller = el.closest(".sheet-body") || el.parentElement;
      if (sec && scroller) scroller.scrollTop = sec.offsetTop - scroller.offsetTop - 8;
    },
  };
}
