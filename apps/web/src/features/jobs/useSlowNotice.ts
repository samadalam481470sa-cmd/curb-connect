'use client';

import { useEffect, useState } from 'react';

/**
 * True once `waiting` has stayed true for `afterMs`. Free hosting plans put the API to sleep, and
 * the first request after a sleep can take up to a minute; this lets a page say so instead of
 * showing a loader that looks stuck.
 */
export function useSlowNotice(waiting: boolean, afterMs = 6000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setSlow(true), afterMs);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [waiting, afterMs]);
  return waiting && slow;
}

export const WAKING_MESSAGE =
  'Waking up the server. The first visit after a quiet period can take up to a minute.';
