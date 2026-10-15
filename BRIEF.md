# Build brief — Trip budget & spend tracker

Build a personal trip-budgeting web app, deployed on GitHub Pages, with a Google Sheet as the
data store. I have a working single-file prototype (`trips.html`) — read it first. It defines
the interaction model and the visual design; keep both. Your job is to turn it into a real,
multi-device, offline-capable app.

## Constraints

- **Static only.** GitHub Pages serves static files, so there is no server and no place to hide
  a service-account key. Do not attempt server-side Google auth from the page.
- **No build step if avoidable.** Plain ES modules, vanilla JS, one CSS file. If you introduce a
  bundler, it must deploy via GitHub Actions and still work when opened from the Pages URL.
- **Offline-first is mandatory.** I will use this abroad on mobile data or no data at all.
  The app must be fully usable with zero connectivity and sync when it reconnects.
- **Single user (me).** No multi-user auth, no accounts, no roles.

## Architecture

**Frontend** — static site in `/docs` (or `/` with a Pages workflow), installable as a PWA:
manifest, service worker, app icon. It must open and work from the home screen on iOS with
no network.

**Local storage is the source of truth.** All reads render from IndexedDB (use `idb-keyval` or
plain IDB — not localStorage, the expense log will outgrow it). Writes go to IDB immediately and
are appended to an outbox queue.

**Backend** — a Google Apps Script web app bound to the sheet:
- `doGet` returns the full dataset as JSON.
- `doPost` accepts a batch of mutations and applies them.
- Deploy as "Execute as: me", "Who has access: anyone with the link".
- Guard it with a shared secret passed as a header or query param. This is weak security by
  design — it is a personal budget, not medical records — but say so in the README and keep the
  secret out of the repo.
- Commit the script as `apps-script/Code.gs` in the repo so it is version controlled, and write
  setup steps in the README.

**Sync** — pull on app open and on regaining connectivity; push the outbox on the same triggers
and after each mutation when online. Every record carries `updatedAt` (ISO) and `deleted`
(boolean, for tombstones). Conflict resolution is last-write-wins on `updatedAt`. Show sync
state in the UI: synced / pending N changes / offline / error. Never block the UI on a network
call, and never lose a queued write.

## Sheet layout

One tab per entity, header row matching the field names exactly:

- `trips` — id, name, dest, start, end, people, saved, updatedAt, deleted
- `categories` — id, tripId, name, sort, updatedAt, deleted
- `items` — id, categoryId, name, amount, cur, basis, type, updatedAt, deleted
- `expenses` — id, tripId, categoryId, itemId, amount, cur, rate, homeAmount, date, note, updatedAt, deleted
- `rates` — cur, rate, updatedAt
- `settings` — key, value

`basis` is one of `once | person | day | night | personday`.
`type` is one of `fixed | variable`.

## Domain rules

These come from the prototype and must be preserved exactly:

- Trip length is derived from `start` and `end`. `nights = end - start`, `days = nights + 1`.
  Never ask the user for a day count.
- A line item's planned cost is `amount × rate(cur)` multiplied by: nothing (`once`),
  `people`, `days`, `nights`, or `days × people` — per its `basis`.
- `fixed` means committed, `variable` means an estimate. Surface the split: how much of the
  budget can still move.
- An expense stores the FX rate **in effect at the moment it was logged**, plus the resulting
  home-currency amount. Editing a rate later must never retroactively change past expenses.
- An expense may attach to a whole category rather than a specific line item.
- Category totals show spent against planned. The trip total is the sum of category planned.

## Features beyond the prototype

1. **Live exchange rates.** Fetch from `frankfurter.app` (free, no key, ECB daily rates) on
   open when online; cache them; allow manual override per currency. Show the rate's date.
   When offline, use the cached rate and say so.
2. **Fast mobile expense entry.** The logging flow is the thing I will use twenty times a day
   while walking around — it must be a single screen with a big numeric keypad, the amount
   focused on open, currency defaulting to the destination currency, and category as large
   tap targets rather than a `<select>`. Optimise this over everything else.
3. **Pace indicator.** Given days elapsed against days total, show whether variable spending is
   ahead of or behind plan, and the daily allowance remaining for the rest of the trip.
4. **Per-category detail view** listing that category's expenses.
5. **CSV export** of expenses for a trip.

## Design

Match the prototype's design system — do not restyle it:

- Palette: paper `#E9EBE8`, card `#FFFFFF`, ink `#16211E`, muted `#6B7974`, faint `#95A09B`,
  hairline `rgba(22,33,30,.13)`, positive `#2F6F5E`, over `#A83E33`.
- Category hues: `#4F6F8F #8C6A4F #4F7F7A #7E6B8F #A08948 #93656A #5F7355 #5C6E8C`.
- Type: Instrument Sans, weights 400/500/600, tabular figures on all numbers.
- Generous whitespace, hairline dividers, no drop shadows, no gradients, no icon library.
- The stacked allocation bar is the signature element. Keep it.
- Mobile is the primary target — the desktop layout is secondary.

## Deployment

- Enable GitHub Pages on the repo, serving from the branch and folder you choose.
- If you use a workflow, commit it and confirm it runs green.
- The secret and the Apps Script URL must not be committed. Prompt for them on first run and
  store them in IDB, with a settings screen to change them.
- `README.md` must contain, in order: create the sheet, add the script, deploy it as a web app,
  copy the URL and secret, open the Pages URL, paste them in. Write it so I can follow it
  without reading any code.

## Definition of done

- Works fully with the network off, including logging expenses, and syncs cleanly when it
  returns.
- Installs to the iOS home screen and opens without a browser chrome.
- Data survives a hard refresh and appears on a second device after sync.
- Killing the app mid-sync loses nothing.
- Lighthouse PWA and accessibility both pass.

Work in small commits. Before you start, tell me the plan and flag anything in this brief you
think is wrong.
