// Product analytics hook point (STR-003: KPIs derive from auditable events). No vendor is wired
// yet, so events are dispatched as a DOM CustomEvent that a future adapter can forward. Payloads
// carry route ids only: never names, addresses, prices or other tenant content.
export interface AnalyticsEventDetail {
  name: string;
  properties: Record<string, string | number | boolean>;
  at: string;
}

export const ANALYTICS_EVENT = 'fieldline:analytics';

export function trackView(
  name: string,
  properties: Record<string, string | number | boolean> = {},
) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<AnalyticsEventDetail>(ANALYTICS_EVENT, {
      detail: { name, properties, at: new Date().toISOString() },
    }),
  );
}
