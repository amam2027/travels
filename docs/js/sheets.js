// iOS-style bottom sheets: slide up, stack, drag down to dismiss.
import { $, esc, currencyName } from "./util.js";
import { icon } from "./icons.js";

const stack = [];

function setInert() {
  $("app").inert = stack.length > 0;
  stack.forEach((s, i) => { s.wrap.inert = i < stack.length - 1; });
}

// opts: { label, cls, render(body, api), onClose(result) }
// render gets the sheet element; return value of api.close(x) is passed to onClose.
export function openSheet(opts) {
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap";
  wrap.innerHTML = '<div class="scrim"></div><section class="sheet ' + (opts.cls || "") + '" role="dialog" aria-modal="true" aria-label="' +
    esc(opts.label || "") + '"><div class="grabber" aria-hidden="true"></div></section>';
  $("sheets").appendChild(wrap);
  const sheet = wrap.querySelector(".sheet");
  const entry = { wrap, sheet, opts, opener: document.activeElement, closed: false };
  stack.push(entry);

  const api = {
    el: sheet,
    close(result) { close(entry, result); },
  };
  entry.api = api;
  opts.render(sheet, api);
  setInert();

  wrap.querySelector(".scrim").addEventListener("click", () => api.close());
  sheet.addEventListener("click", e => { if (e.target.closest("[data-close]")) api.close(); });
  enableDrag(entry);

  void wrap.offsetWidth;
  wrap.classList.add("open");
  const focus = sheet.querySelector("[autofocus]") || sheet;
  if (focus === sheet) sheet.tabIndex = -1;
  focus.focus({ preventScroll: true });
  return api;
}

function close(entry, result) {
  if (entry.closed) return;
  entry.closed = true;
  const i = stack.indexOf(entry);
  if (i >= 0) stack.splice(i, 1);
  setInert();
  entry.wrap.classList.remove("open");
  const done = () => entry.wrap.remove();
  entry.sheet.addEventListener("transitionend", done, { once: true });
  setTimeout(done, 500);
  if (entry.opener && entry.opener.focus && document.contains(entry.opener)) entry.opener.focus({ preventScroll: true });
  if (entry.opts.onClose) entry.opts.onClose(result);
}

export function topSheet() { return stack.length ? stack[stack.length - 1] : null; }
export function closeAll() { while (stack.length) close(stack[stack.length - 1]); }

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && stack.length) { e.preventDefault(); stack[stack.length - 1].api.close(); }
});

// Drag the grabber or header down to dismiss; also pull down from the top of the scrolled body.
function enableDrag(entry) {
  const { sheet } = entry;
  let startY = 0, dy = 0, t0 = 0, dragging = false, scroller = null;

  sheet.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    const handle = e.target.closest(".grabber, .sheet-head");
    scroller = e.target.closest(".sheet-body");
    if (!handle && !(scroller && scroller.scrollTop <= 0)) return;
    if (e.target.closest("input, textarea, select, .keypad, .hscroll")) return;
    startY = e.clientY; dy = 0; t0 = performance.now(); dragging = "maybe";
  });
  sheet.addEventListener("pointermove", e => {
    if (!dragging) return;
    const d = e.clientY - startY;
    if (dragging === "maybe") {
      if (d > 8) { dragging = true; sheet.classList.add("dragging"); try { sheet.setPointerCapture(e.pointerId); } catch (x) {} }
      else if (d < -4) { dragging = false; return; }
      else return;
    }
    dy = Math.max(0, d);
    sheet.style.transform = "translateY(" + dy + "px)";
  });
  const end = () => {
    if (dragging !== true) { dragging = false; return; }
    dragging = false;
    sheet.classList.remove("dragging");
    const v = dy / Math.max(1, performance.now() - t0);
    sheet.style.transform = "";
    if (dy > sheet.offsetHeight * 0.3 || (v > 0.6 && dy > 40)) entry.api.close();
  };
  sheet.addEventListener("pointerup", end);
  sheet.addEventListener("pointercancel", end);
}

// Header with optional left/right buttons.
export function head(title, left, right) {
  return '<div class="sheet-head"><div class="l">' + (left || "") + '</div><h2>' + esc(title) + '</h2><div class="r">' + (right || "") + "</div></div>";
}

// iOS action-sheet style confirmation. Resolves true or false.
export function confirmSheet({ title, message, confirm = "Delete", destructive = true }) {
  return new Promise(resolve => {
    let answer = false;
    openSheet({
      label: title, cls: "compact",
      render(el, api) {
        el.insertAdjacentHTML("beforeend",
          '<div class="sheet-body confirm"><h2>' + esc(title) + "</h2>" + (message ? "<p>" + esc(message) + "</p>" : "") +
          '<button class="btn ' + (destructive ? "destructive" : "") + '" data-yes autofocus>' + esc(confirm) + "</button>" +
          '<button class="btn secondary" data-close>Cancel</button></div>');
        el.querySelector("[data-yes]").addEventListener("click", () => { answer = true; api.close(); });
      },
      onClose: () => resolve(answer),
    });
  });
}

// Searchable currency list. Resolves to a code or null.
export function pickCurrency({ title = "Currency", current, suggested = [], all }) {
  return new Promise(resolve => {
    let picked = null;
    openSheet({
      label: title, cls: "tall",
      render(el, api) {
        el.insertAdjacentHTML("beforeend", head(title, '<button class="txtbtn" data-close>Cancel</button>', "") +
          '<div class="searchbar">' + icon("search") + '<input type="search" placeholder="Search currencies" aria-label="Search currencies" autocomplete="off" spellcheck="false"></div>' +
          '<div class="sheet-body"><div class="curlist"></div></div>');
        const list = el.querySelector(".curlist"), input = el.querySelector("input");
        const row = c => '<button class="row noicon" data-cur="' + c + '"><span class="main"><span class="ttl">' + c + '</span><span class="sub">' +
          esc(currencyName(c)) + "</span></span>" + (c === current ? icon("check", "tick") : "") + "</button>";
        const sug = [...new Set(suggested.filter(Boolean))];
        function draw() {
          const q = input.value.trim().toLowerCase();
          const match = c => !q || c.toLowerCase().includes(q) || currencyName(c).toLowerCase().includes(q);
          let h = "";
          const s1 = sug.filter(match);
          if (s1.length) h += '<p class="ftitle">Suggested</p><div class="list">' + s1.map(row).join("") + "</div>";
          const s2 = all.filter(c => !sug.includes(c) && match(c));
          if (s2.length) h += '<p class="ftitle">All currencies</p><div class="list">' + s2.map(row).join("") + "</div>";
          list.innerHTML = h || '<p class="emptystate">No currency matches “' + esc(input.value) + "”.</p>";
        }
        input.addEventListener("input", draw);
        list.addEventListener("click", e => {
          const b = e.target.closest("[data-cur]");
          if (b) { picked = b.dataset.cur; api.close(); }
        });
        draw();
      },
      onClose: () => resolve(picked),
    });
  });
}
