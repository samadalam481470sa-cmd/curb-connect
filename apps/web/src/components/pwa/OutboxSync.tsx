'use client';

import { Button } from '@fieldline/ui';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { apiSender, getOutbox, type OutboxEntry } from '../../lib/offline/outbox';
import { useOnlineStatus } from '../../lib/offline/online';
import { useApi, useSession } from '../../lib/session';

/**
 * Sends queued offline writes for the active workspace when the device comes back online, and
 * shows what is still waiting or failed. Entries from another workspace stay queued untouched
 * until that workspace is active again (PLT-004 S, PLT-018 S).
 */
export function OutboxSync() {
  const { api } = useApi();
  const { me, orgId } = useSession();
  const online = useOnlineStatus();
  const outbox = getOutbox();
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const version = useSyncExternalStore(
    useCallback((cb: () => void) => outbox.subscribe(cb), [outbox]),
    () => outbox.version,
    () => 0,
  );
  const userId = me.user.id;

  const flush = useCallback(async () => {
    await outbox.flush({ userId, orgId }, apiSender(api));
  }, [api, outbox, userId, orgId]);

  useEffect(() => {
    let cancelled = false;
    void outbox.list({ userId, orgId }).then((list) => {
      if (!cancelled) setEntries(list);
    });
    return () => {
      cancelled = true;
    };
  }, [outbox, userId, orgId, version]);

  useEffect(() => {
    if (online) void flush();
  }, [online, flush]);

  if (entries.length === 0) return null;
  const failed = entries.filter((e) => e.status === 'failed');
  const waiting = entries.length - failed.length;
  return (
    <div className="web-outbox" role="status">
      {waiting > 0 && (
        <p>
          {waiting === 1 ? '1 change is' : `${waiting} changes are`} saved on this device and will
          be sent {online ? 'shortly' : 'when you reconnect'}.
        </p>
      )}
      {failed.length > 0 && (
        <div>
          <p>
            {failed.length === 1 ? '1 change' : `${failed.length} changes`} could not be sent and
            need your attention:
          </p>
          <ul>
            {failed.map((e) => (
              <li key={e.id}>
                {e.label}
                {e.lastError ? ` (${e.lastError.message})` : ''}{' '}
                <Button size="sm" variant="secondary" onClick={() => void outbox.requeue(e.id)}>
                  Retry
                </Button>{' '}
                <Button size="sm" variant="ghost" onClick={() => void outbox.remove(e.id)}>
                  Discard
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
