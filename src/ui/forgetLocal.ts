/**
 * Wipe what this browser remembers about the person who just left.
 *
 * Signing out on a shared computer has to leave it the way a stranger would
 * find it. Before this, the next visitor inherited the previous one's team
 * name (and got "that name belongs to another competitor" for their trouble),
 * never saw the first-run guide, and - worst - had the previous person's models
 * in the local mirror, which the synced store then helpfully uploaded into the
 * newcomer's account.
 *
 * Kept: the theme, which is a preference of the screen rather than of the
 * person. Everything else under the app's prefix goes.
 */
const KEEP = new Set(['rl-arena-theme']);

/** Every IndexedDB database the app opens. */
const DATABASES = ['rl-arena', 'rl-arena-champ'];

export async function forgetThisBrowser(): Promise<void> {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('rl-arena') && !KEEP.has(key)) doomed.push(key);
    }
    doomed.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage blocked: then there was nothing stored to leak either.
  }
  try {
    sessionStorage.clear();
  } catch {
    // Same.
  }
  await Promise.all(DATABASES.map(emptyDatabase));
}

/**
 * Empty every store of a database, through a connection of its own.
 *
 * Not `deleteDatabase`: the page still holds connections to these, and a
 * delete waits behind them until they close - which, with a reload right
 * after, may be never. Clearing the stores works alongside the open
 * connections and is done the moment the transaction commits.
 */
function emptyDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(name);
    } catch {
      resolve();
      return;
    }
    // Opening a database that does not exist creates it, empty and without its
    // stores - and the app's own upgrade would then never run. Abort instead.
    req.onupgradeneeded = () => req.transaction?.abort();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
    req.onsuccess = () => {
      const db = req.result;
      const stores = Array.from(db.objectStoreNames);
      if (stores.length === 0) {
        db.close();
        resolve();
        return;
      }
      const tx = db.transaction(stores, 'readwrite');
      stores.forEach((s) => tx.objectStore(s).clear());
      const done = () => {
        db.close();
        resolve();
      };
      tx.oncomplete = done;
      tx.onerror = done;
      tx.onabort = done;
    };
  });
}
