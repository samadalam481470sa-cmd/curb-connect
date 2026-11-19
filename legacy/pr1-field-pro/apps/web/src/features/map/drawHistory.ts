/** Simple undo/redo stack for map draft state. */
export function createHistory<T>(initial: T, limit = 50) {
  let past: T[] = [];
  let present = initial;
  let future: T[] = [];

  return {
    get current() {
      return present;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    push(next: T) {
      past = [...past.slice(-(limit - 1)), present];
      present = next;
      future = [];
      return present;
    },
    replace(next: T) {
      present = next;
      return present;
    },
    undo() {
      if (past.length === 0) return present;
      const prev = past[past.length - 1]!;
      future = [present, ...future];
      past = past.slice(0, -1);
      present = prev;
      return present;
    },
    redo() {
      if (future.length === 0) return present;
      const next = future[0]!;
      past = [...past, present];
      future = future.slice(1);
      present = next;
      return present;
    },
    reset(next: T) {
      past = [];
      future = [];
      present = next;
      return present;
    },
  };
}

export type HistoryController<T> = ReturnType<typeof createHistory<T>>;
