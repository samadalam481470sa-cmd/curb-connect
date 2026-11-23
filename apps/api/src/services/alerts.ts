// Error and uptime alerts (Phase F item 31).
//
// Every server error is already written to the structured log with its correlation id. This
// module adds the alert half: when ALERT_WEBHOOK_URL is set, a small JSON POST goes to that
// endpoint (one the operator controls — no third-party service is baked in). When it is not set,
// alerts are counted and reported as "not_configured" by the readiness probe; nothing is sent
// anywhere and nothing is faked.
//
// Safety rules: payloads carry only the route template, method, status, error name, correlation
// id and counts — never request bodies, headers, emails, tokens or tenant data. Repeat alerts for
// the same route+error are throttled so a crash loop cannot flood the receiver. Delivery is
// fire-and-forget with a short timeout; a failed webhook never fails a request.
import { API_VERSION } from '../version';

export interface AlertEvent {
  /** Stable kind, e.g. 'unhandled_error', 'response_schema_error', 'readiness_failed', 'process_error'. */
  kind: string;
  /** Route template (never a raw URL), or 'process' for process-level errors. */
  route: string;
  method?: string;
  status?: number;
  /** Error class/name only — never the message, which can carry data. */
  errorName?: string;
  correlationId?: string;
}

export interface AlertPayload extends AlertEvent {
  service: 'api';
  version: string;
  time: string;
  /** How many matching events were suppressed by throttling since the last sent alert. */
  suppressed: number;
}

export type AlertFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface AlertSinkOptions {
  webhookUrl: string | null;
  /** Minimum gap between sent alerts for the same kind+route+error. Default 5 minutes. */
  throttleMs?: number;
  fetchImpl?: AlertFetch;
  now?: () => number;
  onDeliveryFailure?: (error: unknown) => void;
}

const DEFAULT_THROTTLE_MS = 5 * 60 * 1000;
const DELIVERY_TIMEOUT_MS = 3000;

export class AlertSink {
  private readonly webhookUrl: string | null;
  private readonly throttleMs: number;
  private readonly fetchImpl: AlertFetch;
  private readonly now: () => number;
  private readonly onDeliveryFailure?: (error: unknown) => void;
  private readonly lastSent = new Map<string, number>();
  private readonly suppressed = new Map<string, number>();
  private totalRecorded = 0;
  private totalSent = 0;

  constructor(options: AlertSinkOptions) {
    this.webhookUrl = options.webhookUrl;
    this.throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.onDeliveryFailure = options.onDeliveryFailure;
  }

  /** 'configured' when a webhook will receive alerts; 'not_configured' = log-and-count only. */
  status(): 'configured' | 'not_configured' {
    return this.webhookUrl ? 'configured' : 'not_configured';
  }

  counts(): { recorded: number; sent: number } {
    return { recorded: this.totalRecorded, sent: this.totalSent };
  }

  /**
   * Records one alertable event. Returns true when a webhook POST was dispatched (not awaited by
   * callers on the request path), false when throttled or no webhook is configured.
   */
  record(event: AlertEvent): boolean {
    this.totalRecorded += 1;
    if (!this.webhookUrl) return false;
    const key = `${event.kind}|${event.route}|${event.errorName ?? ''}`;
    const now = this.now();
    const last = this.lastSent.get(key) ?? 0;
    if (now - last < this.throttleMs) {
      this.suppressed.set(key, (this.suppressed.get(key) ?? 0) + 1);
      return false;
    }
    const payload: AlertPayload = {
      ...event,
      service: 'api',
      version: API_VERSION,
      time: new Date(now).toISOString(),
      suppressed: this.suppressed.get(key) ?? 0,
    };
    this.lastSent.set(key, now);
    this.suppressed.set(key, 0);
    this.totalSent += 1;
    void this.deliver(payload).catch((error) => this.onDeliveryFailure?.(error));
    return true;
  }

  private async deliver(payload: AlertPayload): Promise<void> {
    if (!this.webhookUrl) return;
    const res = await this.fetchImpl(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`alert webhook answered ${res.status}`);
  }
}

/** Builds the process-wide sink from config. One per app instance (see app.ts decoration). */
export function createAlertSink(
  webhookUrl: string | null,
  onDeliveryFailure?: (error: unknown) => void,
): AlertSink {
  return new AlertSink({ webhookUrl, ...(onDeliveryFailure && { onDeliveryFailure }) });
}
