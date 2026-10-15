// Review screen for a bank CSV: pick which payments to add and where they go. All on the device.
import { decode, readStatement, extract, guessKind, cleanDesc } from "./bankcsv.js";
import { esc, uid, plural, money2, fmtDay, fmtRange } from "./util.js";
import { icon, catIcon, kindOf } from "./icons.js";
import { openSheet, head } from "./sheets.js";

const cleanNote = cleanDesc;

// ctx: { state, trip, rate, ensureCurrency, hues, today, add(expenses), toast }
export async function importFile(ctx, file) {
  const text = decode(new Uint8Array(await file.arrayBuffer()));
  const s = ctx.state(), t = ctx.trip();
  const res = readStatement(text, s.home);
  if (!res.ok) return notReadable(file.name);
  if (!res.tx.length) return notReadable(file.name, true);
  review(ctx, res, file.name, s, t);
}

function notReadable(name, empty) {
  openSheet({
    label: "Can't import", cls: "compact",
    render(el) {
      el.insertAdjacentHTML("beforeend", '<div class="sheet-body confirm"><h2>' + (empty ? "No payments found" : "Couldn't read this file") + "</h2><p>" +
        (empty ? "“" + esc(name) + "” has a table, but no money going out in it."
          : "“" + esc(name) + "” doesn't look like a bank transaction export. Look for a CSV export of the account's transactions in e-banking.") +
        '</p><button class="btn" data-close>OK</button></div>');
    },
  });
}

