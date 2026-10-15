// Hand-drawn 24px line icons. No icon library.

const P = {
  home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  activity: '<path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z"/><path d="M9 8.5h6M9 12h6"/>',
  budget: '<path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z"/><path d="M15 3.8A8.5 8.5 0 0 1 20.2 9H15z"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  back: '<path d="m14.5 5-7 7 7 7"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
  plane: '<path d="M21 15.5 13.5 11V5.5a1.5 1.5 0 0 0-3 0V11L3 15.5V17l7.5-2.5V19L8 20.5V22l4-1 4 1v-1.5L13.5 19v-4.5L21 17z"/>',
  train: '<rect x="6" y="3.5" width="12" height="13" rx="3"/><path d="M6 11h12M9 20.5l1.5-4M15 20.5l-1.5-4"/>',
  bed: '<path d="M3 18.5V6M3 14h18v4.5M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="10.5" r="1.8"/>',
  car: '<path d="M5 16.5V12l2-5h10l2 5v4.5M5 16.5h14M5 16.5V19M19 16.5V19M5 12h14"/>',
  food: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1-3 4-3 7h3"/>',
  star: '<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  bag: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  dots: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  users: '<circle cx="9" cy="9" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.5M17.5 19a5.5 5.5 0 0 0-2.5-4.6"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>',
  swap: '<path d="M7 4 4 7l3 3M4 7h13M17 20l3-3-3-3M20 17H7"/>',
  upload: '<path d="M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.5 1.5A3.75 3.75 0 0 1 17.5 18M12 12v7M9 14.5l3-3 3 3"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  file: '<path d="M7 3.5h7l4 4v13H7zM14 3.5V8h4M10 13h5M10 16.5h5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  suitcase: '<rect x="4" y="7.5" width="16" height="12" rx="2"/><path d="M9 7.5V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2.5M9 11v5M15 11v5"/>',
  note: '<path d="M5 6h14M5 11h14M5 16h9"/>',
  shield: '<path d="M12 3.5 5 6v6c0 4 3 7.5 7 8.5 4-1 7-4.5 7-8.5V6z"/><path d="m9 12 2 2 4-4"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="4" y="8" width="16" height="11" rx="2"/><circle cx="16" cy="13.5" r="1"/>',
  del: '<path d="M9 6h11v12H9l-5-6z"/><path d="m12 9.5 5 5M17 9.5l-5 5"/>',
};

export function icon(name, cls) {
  return '<svg class="i' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || "") + "</svg>";
}

const RULES = [
  [/flight|plane|air/i, "plane"],
  [/transport|train|bus|taxi|uber|metro|ferry|transit|getting around|local travel/i, "train"],
  [/hotel|accom|stay|airbnb|lodg|hostel|apartment/i, "bed"],
  [/car|rental|gas|fuel|petrol|parking|toll/i, "car"],
  [/food|meal|restaurant|eat|drink|grocer|coffee|bar|dinner|lunch|breakfast/i, "food"],
  [/activit|tour|museum|ticket|fun|excursion|sight|entertain/i, "star"],
  [/shop|souvenir|gift|cloth/i, "bag"],
  [/other|misc|extra/i, "dots"],
];

// Icon for a category or line name, falling back to its first letter.
export function catIcon(name) {
  for (const [re, ic] of RULES) if (re.test(name || "")) return icon(ic);
  const ch = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return '<span class="letter" aria-hidden="true">' + ch.replace(/[<&"]/g, "") + "</span>";
}
