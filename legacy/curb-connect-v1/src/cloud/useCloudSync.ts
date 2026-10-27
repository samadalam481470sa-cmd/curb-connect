import { useEffect, useRef, useState } from "react";
import type { Invoice } from "../invoices/invoiceMath";
import type { Project } from "../types";
import { api, fromApiProject } from "./api";

const POLL_INTERVAL_MS = 4000;

interface SyncOptions {
  enabled: boolean;
  setProjects: (update: (current: Project[]) => Project[]) => void;
  setInvoices: (update: (current: Invoice[]) => Invoice[]) => void;
  /** Invoices with unsaved local edits; the server copy is not merged over them. */
  isInvoiceDirty: (id: string) => boolean;
}

export type SyncState = "connecting" | "live" | "offline";

function merge<T extends { id: string }>(current: T[], changed: T[], keepIds: string[], skip?: (id: string) => boolean) {
  const keep = new Set(keepIds);
  const changedById = new Map(changed.map((item) => [item.id, item]));
  const merged = current
    .filter((item) => keep.has(item.id))
    .map((item) => (skip?.(item.id) ? item : changedById.get(item.id) ?? item));
  const known = new Set(merged.map((item) => item.id));
  const added = changed.filter((item) => !known.has(item.id));
  return [...added, ...merged];
}

/**
 * Keeps jobs and invoices current with the server by asking for changes every few seconds
 * while the tab is visible, and right away when the tab comes back into view.
 */
export function useCloudSync({ enabled, setProjects, setInvoices, isInvoiceDirty }: SyncOptions): SyncState {
  const [state, setState] = useState<SyncState>("connecting");
  const sinceRef = useRef<string | undefined>(undefined);
  const dirtyRef = useRef(isInvoiceDirty);
  useEffect(() => {
    dirtyRef.current = isInvoiceDirty;
  }, [isInvoiceDirty]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    let running = false;

    async function poll() {
      if (running || cancelled) {
        return;
      }
      running = true;
      try {
        const result = await api.sync(sinceRef.current);
        if (cancelled) {
          return;
        }
        sinceRef.current = result.serverTime;
        setProjects((current) => merge(current, result.projects.map(fromApiProject), result.projectIds));
        setInvoices((current) =>
          merge(current, result.invoices, result.invoiceIds, (id) => dirtyRef.current(id))
        );
        setState("live");
      } catch {
        if (!cancelled) {
          setState("offline");
        }
      } finally {
        running = false;
        if (!cancelled) {
          timer = window.setTimeout(poll, document.visibilityState === "visible" ? POLL_INTERVAL_MS : POLL_INTERVAL_MS * 5);
        }
      }
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        window.clearTimeout(timer);
        void poll();
      }
    }

    void poll();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleVisibility);
    };
  }, [enabled, setProjects, setInvoices]);

  return state;
}