function review(ctx, res, name, s, t) {
  let map = res.map;
  let tx = res.tx;
  const hasDates = !!(t.start && t.end);
  let onlyTrip = hasDates;
  const known = new Set(s.trips.flatMap(x => x.exp.map(e => e.ref).filter(Boolean)));
  let rows = [];

  function catForKind(kind) {
    if (!kind) return null;
    const c = t.cats.find(c => kindOf(c.name) === kind);
    return c ? c.id : null;
  }
  // Close to something already logged by hand: same day ±1, amount within 3% (card fees, rate differences).
  function looksLogged(r, home) {
    return t.exp.some(e => {
      if (e.src === "bank") return false;
      const dd = Math.abs((new Date(e.date + "T00:00:00") - new Date(r.date + "T00:00:00")) / 86400000);
      const eh = Number(e.homeAmount) || 0;
      return dd <= 1 && Math.abs(eh - home) <= Math.max(0.5, home * 0.03);
    });
  }
  function build() {
    rows = tx.filter(r => !known.has(r.ref)).map(r => {
      const rate = r.cur === s.home ? 1 : ctx.rate(r.cur);
      const home = r.amount * rate;
      const inTrip = !hasDates || (r.date >= t.start && r.date <= t.end);
      const dup = looksLogged(r, home);
      return { ...r, rate, home, inTrip, dup, cat: catForKind(guessKind(r.desc, r.bankCat)), on: inTrip && !dup && rate > 0 };
    });
  }
  build();
  const skipped = tx.length - rows.length;

  openSheet({
    label: "Import from bank", cls: "tall plain imp",
    render(el, api) {
      el.insertAdjacentHTML("beforeend", head("Import", '<button class="txtbtn" data-close>Cancel</button>', "") +
        '<div class="sheet-body"><p class="imp-sum"></p>' +
        '<div class="list">' +
          (hasDates ? '<div class="switchrow imp-switch"><div><div class="ttl">Only during the trip</div><div class="sub">' + esc(fmtRange(t.start, t.end)) +
            '</div></div><button class="switch" role="switch" data-only aria-label="Only during the trip"><i></i></button></div>' : "") +
          '<button class="row noicon" data-cols><span class="main"><span class="ttl">Columns</span><span class="sub" data-colsub></span></span>' + icon("chevron", "chev") + "</button>" +
        '</div><div class="list imp-list"></div></div>' +
        '<div class="wiz-foot"><p class="wiz-sum"></p><button class="btn" data-go>Import</button>' +
        '<button class="txtbtn delbtn" data-bulk>Set a category for all selected</button></div>');
      const q = x => el.querySelector(x);

      function colLabel() {
        const h = res.headers;
        return [h[map.date], map.debit >= 0 ? h[map.debit] : h[map.amount], map.desc.map(i => h[i]).join(" + ") || "no description"].filter(Boolean).join(" · ");
      }
      function draw() {
        const visible = rows.filter(r => !onlyTrip || r.inTrip);
        q(".imp-sum").textContent = plural(tx.length, "payment") + " in “" + name + "”" +
          (skipped ? " · " + skipped + " already imported" : "") + (onlyTrip && visible.length < rows.length ? " · " + (rows.length - visible.length) + " outside the trip" : "");
        if (q("[data-only]")) q("[data-only]").setAttribute("aria-checked", onlyTrip);
        q("[data-colsub]").textContent = colLabel();
        q(".imp-list").innerHTML = visible.length ? visible.map(r => {
          const i = rows.indexOf(r), cat = t.cats.find(c => c.id === r.cat), ci = t.cats.indexOf(cat);
          return '<div class="row imp-row' + (r.on ? " on" : "") + '" data-i="' + i + '">' +
            '<button class="tick" role="checkbox" aria-checked="' + r.on + '" aria-label="Import ' + esc(cleanNote(r.desc) || "payment") + '">' + icon("check") + "</button>" +
            '<span class="main"><span class="ttl">' + esc(cleanNote(r.desc) || "Payment") + '</span><span class="sub">' + esc(fmtDay(r.date, ctx.today())) +
              (r.dup ? ' · <em>looks already logged</em>' : "") + (r.rate > 0 ? "" : ' · <em>no ' + r.cur + " rate</em>") + "</span>" +
              '<button class="catpick" data-pick="' + i + '"' + (cat ? ' style="--h:' + ctx.hues[ci % ctx.hues.length] + '"' : "") + ">" +
                (cat ? '<span class="ic">' + catIcon(cat.name) + "</span>" + esc(cat.name) : "Choose category") + "</button></span>" +
            '<span class="end"><span class="amt">' + money2(r.home, s.home) + "</span>" + (r.cur !== s.home ? '<span class="amt2">' + money2(r.amount, r.cur) + "</span>" : "") + "</span></div>";
        }).join("") : '<p class="foot" style="text-align:center;padding:30px 16px">No payments ' + (onlyTrip ? "during the trip's dates." : "to import.") + "</p>";
        const sel = rows.filter(r => r.on && (!onlyTrip || r.inTrip));
        const total = sel.reduce((a, r) => a + r.home, 0);
        const missing = sel.filter(r => !r.cat).length;
        q(".wiz-sum").innerHTML = sel.length ? plural(sel.length, "payment") + " selected · <b>" + money2(total, s.home) + "</b>" +
          (missing ? " · " + missing + " without a category" : "") : "";
        q("[data-go]").disabled = !sel.length || missing > 0;
        q("[data-go]").textContent = missing ? "Choose a category for each" : sel.length ? "Import " + plural(sel.length, "expense") : "Import";
        q("[data-bulk]").style.display = sel.length > 1 ? "" : "none";
      }

      el.addEventListener("click", async e => {
        const pick = e.target.closest("[data-pick]");
        if (pick) {
          const r = rows[Number(pick.dataset.pick)];
          const c = await chooseCategory(t, ctx.hues, r.cat);
          if (c) {
            r.cat = c; r.on = true;
            // Apply to other selected payments from the same merchant that have no category yet.
            const key = cleanNote(r.desc).split(/[\s*·]/)[0].toLowerCase();
            rows.forEach(o => { if (!o.cat && key && cleanNote(o.desc).toLowerCase().startsWith(key)) o.cat = c; });
            draw();
          }
          return;
        }
        const row = e.target.closest(".imp-row");
        if (row) {
          const r = rows[Number(row.dataset.i)];
          if (r.rate > 0) { r.on = !r.on; draw(); }
          return;
        }
        if (e.target.closest("[data-only]")) { onlyTrip = !onlyTrip; draw(); return; }
        if (e.target.closest("[data-cols]")) {
          const m = await chooseColumns(res.headers, map);
          if (m) { map = m; tx = extract(res.rows, res.headerIndex, map, s.home); build(); draw(); }
          return;
        }
        if (e.target.closest("[data-bulk]")) {
          const c = await chooseCategory(t, ctx.hues, null);
          if (c) { rows.forEach(r => { if (r.on && (!onlyTrip || r.inTrip)) r.cat = c; }); draw(); }
          return;
        }
        if (e.target.closest("[data-go]")) {
          const sel = rows.filter(r => r.on && r.cat && (!onlyTrip || r.inTrip));
          const now = new Date().toISOString();
          const list = sel.map(r => ({
            id: uid(), at: now, catId: r.cat, itemId: null, amount: r.amount, cur: r.cur, rate: r.rate, homeAmount: r.home, home: s.home,
            date: r.date, note: cleanNote(r.desc), src: "bank", ref: r.ref,
          }));
          sel.forEach(r => ctx.ensureCurrency(r.cur));
          api.close();
          ctx.add(list);
        }
      });
      draw();
    },
  });
}

