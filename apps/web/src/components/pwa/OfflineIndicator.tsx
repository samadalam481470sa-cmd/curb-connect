'use client';

import { useEffect, useRef, useState } from 'react';
import { useOnlineStatus } from '../../lib/offline/online';
import { CloudOffIcon } from '../icons';

/**
 * Connectivity banner (PLT-018). Visible text while offline plus a polite announcement when the
 * connection changes. Offline means: drafts and queued changes stay on this device; nothing is
 * shown from cached API responses (the service worker never caches them).
 */
export function OfflineIndicator() {
  const online = useOnlineStatus();
  const [announcement, setAnnouncement] = useState('');
  const previous = useRef(online);

  useEffect(() => {
    if (previous.current === online) return;
    previous.current = online;
    const frame = requestAnimationFrame(() =>
      setAnnouncement(online ? 'Back online. Sending saved changes.' : 'You are offline.'),
    );
    return () => cancelAnimationFrame(frame);
  }, [online]);

  return (
    <>
      <div className="fl-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>
      {!online && (
        <div className="web-offline" data-testid="offline-indicator">
          <CloudOffIcon size={18} />
          <span>
            You are offline. Drafts and queued changes are kept on this device and sent when you
            reconnect.
          </span>
        </div>
      )}
    </>
  );
}
