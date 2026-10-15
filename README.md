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
- The only network request the app makes is for exchange rates (see below).

### Back it up

If the phone is lost or reset, the data goes with it, so back up now and then, especially
before and during a trip:

1. In **Settings**, tap **Back up all data**.
2. In the share sheet, choose **Save to Files** and pick **iCloud Drive**.

To restore on a new phone, install the app, go to **Settings → Restore a backup** and pick that file.
Restoring replaces everything currently in the app.

Settings shows when you last backed up, and Home reminds you if it's been more than two weeks.

## Using it

The app has four tabs and a big **+** button in the middle of the tab bar.

- **Home:** what's left to spend, today's allowance and how you're pacing, your categories,
  and recent expenses. Tap the trip name at the top to switch trips or start a new one.
- **+ (add expense):** type the amount on the keypad, tap a category, tap **Add**. The
  currency starts on the trip's local currency (tap it to change), and the last category you
  used is already selected. You can attach an expense to one planned cost or leave it on the
  whole category, add a note, or change the date.
- **Activity:** every expense, grouped by day, filterable by category. Tap an expense to
  edit it. Swipe left to delete. Every change can be undone from the message at the bottom.
- **Budget:** trip details, then each category's planned costs. Each cost has an amount, a
  currency, how it adds up (one-off, per person, per day, per night, per person per day) and
  whether it's **booked** or an **estimate**. Tap a category to see its expenses.
- **Settings:** trips, home currency, exchange rates, backup and restore, CSV export.

Swipe a sheet down to close it. The app follows your phone's light or dark mode.

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

Only **estimate** lines count, because fixed costs are already committed. The estimate
total is spread evenly over the trip's days. An expense counts against it unless it's attached
to a fixed line, so an expense on a whole category counts as variable.

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
