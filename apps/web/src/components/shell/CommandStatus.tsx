'use client';

import { useEffect, useState } from 'react';

/**
 * Top-bar telemetry strip: real connection state and local time only (no invented metrics).
 * Rendered after mount so the server HTML and first client render always match.
 */
export function CommandStatus({ orgName }: { orgName?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const first = window.setTimeout(() => {
      setNow(new Date());
      setOnline(navigator.onLine);
    }, 0);
    const tick = window.setInterval(() => setNow(new Date()), 30_000);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(tick);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (!now) return null;
  return (
    <span className="cc-status-strip" aria-label="System status">
      <span>
        <span className={online ? 'cc-dot' : 'cc-dot cc-dot--warn'} aria-hidden="true" />{' '}
        {online ? 'LINK ONLINE' : 'OFFLINE MODE'}
      </span>
      {orgName && <span>WS · {orgName.toUpperCase()}</span>}
      <span>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    </span>
  );
}
