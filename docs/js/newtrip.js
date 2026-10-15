// Guided new-trip flow: where → when → who → rough budget.
import { esc, plural, fmt, fmtRange, currencyName } from "./util.js";
import { icon, catIcon } from "./icons.js";
import { openSheet, pickCurrency } from "./sheets.js";
import { calendar } from "./calendar.js";
import { guessCurrency } from "./places.js";
import { lengthOf, itemPlanned } from "./calc.js";

// The starting categories. Each is a single budget line; `home` means it's usually paid from home.
export const PRESETS = [
  { name: "Flights", basis: "person", type: "fixed", home: true, hint: "per person, return" },
  { name: "Stay", basis: "night", type: "fixed", hint: "per night" },
  { name: "Food & drinks", basis: "personday", type: "variable", hint: "per person, per day" },
  { name: "Getting around", basis: "day", type: "variable", hint: "per day" },
  { name: "Activities", basis: "once", type: "variable", hint: "for the whole trip" },
  { name: "Shopping", basis: "once", type: "variable", hint: "for the whole trip" },
  { name: "Other", basis: "once", type: "variable", hint: "buffer for the unexpected" },
];

// ctx: { home, rate(cur), allCurrencies, suggested, hues, finish(data) }
export function openNewTrip(ctx) {
  const d = { dest: "", cur: "", curPicked: false, start: "", end: "", people: 1, amounts: {} };
  let step = 0;
  const STEPS = 4;

  openSheet({
    label: "New trip", cls: "tall plain wiz",
    render(el, api) {
      el.insertAdjacentHTML("beforeend",
        '<div class="sheet-head"><div class="l"><button class="txtbtn" data-back></button></div>' +
        '<div class="dots" aria-hidden="true">' + "<i></i>".repeat(STEPS) + '</div><div class="r"><button class="txtbtn" data-skip>Skip</button></div></div>' +
        '<div class="sheet-body"><div class="wiz-step"></div></div>' +
        '<div class="wiz-foot"><p class="wiz-sum"></p><button class="btn" data-next>Continue</button></div>');
      const q = s => el.querySelector(s);
      const body = q(".wiz-step"), next = q("[data-next]"), back = q("[data-back]"), skip = q("[data-skip]"), sum = q(".wiz-sum");
      const cur = () => d.cur || ctx.home;

      function go(n, dir) {
        step = n;
        body.classList.remove("fwd", "bwd");
        void body.offsetWidth;
        body.classList.add(dir < 0 ? "bwd" : "fwd");
        draw();
        q(".sheet-body").scrollTop = 0;
      }

      function draw() {
        el.querySelectorAll(".dots i").forEach((x, i) => x.classList.toggle("on", i <= step));
        back.textContent = step === 0 ? "Cancel" : "Back";
        skip.style.visibility = step === 1 || step === 3 ? "" : "hidden";
        sum.textContent = "";
        [stepWhere, stepWhen, stepWho, stepBudget][step]();
      }

      function stepWhere() {
        body.innerHTML = '<h2 class="wiz-q">Where are you going?</h2>' +
          '<input class="bigfield" data-dest placeholder="City or country" autocomplete="off" autocapitalize="words" enterkeyhint="next" aria-label="Destination" autofocus>' +
          '<button class="wiz-hint" data-cur></button>';
        const input = q("[data-dest]");
        input.value = d.dest;
        const update = () => {
          d.dest = input.value;
          if (!d.curPicked) d.cur = guessCurrency(d.dest) || "";
          const c = cur();
          q("[data-cur]").innerHTML = d.dest.trim()
            ? "Local currency: <b>" + esc(currencyName(c) || c) + " (" + c + ")</b> · <span>change</span>" : "";
          next.disabled = !d.dest.trim();
        };
        input.addEventListener("input", update);
        input.addEventListener("keydown", e => { if (e.key === "Enter" && d.dest.trim()) { e.preventDefault(); go(1, 1); } });
        q("[data-cur]").addEventListener("click", async () => {
          const c = await pickCurrency({ title: "Local currency", current: cur(), suggested: [cur(), ctx.home, ...ctx.suggested], all: ctx.allCurrencies });
          if (c) { d.cur = c; d.curPicked = true; update(); }
        });
        next.textContent = "Continue";
        update();
        // Focusing inside the tap that opened this step lets iOS raise the keyboard.
        if (el.isConnected) input.focus({ preventScroll: true });
      }

      function stepWhen() {
        body.innerHTML = '<h2 class="wiz-q">When are you going?</h2><p class="wiz-sub" data-range></p>';
        const cal = calendar({ start: d.start, end: d.end, onChange: (s, e) => { d.start = s; d.end = e; update(); } });
        body.appendChild(cal.el);
        function update() {
          const len = lengthOf(d);
          q("[data-range]").textContent = !d.start ? "Tap your first day, then your last." :
            !d.end ? fmtRange(d.start, "") + " — now tap your last day." :
            fmtRange(d.start, d.end) + " · " + plural(len.days, "day") + ", " + plural(len.nights, "night");
          next.disabled = !(d.start && d.end);
        }
        next.textContent = "Continue";
        update();
        requestAnimationFrame(() => cal.scrollToSelection());
      }

      function stepWho() {
        body.innerHTML = '<h2 class="wiz-q">Who’s going?</h2>' +
          '<div class="bigstep"><button data-step="-1" aria-label="Fewer travellers">−</button><div><output></output><span></span></div>' +
          '<button data-step="1" aria-label="More travellers">+</button></div>' +
          '<p class="wiz-sub center">Per-person costs like flights and meals are multiplied by this.</p>';
        const draw2 = () => {
          q(".bigstep output").textContent = d.people;
          q(".bigstep span").textContent = d.people === 1 ? "traveller" : "travellers";
          q('[data-step="-1"]').disabled = d.people <= 1;
        };
        body.querySelectorAll("[data-step]").forEach(b => b.addEventListener("click", () => { d.people = Math.max(1, Math.min(30, d.people + Number(b.dataset.step))); draw2(); }));
        next.textContent = "Continue";
        next.disabled = false;
        draw2();
      }

      function stepBudget() {
        const len = lengthOf(d);
        body.innerHTML = '<h2 class="wiz-q">What’s your budget?</h2>' +
          '<p class="wiz-sub">Rough numbers are fine. Leave blank what you don’t know — you can change everything later.</p>' +
          '<div class="list budgetlist">' + PRESETS.map((p, i) => {
            const c = p.home ? ctx.home : cur();
            return '<label class="row"><span class="ic" style="--h:' + ctx.hues[i % ctx.hues.length] + '">' + catIcon(p.name) + "</span>" +
              '<span class="main"><span class="ttl">' + esc(p.name) + '</span><span class="sub">' + c + " " + esc(p.hint) + "</span></span>" +
              '<span class="amtfield"><input data-i="' + i + '" inputmode="decimal" placeholder="0" enterkeyhint="next" aria-label="' + esc(p.name) + " budget in " + c + ", " + esc(p.hint) + '"></span></label>';
          }).join("") + "</div>";
        body.querySelectorAll("[data-i]").forEach(inp => {
          const i = Number(inp.dataset.i);
          if (d.amounts[i]) inp.value = d.amounts[i];
          inp.addEventListener("input", () => { d.amounts[i] = Math.max(0, Number(inp.value.replace(",", ".")) || 0); total(); });
          inp.addEventListener("keydown", e => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const nx = body.querySelector('[data-i="' + (i + 1) + '"]');
            if (nx) nx.focus(); else inp.blur();
          });
        });
        function total() {
          let t = 0;
          PRESETS.forEach((p, i) => {
            const a = d.amounts[i] || 0;
            if (a) t += itemPlanned({ amount: a, basis: p.basis }, ctx.rate(p.home ? ctx.home : cur()), len.days, len.nights, d.people);
          });
          sum.innerHTML = t > 0 ? "About <b>" + ctx.home + " " + fmt(t) + "</b> for the whole trip" +
            (!len.known ? " (add dates for daily costs)" : "") : "";
        }
        next.textContent = "Create trip";
        next.disabled = false;
        total();
      }

      function finish() {
        api.close();
        ctx.finish({ dest: d.dest.trim(), cur: d.cur, start: d.start, end: d.end, people: d.people,
          budget: PRESETS.map((p, i) => ({ ...p, amount: d.amounts[i] || 0, cur: p.home ? ctx.home : cur() })) });
      }

      next.addEventListener("click", () => { if (step < STEPS - 1) go(step + 1, 1); else finish(); });
      back.addEventListener("click", () => { if (step === 0) api.close(); else go(step - 1, -1); });
      skip.addEventListener("click", () => {
        if (step === 1) { d.start = ""; d.end = ""; go(2, 1); }
        else if (step === 3) { d.amounts = {}; finish(); }
      });
      draw();
    },
  });
}
