'use client';

// PLT-020 A: per-category, per-channel notification preferences. SMS needs recorded consent and
// every email/SMS carries an unsubscribe path (server-enforced); quiet hours are not in the API
// contract yet, so they are shown as not available instead of a control that does nothing.
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
} from '@fieldline/contracts';
import { Button, EmptyState, Skeleton, useToast } from '@fieldline/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint, isApiError } from '../../lib/api';
import { currentSubscription, pushSupport, subscribePush, unsubscribePush } from '../../lib/push';
import type { NotificationPreference } from '../../lib/endpoints';
import { orgKey, useApi, useSession } from '../../lib/session';

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  roof_report_review: 'Roof reports need review',
  curb_photos_unusable: 'Curb photos are unusable',
  estimate_approved: 'Estimates approved',
  proposal_viewed: 'Proposals viewed by customers',
  signature_received: 'Signatures received',
  payment_settled: 'Payments settled',
  invoice_received: 'Invoices received from other companies',
  invoice_approved: 'Your invoices approved by the payer',
  invoice_disputed: 'Your invoices disputed',
  invoice_paid: 'Your invoices paid',
  invitation: 'Team invitations',
  dispatch: 'Dispatch and scheduling',
  permit_expiring: 'Permits expiring',
  work_assigned: 'Work assigned by other companies',
  system: 'Account and security notices',
};

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  in_app: 'In app',
  email: 'Email',
  sms: 'Text message',
  push: 'Push',
};

/** Security notices cannot be switched off in-app (they are how a revoked session is explained). */
const LOCKED: ReadonlySet<string> = new Set(['system:in_app']);

type Matrix = Record<string, boolean>;

function toMatrix(prefs: readonly NotificationPreference[]): Matrix {
  const matrix: Matrix = {};
  for (const p of prefs) matrix[`${p.category}:${p.channel}`] = p.enabled;
  return matrix;
}

export function NotificationsView() {
  return (
    <RouteGate routeId="settings.notifications">
      <PageHeader
        title="Notification preferences"
        description="Choose how you hear about work that needs you. These are your personal settings in this company."
      />
      <Preferences />
      <PushDevices />
    </RouteGate>
  );
}

