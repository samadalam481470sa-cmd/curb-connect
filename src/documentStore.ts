/**
 * Uploaded job files (plans, photos, lien waivers) live in IndexedDB as Blobs.
 * localStorage only holds ~5 MB of strings, so storing files there as data URLs
 * made saves fail silently after a couple of photos.
 */

const DB_NAME = "curb-connect-files";
const STORE_NAME = "documents";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser does not support file storage."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("Could not open file storage.")));
  });

  // Let a later call retry if opening failed (e.g. private browsing).
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

function runRequest<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = action(transaction.objectStore(STORE_NAME));
        transaction.addEventListener("complete", () => resolve(request.result));
        transaction.addEventListener("error", () => reject(transaction.error ?? request.error));
        transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("File storage was aborted.")));
      })
  );
}

export function putDocumentBlob(key: string, blob: Blob): Promise<void> {
  return runRequest("readwrite", (store) => store.put(blob, key)).then(() => undefined);
}

export function getDocumentBlob(key: string): Promise<Blob | undefined> {
  return runRequest<Blob | undefined>("readonly", (store) => store.get(key) as IDBRequest<Blob | undefined>);
}

export function deleteDocumentBlob(key: string): Promise<void> {
  return runRequest("readwrite", (store) => store.delete(key)).then(() => undefined);
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

/** Opens a stored file in a new tab, or downloads it when `downloadName` is given. */
export async function openStoredDocument(key: string, downloadName?: string): Promise<void> {
  const blob = await getDocumentBlob(key);
  if (!blob) {
    throw new Error("This file is no longer stored on this device.");
  }

  const url = URL.createObjectURL(blob);
  try {
    if (downloadName) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = downloadName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } else {
      window.open(url, "_blank", "noopener");
    }
  } finally {
    // Give the new tab or download time to read the URL before revoking it.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
