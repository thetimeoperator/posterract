/**
 * Minimal IndexedDB blob store — uploaded videos survive reloads.
 * One object store: "artifacts" (key = artifact id, value = Blob).
 */

const DB_NAME = "posterract";
const DB_VERSION = 1;
const STORE = "artifacts";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const blobStore = {
  put: (id: string, blob: Blob) => tx("readwrite", (s) => s.put(blob, id)),
  get: (id: string) => tx<Blob | undefined>("readonly", (s) => s.get(id)),
  delete: (id: string) => tx("readwrite", (s) => s.delete(id)),
  keys: () => tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys()),
};