function Preferences() {
  const { endpoints } = useApi();
  const session = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = orgKey(session.orgId, 'notification-preferences');
  const prefs = useQuery({
    queryKey: key,
    queryFn: () => endpoints.notificationPreferences(),
    retry: false,
  });
  const [edits, setEdits] = useState<Matrix>({});
  const save = useMutation({
    mutationFn: (preferences: NotificationPreference[]) =>
      endpoints.updateNotificationPreferences(preferences),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      setEdits({});
      toast.show({ tone: 'success', message: 'Notification preferences saved.' });
    },
  });

  if (prefs.isPending) return <Skeleton label="Loading preferences" />;
  if (prefs.error) {
    if (isApiError(prefs.error) && prefs.error.is('not_found')) {
      return (
        <EmptyState
          title="Notification preferences are not available yet"
          description="The notification service has not been enabled for this environment. Nothing is sent until it is."
        />
      );
    }
    return (
      <ErrorNotice
        error={prefs.error}
        title="Preferences could not be loaded"
        onRetry={() => void prefs.refetch()}
      />
    );
  }

  const base = toMatrix(prefs.data.preferences);
  const value = (cell: string) => edits[cell] ?? base[cell] ?? false;
  const dirty = Object.keys(edits).some((cell) => edits[cell] !== (base[cell] ?? false));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const preferences: NotificationPreference[] = NOTIFICATION_CATEGORIES.flatMap((category) =>
          NOTIFICATION_CHANNELS.map((channel) => ({
            category,
            channel,
            enabled: value(`${category}:${channel}`),
          })),
        );
        save.mutate(preferences);
      }}
    >
      <div className="web-table-scroll">
        <table className="web-matrix">
          <caption className="fl-visually-hidden">
            Notification preferences by category and channel
          </caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              {NOTIFICATION_CHANNELS.map((c) => (
                <th scope="col" key={c}>
                  {CHANNEL_LABELS[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_CATEGORIES.map((category) => (
              <tr key={category}>
                <th scope="row">{CATEGORY_LABELS[category]}</th>
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const cell = `${category}:${channel}`;
                  const locked = LOCKED.has(cell);
                  return (
                    <td key={channel}>
                      <input
                        type="checkbox"
                        className="web-checkbox"
                        aria-label={`${CATEGORY_LABELS[category]} by ${CHANNEL_LABELS[channel]}`}
                        checked={locked ? true : value(cell)}
                        disabled={locked}
                        onChange={(e) => setEdits((p) => ({ ...p, [cell]: e.target.checked }))}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="web-muted web-small">
        <li>
          Text messages are sent only to a mobile number with recorded consent; reply STOP to opt
          out at any time.
        </li>
        <li>
          Every email includes an unsubscribe link. Job photos are never attached to text messages.
        </li>
        <li>Account and security notices always appear in the app.</li>
        <li>Quiet hours are coming in a later slice.</li>
      </ul>
      {save.error && <ErrorNotice error={save.error} title="Preferences were not saved" />}
      <Button type="submit" loading={save.isPending} disabled={!dirty}>
        Save preferences
      </Button>
    </form>
  );
}

const PushStatus = z.object({
  web: z.object({
    connected: z.boolean(),
    vapidPublicKey: z.string().nullable(),
    deviceCount: z.number(),
  }),
  ios: z.object({ connected: z.boolean(), reason: z.string().nullable(), deviceCount: z.number() }),
  android: z.object({
    connected: z.boolean(),
    reason: z.string().nullable(),
    deviceCount: z.number(),
  }),
});
const Device = z.object({
  id: z.string(),
  platform: z.string(),
  endpoint: z.string(),
  userAgent: z.string().nullable(),
  lastSeenAt: z.string(),
  revokedAt: z.string().nullable(),
});
const DeviceList = z.object({ items: z.array(Device) });

/**
 * Push devices: turn on Web Push for this browser, see registered devices, revoke them.
 * Native iOS/Android delivery is shown with its honest not-connected reason.
 */
function PushDevices() {
  const { api } = useApi();
  const session = useSession();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: orgKey(session.orgId, 'push-status'),
    queryFn: () => api.get('/v1/devices/push-status', { schema: PushStatus }),
    retry: false,
  });
  const devices = useQuery({
    queryKey: orgKey(session.orgId, 'devices'),
    queryFn: () => api.get('/v1/devices', { schema: DeviceList }),
    retry: false,
  });
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void currentSubscription().then((sub) => setThisEndpoint(sub?.endpoint ?? null));
  }, []);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'devices') });
    void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'push-status') });
    void currentSubscription().then((sub) => setThisEndpoint(sub?.endpoint ?? null));
  };

  const enable = useMutation({
    mutationFn: async () => {
      const key = status.data?.web.vapidPublicKey;
      if (!key) throw new Error('Push is not configured on the server yet.');
      return subscribePush(api, key);
    },
    onSuccess: refresh,
    onError: (e) => setError(errorHint(e)),
  });
  const disable = useMutation({
    mutationFn: (deviceId: string) => unsubscribePush(api, deviceId),
    onSuccess: refresh,
    onError: (e) => setError(errorHint(e)),
  });

  if (status.isPending) return <Skeleton label="Loading push settings" />;
  if (status.error) return null; // preferences above already report service availability

  const support = pushSupport(status.data.web.vapidPublicKey);
  const active = (devices.data?.items ?? []).filter((d) => !d.revokedAt);
  const thisDevice = active.find((d) => d.endpoint === thisEndpoint);

  return (
    <section aria-label="Push notifications" style={{ marginTop: 32 }}>
      <h2>Push notifications</h2>
      {!status.data.web.connected ? (
        <p className="web-muted">
          Web Push is not connected yet — the server needs its VAPID keys set in Render before
          this browser can subscribe. Nothing is sent until then.
        </p>
      ) : support === 'no_push_manager' ? (
        <p className="web-muted">
          This browser cannot receive push. On iPhone, add Field Pro to the Home Screen first,
          then open it from there.
        </p>
      ) : support === 'permission_denied' ? (
        <p className="web-muted">
          Notifications are blocked for this site in your browser settings. Allow them there,
          then come back.
        </p>
      ) : thisDevice ? (
        <p>
          Push is on for this browser.{' '}
          <Button type="button" onClick={() => disable.mutate(thisDevice.id)} loading={disable.isPending}>
            Turn off on this browser
          </Button>
        </p>
      ) : (
        <p>
          <Button type="button" onClick={() => enable.mutate()} loading={enable.isPending}>
            Turn on push for this browser
          </Button>
        </p>
      )}
      {active.length > 0 ? (
        <ul className="web-muted web-small">
          {active.map((d) => (
            <li key={d.id}>
              {d.platform} — last seen {new Date(d.lastSeenAt).toLocaleString('en-US')}
              {d.endpoint === thisEndpoint ? ' (this browser)' : ''}
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="web-muted web-small">
        <li>iPhone/iPad app: {status.data.ios.reason}</li>
        <li>Android app: {status.data.android.reason}</li>
      </ul>
      {error ? (
        <p className="web-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
