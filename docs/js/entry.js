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
  let split = editing ? Math.max(1, Number(existing.split) || 1) : 1;      // people sharing the cost, you included
  let paidBy = editing && existing.paidBy === "other" ? "other" : "me";
  let settled = editing ? !!existing.settled : false;
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
          '<div class="toolrow"><label class="noterow">' + icon("note") + '<input type="text" placeholder="Add a note" aria-label="Note" autocomplete="off" enterkeyhint="done"></label>' +
          '<button class="splitbtn" data-split>' + icon("users") + "<span></span></button></div>" +
          '<div class="switchrow settlerow" hidden><div><div class="ttl" data-st></div><div class="sub" data-ss></div></div>' +
            '<button class="switch" role="switch" data-settled><i></i></button></div>' +
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
        drawSettle();
      }

      function drawSettle() {
        const row = q(".settlerow"), sw = q("[data-settled]");
        row.hidden = split < 2;
        if (split < 2) return;
        const share = value() / split;
        q("[data-st]").textContent = paidBy === "other" ? "I've paid my share back" : "They've paid me back";
        q("[data-ss]").textContent = paidBy === "other"
          ? (settled ? "Settled — no longer counted as owed" : "You owe " + money2(share, cur) + " until you turn this on")
          : (settled ? "Settled — no longer counted as owed to you" : "Friends owe you " + money2(value() - share, cur));
        sw.setAttribute("aria-checked", settled);
        sw.setAttribute("aria-label", q("[data-st]").textContent);
      }

      function drawSplit() {
        drawSettle();
        const b = q("[data-split]");
        b.classList.toggle("on", split > 1);
        b.querySelector("span").textContent = split > 1 ? "÷" + split : "Split";
        b.setAttribute("aria-label", split > 1 ? "Split between " + split + " people, " + (paidBy === "me" ? "you paid" : "someone else paid") + ". Change" : "Split this cost");
      }

      function drawConv() {
        const conv = q(".conv"), r = rateNow();
        conv.classList.remove("warn");
        if (split > 1 && r > 0) {
          const share = value() / split;
          conv.textContent = "Your share " + money2(share, cur) + (cur !== s.home ? " ≈ " + money2(share * r, s.home) : "") +
            (paidBy === "other" ? " · someone else paid" : "");
          return;
        }
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
          catId, itemId: itemId || null, amount: a, cur, rate: r, homeAmount: a * r / split, split, paidBy, settled: split > 1 && settled,
          home: editing && cur === existing.cur ? existing.home : s.home,
          date: dateInput.value || localDate(), note: note.value.trim(),
        };
        api.close();
        ctx.save(exp, !editing);
      }

      q("[data-settled]").addEventListener("click", () => { settled = !settled; drawSettle(); });
      q("[data-split]").addEventListener("click", async () => {
        const res = await openSplit({ total: value(), cur, split, paidBy });
        if (res) { split = res.split; paidBy = res.paidBy; q(".conv").innerHTML = ""; drawSplit(); drawConv(); }
      });
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

      drawDate(); drawCats(); drawSplit(); drawAmount();
    },
  });
}

// "Split this cost": how many people share it, and who paid. Resolves { split, paidBy } or null.
function openSplit({ total, cur, split, paidBy }) {
  return new Promise(resolve => {
    let result = null, n = split > 1 ? split : 2, who = paidBy;
    openSheet({
      label: "Split cost",
      render(el, api) {
        el.insertAdjacentHTML("beforeend", head("Split cost", '<button class="txtbtn" data-close>Cancel</button>', '<button class="txtbtn strong" data-done>Done</button>') +
          '<div class="sheet-body">' +
            '<p class="split-total">' + (total > 0 ? money2(total, cur) + " in total" : "Enter the full amount, then split it") + "</p>" +
            '<div class="bigstep"><button data-step="-1" aria-label="Fewer people">−</button><div><output></output><span>people, including you</span></div>' +
            '<button data-step="1" aria-label="More people">+</button></div>' +
            '<div class="switchrow"><div class="ttl">Who paid?</div><div class="seg" role="group" aria-label="Who paid"><button data-who="me">You</button><button data-who="other">Someone else</button></div></div>' +
            '<p class="preview" data-prev></p>' +
            (split > 1 ? '<button class="btn secondary" data-none>Don\'t split</button>' : "") +
          "</div>");
        const q = x => el.querySelector(x);
        function draw() {
          q("output").textContent = n;
          q('[data-step="-1"]').disabled = n <= 2;
          el.querySelectorAll("[data-who]").forEach(b => b.setAttribute("aria-pressed", b.dataset.who === who));
          const share = total / n;
          q("[data-prev]").innerHTML = total > 0
            ? "Your share is <b>" + money2(share, cur) + "</b>. " + (who === "me"
              ? "The others owe you " + money2(total - share, cur) + "."
              : "You owe " + money2(share, cur) + " to whoever paid.")
            : "Only your share counts towards your budget.";
        }
        el.querySelectorAll("[data-step]").forEach(b => b.addEventListener("click", () => { n = Math.max(2, Math.min(30, n + Number(b.dataset.step))); draw(); }));
        el.querySelectorAll("[data-who]").forEach(b => b.addEventListener("click", () => { who = b.dataset.who; draw(); }));
        q("[data-done]").addEventListener("click", () => { result = { split: n, paidBy: who }; api.close(); });
        const none = q("[data-none]");
        if (none) none.addEventListener("click", () => { result = { split: 1, paidBy: "me" }; api.close(); });
        draw();
      },
      onClose: () => resolve(result),
    });
  });
}
