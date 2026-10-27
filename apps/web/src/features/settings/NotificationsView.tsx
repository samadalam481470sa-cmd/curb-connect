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
import { useState } from 'react';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { isApiError } from '../../lib/api';
import type { NotificationPreference } from '../../lib/endpoints';
import { orgKey, useApi, useSession } from '../../lib/session';

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  roof_report_review: 'Roof reports need review',
  curb_photos_unusable: 'Curb photos are unusable',
  estimate_approved: 'Estimates approved',
  proposal_viewed: 'Proposals viewed by customers',
  signature_received: 'Signatures received',
  payment_settled: 'Payments settled',
  invitation: 'Team invitations',
  dispatch: 'Dispatch and scheduling',
  permit_expiring: 'Permits expiring',
  system: 'Account and security notices',
};

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  in_app: 'In app',
  email: 'Email',
  sms: 'Text message',
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
