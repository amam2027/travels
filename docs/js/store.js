// Tiny IndexedDB key-value store. Each put is its own transaction, so a write either
// lands completely or not at all, even if the app is killed halfway.

const DB = "travels", STORE = "kv";
let dbp = null, opened = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => { opened = r.result; resolve(r.result); };
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}

export async function get(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction(STORE, "readonly").objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// Once the database is open, the write starts synchronously and is committed right away,
// which keeps the window in which closing the app could drop it as small as possible.
export function set(key, value) {
  if (!opened) return db().then(d => { opened = d; return set(key, value); });
  return new Promise((resolve, reject) => {
    const tx = opened.transaction(STORE, "readwrite", { durability: "strict" });
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
    if (tx.commit) tx.commit();
  });
}

// Asks the browser not to evict our data under storage pressure.
export async function persist() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; }
  catch (e) { return false; }
}
