// Guesses a destination's currency from country or well-known city names. Offline, best effort.

const MAP = {
  EUR: "eurozone europe austria belgium croatia cyprus estonia finland france germany greece ireland italy latvia lithuania luxembourg malta netherlands holland portugal slovakia slovenia spain andorra monaco montenegro kosovo san marino vatican " +
    "paris lyon nice marseille bordeaux berlin munich hamburg frankfurt cologne vienna salzburg brussels bruges antwerp amsterdam rotterdam dublin rome milan florence venice naples sicily sardinia turin bologna madrid barcelona seville valencia malaga ibiza mallorca majorca tenerife canary " +
    "lisbon lisboa porto madeira azores algarve athens santorini mykonos crete corfu rhodes helsinki tallinn riga vilnius split dubrovnik zagreb ljubljana bratislava valletta luxembourg",
  CHF: "switzerland suisse schweiz liechtenstein zurich zürich geneva genève bern basel lausanne lucerne luzern zermatt interlaken st. moritz lugano",
  GBP: "united kingdom uk britain england scotland wales northern ireland london edinburgh manchester liverpool glasgow oxford cambridge bath brighton belfast",
  USD: "united states usa america new york nyc los angeles san francisco las vegas miami chicago boston seattle washington hawaii honolulu orlando new orleans austin texas california florida ecuador panama el salvador puerto rico",
  CAD: "canada toronto vancouver montreal quebec calgary banff ottawa",
  JPY: "japan tokyo kyoto osaka hokkaido sapporo okinawa hiroshima nara",
  CNY: "china beijing shanghai shenzhen guangzhou chengdu xian",
  HKD: "hong kong",
  KRW: "korea seoul busan jeju",
  THB: "thailand bangkok phuket chiang mai krabi koh samui pattaya",
  VND: "vietnam hanoi ho chi minh saigon hoi an da nang",
  IDR: "indonesia bali jakarta lombok",
  MYR: "malaysia kuala lumpur penang langkawi borneo",
  SGD: "singapore",
  PHP: "philippines manila cebu palawan boracay",
  INR: "india delhi mumbai goa bangalore jaipur kerala",
  LKR: "sri lanka colombo",
  NPR: "nepal kathmandu",
  AUD: "australia sydney melbourne brisbane perth adelaide cairns",
  NZD: "new zealand auckland queenstown wellington christchurch",
  MXN: "mexico cancun tulum mexico city oaxaca playa del carmen",
  BRL: "brazil rio de janeiro são paulo sao paulo salvador",
  ARS: "argentina buenos aires patagonia mendoza",
  CLP: "chile santiago atacama",
  PEN: "peru lima cusco machu picchu",
  COP: "colombia bogota bogotá medellin cartagena",
  CRC: "costa rica",
  ZAR: "south africa cape town johannesburg durban kruger",
  MAD: "morocco marrakech marrakesh fes casablanca tangier",
  EGP: "egypt cairo luxor hurghada sharm",
  TND: "tunisia tunis djerba",
  KES: "kenya nairobi mombasa",
  TZS: "tanzania zanzibar kilimanjaro serengeti",
  AED: "united arab emirates uae dubai abu dhabi",
  QAR: "qatar doha",
  OMR: "oman muscat",
  JOD: "jordan amman petra",
  ILS: "israel tel aviv jerusalem",
  TRY: "turkey türkiye istanbul antalya cappadocia bodrum izmir",
  SEK: "sweden stockholm gothenburg malmö malmo",
  NOK: "norway oslo bergen tromsø tromso lofoten",
  DKK: "denmark copenhagen faroe",
  ISK: "iceland reykjavik reykjavík",
  PLN: "poland warsaw krakow kraków gdansk",
  CZK: "czech czechia prague brno",
  HUF: "hungary budapest",
  RON: "romania bucharest transylvania",
  BGN: "bulgaria sofia",
  RSD: "serbia belgrade",
  ALL: "albania tirana",
  GEL: "georgia tbilisi",
  MVR: "maldives",
  MUR: "mauritius",
};

const INDEX = Object.entries(MAP);

export function guessCurrency(text) {
  const q = " " + (text || "").toLowerCase().replace(/[,/()-]/g, " ").replace(/\s+/g, " ").trim() + " ";
  if (q.trim().length < 3) return null;
  let best = null, bestLen = 0;
  for (const [cur, words] of INDEX) {
    // Try every known place: longest match wins.
    for (const name of splitNames(words)) {
      if (name.length > bestLen && q.includes(" " + name + " ")) { best = cur; bestLen = name.length; }
    }
  }
  return best;
}

const cache = new Map();
function splitNames(words) {
  if (cache.has(words)) return cache.get(words);
  // Words list is space separated; known multi-word names are joined back together.
  const multi = ["united kingdom", "northern ireland", "united states", "new york", "los angeles", "san francisco", "las vegas", "new orleans",
    "hong kong", "chiang mai", "koh samui", "ho chi minh", "hoi an", "da nang", "kuala lumpur", "sri lanka", "new zealand", "mexico city",
    "playa del carmen", "rio de janeiro", "são paulo", "sao paulo", "buenos aires", "machu picchu", "costa rica", "south africa", "cape town",
    "united arab emirates", "abu dhabi", "tel aviv", "san marino", "el salvador", "puerto rico", "st. moritz", "northern ireland"];
  const out = [];
  let rest = " " + words + " ";
  for (const m of multi) if (rest.includes(" " + m + " ")) { out.push(m); rest = rest.replace(" " + m + " ", " "); }
  out.push(...rest.trim().split(/\s+/).filter(Boolean));
  cache.set(words, out);
  return out;
}
