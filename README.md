# Trips

A personal trip budget and spending tracker. It runs as an app on your iPhone's home screen,
works with no internet connection, and keeps all its data on the phone.

**App:** https://amam2027.github.io/travels/

## Put it on your iPhone

1. Open the link above in **Safari** (not Chrome; only Safari can install it).
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. From now on, open it from the home-screen icon only.

Step 3 matters. The home-screen app and Safari keep **separate** storage, so anything you
enter in a Safari tab will not show up in the app. Safari can also wipe website data after a few
weeks without use. Data in the home-screen app is kept.

After the first open, the app works fully offline: planning, logging expenses, everything.

## Where your data lives

- Only on the device, in the app's own storage. Nothing is sent anywhere.
- The code is public on GitHub. Your trips and expenses are not: anyone who opens the link
  sees an empty app.
- The only network request the app makes is for exchange rates (see below). Bank files you
  import are read on the phone and never uploaded.

### Back it up

If the phone is lost or reset, the data goes with it, so back up now and then, especially
before and during a trip:

1. In **Settings**, tap **Back up all data**.
2. In the share sheet, choose **Save to Files** and pick **iCloud Drive**.

To restore on a new phone, install the app, go to **Settings → Restore a backup** and pick that file.
Restoring replaces everything currently in the app.

Settings shows when you last backed up, and Home reminds you if it's been more than two weeks.

## Using it

**Planning a trip.** Tap **Plan a trip** and answer four questions: where (the local currency
is filled in for you), when (tap your first and last day on the calendar), who's going, and a
rough budget for flights, stay, food, getting around, activities and shopping. Leave blank
anything you don't know.

**The budget.** Each category has one budget: an amount, how it adds up (for the whole trip, per week,
per day, per night, per person, or per person per day) and whether it's **already booked**.
Tap a category in **Budget** to change it — the sheet shows what it comes to, e.g.
"× 7 days × 2 people = CHF 392". Booked costs are committed. Everything else is your
**flexible** budget, which is what the daily allowance on Home is worked out from. If one
category needs several costs (a hotel and an Airbnb, say), use **Split into several costs**.

**Logging.** Tap **+**, type the amount, tap a category, tap **Add**. The currency starts on
the trip's local currency (tap it to change) and your last category is already selected.

**Sharing costs with friends.** When you log an expense, enter the full amount and tap
**Split**: choose how many people share it (you included) and who paid. Only your share counts
towards your budget and daily allowance. **Activity** shows the running balance — what
friends owe you for things you paid, minus what you owe for things they paid — and a
**Shared** filter. Any expense, including an imported bank payment, can be split later by
tapping it.

**Everything else.**

- **Home:** what's left to spend, today's allowance and pace, categories and recent expenses.
  Tap the trip name to switch trips or plan another.
- **Activity:** every expense by day. Tap one to edit it, swipe left to delete. Changes can
  be undone from the message at the bottom.
- **Trip details** (tap the line above "Budget", or Settings → Trip details): destination,
  dates, travellers, local currency, savings, and deleting the trip.
- **Settings:** home currency, exchange rates, backup and restore, CSV export.

Swipe a sheet down to close it. The app follows your phone's light or dark mode.

### Importing card payments from your bank

In UBS e-banking, export the account's transactions as CSV and save the file to Files. In the
app, go to **Activity → Import** (or **Settings → Import from bank**) and pick the file.

- It's read on the phone. Nothing is uploaded.
- Only money going out is listed, and by default only payments during the trip's dates.
- Each payment gets a suggested category, from the merchant name or the bank's own category
  (Groceries → Food & drinks, Public transport → Getting around). Tap one to change it.
  Choosing a category for one merchant fills it in for that merchant's other payments.
- Anything that looks like an expense you already logged by hand (same day ±1, amount within
  3%) is left unticked. Importing the same file again never adds duplicates.
- The amount is what your bank actually charged, so it includes any card fees and the bank's
  exchange rate.
- If the app picks the wrong columns, tap **Columns** and choose them yourself. It reads
  English, German and French exports, comma- or semicolon-separated.

The whole import can be undone from the message that appears afterwards.

### Exchange rates

When online, the app fetches the European Central Bank's daily reference rates (from
frankfurter.dev) and shows their date. Offline, it uses the last rates it fetched and says so.

- In **Settings**, tap a currency to override its rate. **Use the live rate** switches back.
- Currencies the ECB doesn't publish (for example MAD or VND) are marked **Set by you**, and you
  set them yourself. If you log an expense in a currency with no rate, the entry screen asks
  for one.
- Every expense keeps the rate it was logged with. Changing a rate later never changes past
  expenses.

### How pace is calculated

Only the **flexible** budget counts, because booked costs are already committed. It's spread
evenly over the trip's days. An expense counts as flexible unless it's in a category whose
budget is entirely booked (or attached to a booked cost in a split category).

## Making changes (for development)

No build step. The app is plain HTML, CSS and JavaScript in `docs/`, which GitHub Pages serves.

```sh
npm run serve   # http://127.0.0.1:8765 (add ?sw to test offline mode locally)
npm test        # budget maths tests (node, no dependencies)
```

**Before pushing a change, bump `VERSION` in `docs/sw.js`.** The app caches its files
for offline use, so without a new version number phones keep running the old code. With a new
number, the app updates itself the next time it's opened with a connection. It reloads once,
and never while you're mid-entry.

`trips.html` is the original prototype, kept for reference.
