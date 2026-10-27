import { dataUrlToBlob, putDocumentBlob } from "./documentStore";
import { sampleProjects } from "./sampleData";
import type { Project } from "./types";

const STORAGE_KEY = "curb-connect-projects-v3";

/** Inline data URLs above this size are moved into IndexedDB. */
const INLINE_DOCUMENT_LIMIT = 4096;

export function loadProjects(): Project[] {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as Project[]) : sampleProjects;
  } catch {
    return sampleProjects;
  }
}

let lastSaveFailed = false;
const saveStatusListeners = new Set<() => void>();

/** True when the most recent save was refused (storage full or blocked). For useSyncExternalStore. */
export function getLastSaveFailed(): boolean {
  return lastSaveFailed;
}

export function subscribeSaveStatus(listener: () => void): () => void {
  saveStatusListeners.add(listener);
  return () => saveStatusListeners.delete(listener);
}

/** Returns false when the browser refuses the write (storage full or blocked). */
export function saveProjects(projects: Project[]): boolean {
  let failed: boolean;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    failed = false;
  } catch {
    failed = true;
  }

  if (failed !== lastSaveFailed) {
    lastSaveFailed = failed;
    saveStatusListeners.forEach((listener) => listener());
  }
  return !failed;
}

export function resetProjects(): Project[] {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be blocked; the demo data still loads in memory.
  }
  return sampleProjects;
}

/**
 * Moves large inline files saved by older versions into IndexedDB.
 * Returns the updated projects, or null when nothing needed moving.
 */
export async function migrateInlineDocuments(projects: Project[]): Promise<Project[] | null> {
  let changed = false;

  const migrated = await Promise.all(
    projects.map(async (project) => {
      const documents = await Promise.all(
        (project.documents ?? []).map(async (document) => {
          if (document.storageKey || !document.dataUrl || document.dataUrl.length <= INLINE_DOCUMENT_LIMIT) {
            return document;
          }
          try {
            await putDocumentBlob(document.id, await dataUrlToBlob(document.dataUrl));
            changed = true;
            const stored = { ...document, storageKey: document.id };
            delete stored.dataUrl;
            return stored;
          } catch {
            return document;
          }
        })
      );
      return { ...project, documents };
    })
  );

  return changed ? migrated : null;
}
