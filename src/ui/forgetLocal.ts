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
const KEEP = new Set(['rl-arena-theme', 'rl-arena-epoch']);

/** Every IndexedDB database the app opens. */
const DATABASES = ['rl-arena', 'rl-arena-champ'];

export async function forgetThisBrowser(alsoKeep: string[] = []): Promise<void> {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('rl-arena') && !KEEP.has(key) && !alsoKeep.includes(key)) doomed.push(key);
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
 * The data this browser holds belongs to an era of the database. When the
 * database is emptied for a fresh start, this number goes up, and every
 * browser forgets what it had the first time it loads the new build - once.
 *
 * Without it the empty database would not stay empty: the model library
 * uploads whatever its local mirror has that the cloud lacks, the team name
 * would come back from localStorage, and the championship cache would answer
 * for race ids that now mean different races.
 *
 *   2 - 25.10.2026, the public launch: everything before it was a test run.
 */
const EPOCH = '2';
const EPOCH_KEY = 'rl-arena-epoch';

/**
 * Run before anything reads local storage. Signing in survives it (Firebase
 * keeps its session in a database of its own), and so does the push switch:
 * the device's token is kept on the server across a fresh start.
 */
export async function startFreshIfNewEpoch(): Promise<void> {
  try {
    if (localStorage.getItem(EPOCH_KEY) === EPOCH) return;
  } catch {
    return; // Storage blocked: nothing was kept to forget.
  }
  await forgetThisBrowser(['rl-arena-push']);
  try {
    localStorage.setItem(EPOCH_KEY, EPOCH);
  } catch {
    // Then it runs again next load, on storage that is already empty.
  }
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
