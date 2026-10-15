// Daily ECB reference rates from frankfurter (free, no key).

const API = "https://api.frankfurter.dev/v1/latest";

// Returns { date, rates } where rates[cur] = how many `home` units one `cur` buys.
export async function fetchLive(home, timeoutMs = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(API + "?base=" + encodeURIComponent(home), { cache: "no-store", signal: ctl.signal });
    if (!r.ok) throw new Error(r.status === 404 ? home + " is not covered by the ECB" : "HTTP " + r.status);
    const j = await r.json();
    const rates = {};
    for (const [cur, perHome] of Object.entries(j.rates || {})) {
      if (perHome > 0) rates[cur] = Number((1 / perHome).toPrecision(6));
    }
    return { date: j.date, rates };
  } finally {
    clearTimeout(timer);
  }
}

export function allCurrencies() {
  try {
    const list = Intl.supportedValuesOf("currency");
    if (list && list.length) return list;
  } catch (e) { /* older Safari */ }
  return ["AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF", "IDR", "ILS", "INR", "ISK", "JPY",
    "KRW", "MAD", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "VND", "ZAR"];
}
