// The expense sheet: amount on a keypad, currency pill, category chips. Used for new and existing expenses.
import { localDate } from "./calc.js";
import { esc, uid, fmtDay, money2 } from "./util.js";
import { icon, catIcon } from "./icons.js";
import { openSheet, head, pickCurrency } from "./sheets.js";

const nfInt = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });

// ctx: { state, trip, rate, curList, allCurrencies, ensureCurrency, setRate, hues, save(exp, isNew), remove(id) }
export function openEntry(ctx, existing) {
  const s = ctx.state(), t = ctx.trip();
  const editing = !!existing;
  let amt = editing ? String(existing.amount) : "";
  let cur = editing ? existing.cur : (t.cur || s.home);
  let catId = editing ? existing.catId : null;
  let itemId = editing ? existing.itemId : null;
  let date = editing ? existing.date : localDate();
  if (!editing) {
    ctx.ensureCurrency(cur);
    const last = s.lastCat[t.id];
    catId = t.cats.some(c => c.id === last) ? last : (t.cats.length === 1 ? t.cats[0].id : null);
  }

  openSheet({
    label: editing ? "Edit expense" : "New expense", cls: "tall plain entry",
    render(el, api) {
      el.insertAdjacentHTML("beforeend",
        head(editing ? "Edit expense" : "New expense",
          '<button class="txtbtn" data-close>Cancel</button>',
          '<label class="datepill">' + icon("calendar") + '<span data-date></span><input type="date" aria-label="Date"></label>') +
        '<div class="sheet-body">' +
          '<div class="amt-area">' +
            '<button class="curpill" data-cur aria-label="Change currency"><span></span>' + icon("down") + "</button>" +
            '<div class="amt-big" aria-live="polite"></div>' +
            '<div class="conv"></div>' +
          "</div>" +
          '<div class="hscroll catrow" role="radiogroup" aria-label="Category"></div>' +
          '<div class="hscroll linerow" role="radiogroup" aria-label="Line"></div>' +
          '<label class="noterow">' + icon("note") + '<input type="text" placeholder="Add a note" aria-label="Note" autocomplete="off" enterkeyhint="done"></label>' +
        "</div>" +
        '<div class="entry-foot">' +
          '<div class="keypad">' + ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"].map(k =>
            '<button data-k="' + k + '"' + (k === "del" ? ' aria-label="Delete last digit">' + icon("del") : k === "." ? ' aria-label="Decimal point">.' : ">" + k) + "</button>").join("") +
          "</div>" +
          '<button class="btn" data-save disabled>Add</button>' +
          (editing ? '<button class="txtbtn danger delbtn" data-remove>Delete expense</button>' : "") +
        "</div>");

      const q = sel => el.querySelector(sel);
      const dateInput = q(".datepill input"), note = q(".noterow input");
      dateInput.value = date;
      note.value = editing ? existing.note || "" : "";

      const value = () => Number(amt) || 0;
      const display = () => {
        if (!amt) return "0";
        const [i, d] = amt.split(".");
        return nfInt.format(Number(i) || 0) + (d !== undefined ? "." + d : "");
      };
      // Keeps the stored rate when editing in the same currency, so the past is never rewritten.
      const rateNow = () => editing && cur === existing.cur ? Number(existing.rate) : ctx.rate(cur);

      function drawDate() { q("[data-date]").textContent = fmtDay(dateInput.value || localDate(), localDate()); }

      function drawAmount() {
        q(".curpill span").textContent = cur;
        const big = q(".amt-big"), txt = display();
        big.textContent = txt;
        big.classList.toggle("zero", !amt);
        big.style.fontSize = txt.length > 10 ? "40px" : txt.length > 7 ? "50px" : "";
        drawConv();
        drawSave();
      }

      function drawConv() {
        const conv = q(".conv"), r = rateNow();
        conv.classList.remove("warn");
        if (cur === s.home) { conv.textContent = ""; return; }
        if (r > 0) { conv.textContent = "≈ " + money2(value() * r, s.home); return; }
        if (conv.querySelector("input")) return;
        conv.classList.add("warn");
        conv.innerHTML = '<label>No rate for ' + esc(cur) + ' yet · 1 ' + esc(cur) + ' = <input type="text" inputmode="decimal" aria-label="Rate for ' +
          esc(cur) + '" placeholder="0.00"> ' + esc(s.home) + "</label>";
        const inp = conv.querySelector("input");
        inp.addEventListener("input", () => { ctx.setRate(cur, inp.value.replace(",", ".")); drawSave(); });
        inp.addEventListener("change", () => { conv.innerHTML = ""; drawConv(); });
      }

      function drawSave() {
        const b = q("[data-save]");
        b.disabled = !(value() > 0 && catId && rateNow() > 0);
        b.textContent = editing ? "Save" : value() > 0 ? "Add " + cur + " " + display() : "Add";
      }

      function drawCats() {
        const row = q(".catrow");
        if (!t.cats.length) {
          row.innerHTML = '<p class="hint">Add categories in Budget first.</p>';
          q(".linerow").innerHTML = "";
          return;
        }
        row.innerHTML = t.cats.map((c, ci) =>
          '<button class="catchip" role="radio" aria-checked="' + (c.id === catId) + '" data-cat="' + c.id + '" style="--h:' + ctx.hues[ci % ctx.hues.length] + '">' +
            '<span class="ic">' + catIcon(c.name) + "</span><span>" + esc(c.name || "Untitled") + "</span></button>").join("");
        drawLines();
        const sel = row.querySelector('[aria-checked="true"]');
        if (sel) sel.scrollIntoView({ inline: "center", block: "nearest" });
      }

      function drawLines() {
        const c = t.cats.find(x => x.id === catId), row = q(".linerow");
        if (!c || c.items.length < 2) { row.innerHTML = ""; return; }  // only split categories have costs to pick from
        row.innerHTML = '<button class="linechip" role="radio" aria-checked="' + !itemId + '" data-item="">Whole category</button>' +
          c.items.map(it => '<button class="linechip" role="radio" aria-checked="' + (it.id === itemId) + '" data-item="' + it.id + '">' +
            esc(it.name || "Untitled") + "</button>").join("");
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
        drawAmount();
      }

      function save() {
        if (q("[data-save]").disabled) return;
        const r = rateNow(), a = value();
        const exp = {
          ...(editing ? existing : { id: uid(), at: new Date().toISOString() }),
          catId, itemId: itemId || null, amount: a, cur, rate: r, homeAmount: a * r,
          home: editing && cur === existing.cur ? existing.home : s.home,
          date: dateInput.value || localDate(), note: note.value.trim(),
        };
        api.close();
        ctx.save(exp, !editing);
      }

      q(".keypad").addEventListener("click", e => { const b = e.target.closest("[data-k]"); if (b) key(b.dataset.k); });
      q("[data-cur]").addEventListener("click", async () => {
        const c = await pickCurrency({ title: "Currency", current: cur, suggested: [t.cur, s.home, ...ctx.curList()], all: ctx.allCurrencies });
        if (!c) return;
        ctx.ensureCurrency(c);
        cur = c;
        q(".conv").innerHTML = "";
        drawAmount();
      });
      q(".catrow").addEventListener("click", e => {
        const b = e.target.closest("[data-cat]");
        if (!b) return;
        if (catId !== b.dataset.cat) itemId = null;
        catId = b.dataset.cat;
        drawCats(); drawSave();
      });
      q(".linerow").addEventListener("click", e => {
        const b = e.target.closest("[data-item]");
        if (b) { itemId = b.dataset.item || null; drawLines(); }
      });
      dateInput.addEventListener("change", drawDate);
      note.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); note.blur(); } });
      q("[data-save]").addEventListener("click", save);
      if (editing) q("[data-remove]").addEventListener("click", () => { api.close(); ctx.remove(existing.id); });

      // A hardware keyboard works too, as long as no text field has focus.
      el.addEventListener("keydown", e => {
        if (e.target.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
        if (/^[0-9]$/.test(e.key)) { key(e.key); e.preventDefault(); }
        else if (e.key === "." || e.key === ",") { key("."); e.preventDefault(); }
        else if (e.key === "Backspace") { key("del"); e.preventDefault(); }
        else if (e.key === "Enter" && !e.target.closest("button")) { save(); e.preventDefault(); }
      });

      drawDate(); drawCats(); drawAmount();
    },
  });
}