function chooseCategory(t, hues, current) {
  return new Promise(resolve => {
    let picked = null;
    openSheet({
      label: "Category",
      render(el, api) {
        el.insertAdjacentHTML("beforeend", head("Category", '<button class="txtbtn" data-close>Cancel</button>', "") +
          '<div class="sheet-body"><div class="list">' + t.cats.map((c, ci) =>
            '<button class="row" data-c="' + c.id + '"><span class="ic" style="--h:' + hues[ci % hues.length] + '">' + catIcon(c.name) + '</span><span class="main"><span class="ttl">' +
            esc(c.name || "Untitled") + "</span></span>" + (c.id === current ? icon("check", "tick") : "") + "</button>").join("") + "</div></div>");
        el.addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (b) { picked = b.dataset.c; api.close(); } });
      },
      onClose: () => resolve(picked),
    });
  });
}

function chooseColumns(headers, map) {
  return new Promise(resolve => {
    let result = null;
    const m = { ...map, desc: [...map.desc] };
    const opts = sel => headers.map((h, i) => '<option value="' + i + '"' + (i === sel ? " selected" : "") + ">" + esc(h || "Column " + (i + 1)) + "</option>").join("");
    openSheet({
      label: "Columns", cls: "tall",
      render(el, api) {
        el.insertAdjacentHTML("beforeend", head("Columns", '<button class="txtbtn" data-close>Cancel</button>', '<button class="txtbtn strong" data-done>Done</button>') +
          '<div class="sheet-body"><p class="foot" style="margin:0 2px 14px">Tell the app which column holds what. Nothing leaves your phone.</p>' +
          '<div class="list">' +
            '<label class="row noicon"><span class="main"><span class="ttl">Date</span></span><select data-f="date">' + opts(m.date) + "</select></label>" +
            '<label class="row noicon"><span class="main"><span class="ttl">Money out</span><span class="sub">Debit column, or a signed amount</span></span><select data-f="out">' +
              opts(m.debit >= 0 ? m.debit : m.amount) + "</select></label>" +
          '</div><p class="ftitle">Description</p><div class="chipwrap" data-desc>' +
            headers.map((h, i) => '<button class="linechip" role="checkbox" data-d="' + i + '" aria-checked="' + m.desc.includes(i) + '">' + esc(h || "Column " + (i + 1)) + "</button>").join("") +
          "</div></div>");
        el.querySelector("[data-desc]").addEventListener("click", e => {
          const b = e.target.closest("[data-d]");
          if (!b) return;
          const i = Number(b.dataset.d);
          m.desc = m.desc.includes(i) ? m.desc.filter(x => x !== i) : [...m.desc, i].sort((a, b2) => a - b2);
          b.setAttribute("aria-checked", m.desc.includes(i));
        });
        el.querySelector("[data-done]").addEventListener("click", () => {
          m.date = Number(el.querySelector('[data-f="date"]').value);
          const out = Number(el.querySelector('[data-f="out"]').value);
          const isDebit = /debit|belastung|débit|lastschrift|withdraw|out|addebito/i.test(headers[out] || "");
          if (isDebit) { m.debit = out; m.amount = -1; } else { m.amount = out; m.debit = -1; }
          result = m;
          api.close();
        });
      },
      onClose: () => resolve(result),
    });
  });
}
