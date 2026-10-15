// The one-screen expense logger: keypad, currency chips, category tiles.
import { localDate } from "./calc.js";

export function initEntry(ctx) {
  const $ = id => document.getElementById(id);
  const dlg = $("entry");
  const nfInt = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
  let amt = "", cur = "", catId = null, itemId = null;

  function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function value() { return Number(amt) || 0; }

  function display() {
    if (!amt) return "0";
    const [i, d] = amt.split(".");
    return nfInt.format(Number(i) || 0) + (d !== undefined ? "." + d : "");
  }

  function renderAmount() {
    $("enCur").textContent = cur;
    $("enAmt").textContent = display();
    $("enAmt").classList.toggle("empty", !amt);
    $("enAmount").setAttribute("aria-label", "Amount: " + cur + " " + display());
    renderConv();
    renderSave();
  }

  function renderConv() {
    const s = ctx.state(), el = $("enConv"), r = ctx.rate(cur);
    el.classList.remove("warn");
    if (cur === s.home) { el.textContent = ""; return; }
    if (r > 0) {
      el.textContent = "≈ " + ctx.money(value() * r) + " at 1 " + cur + " = " + r + " " + s.home;
      return;
    }
    // No rate known for this currency: ask for one right here.
    if (el.querySelector("input")) return;
    el.classList.add("warn");
    el.innerHTML = '<label for="enRate">No rate for ' + esc(cur) + " yet: 1 " + esc(cur) + " =</label> " +
      '<input id="enRate" type="number" step="any" min="0" inputmode="decimal"> ' + esc(s.home);
    $("enRate").addEventListener("input", e => {
      ctx.setRate(cur, e.target.value);
      renderSave();
    });
    $("enRate").addEventListener("change", () => { $("enConv").innerHTML = ""; renderConv(); });
  }

  function renderSave() {
    const b = $("enSave");
    const ok = value() > 0 && catId && ctx.rate(cur) > 0;
    b.disabled = !ok;
    b.textContent = value() > 0 ? "Add " + cur + " " + display() : "Add";
  }

  function renderCurs() {
    const t = ctx.trip(), s = ctx.state();
    const list = [];
    for (const c of [t.cur, s.home, ...ctx.curList()]) if (c && !list.includes(c)) list.push(c);
    $("enCurs").innerHTML = list.map(c =>
      '<button class="chip" role="radio" aria-checked="' + (c === cur) + '" aria-current="' + (c === cur) + '" data-cur="' + c + '">' + c + "</button>").join("");
  }

  function renderCats() {
    const t = ctx.trip();
    if (!t.cats.length) {
      $("enCats").innerHTML = '<div class="blankcats" style="grid-column:1/-1">No categories yet. Add them under Plan first.</div>';
      $("enLines").innerHTML = "";
      return;
    }
    $("enCats").innerHTML = t.cats.map((c, ci) =>
      '<button class="tile" role="radio" aria-checked="' + (c.id === catId) + '" data-cat="' + c.id + '">' +
        '<span class="dot" style="background:' + ctx.hues[ci % ctx.hues.length] + '"></span><span>' + esc(c.name || "Untitled") + "</span></button>").join("");
    renderLines();
  }

  function renderLines() {
    const c = ctx.trip().cats.find(x => x.id === catId);
    if (!c || !c.items.length) { $("enLines").innerHTML = ""; return; }
    $("enLines").innerHTML =
      '<button class="chip" role="radio" aria-checked="' + !itemId + '" aria-current="' + !itemId + '" data-item="">Whole category</button>' +
      c.items.map(it => '<button class="chip" role="radio" aria-checked="' + (it.id === itemId) + '" aria-current="' + (it.id === itemId) +
        '" data-item="' + it.id + '">' + esc(it.name || "Untitled") + "</button>").join("");
  }

  function key(k) {
    if (k === "del") amt = amt.slice(0, -1);
    else if (k === ".") { if (!amt.includes(".")) amt = (amt || "0") + "."; }
    else {
      const [i, d] = amt.split(".");
      if (d !== undefined && d.length >= 2) return;
      if (d === undefined && i.length >= 9) return;
      amt = amt === "0" ? k : amt + k;
    }
    renderAmount();
  }

  function save() {
    if ($("enSave").disabled) return;
    const s = ctx.state(), r = ctx.rate(cur), a = value();
    ctx.save({
      id: Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3),
      catId, itemId: itemId || null, amount: a, cur, rate: r,
      homeAmount: a * r, home: s.home,
      date: $("enDate").value || localDate(), note: $("enNote").value.trim(),
      at: new Date().toISOString(),
    });
    dlg.close();
  }

  function open() {
    const t = ctx.trip(), s = ctx.state();
    amt = "";
    cur = t.cur || s.home;
    ctx.ensureCurrency(cur);
    const last = s.lastCat[t.id];
    catId = t.cats.some(c => c.id === last) ? last : (t.cats.length === 1 ? t.cats[0].id : null);
    itemId = null;
    $("enDate").value = localDate();
    $("enNote").value = "";
    $("enConv").innerHTML = "";
    renderCurs(); renderCats(); renderAmount();
    dlg.showModal();
    $("enAmount").focus();
  }

  $("enPad").addEventListener("click", e => {
    const b = e.target.closest("button[data-k]");
    if (b) key(b.dataset.k);
  });
  $("enCurs").addEventListener("click", e => {
    const b = e.target.closest("[data-cur]");
    if (!b) return;
    cur = b.dataset.cur;
    $("enConv").innerHTML = "";
    renderCurs(); renderAmount();
  });
  $("enCats").addEventListener("click", e => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    if (catId !== b.dataset.cat) itemId = null;
    catId = b.dataset.cat;
    renderCats(); renderSave();
  });
  $("enLines").addEventListener("click", e => {
    const b = e.target.closest("[data-item]");
    if (!b) return;
    itemId = b.dataset.item || null;
    renderLines();
  });
  $("enSave").addEventListener("click", save);
  $("enClose").addEventListener("click", () => dlg.close());
  $("enNote").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } });

  // A hardware keyboard works too, as long as no text field has focus.
  dlg.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) { key(e.key); e.preventDefault(); }
    else if (e.key === "." || e.key === ",") { key("."); e.preventDefault(); }
    else if (e.key === "Backspace") { key("del"); e.preventDefault(); }
    else if (e.key === "Enter" && !e.target.closest("button")) { save(); e.preventDefault(); }
  });

  return { open };
}
