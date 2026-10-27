// AIQ-088 R: OpenTelemetry SDK bootstrap for the API and the worker. Only started when
// OTEL_EXPORTER_OTLP_ENDPOINT is set; otherwise the API's spans (src/http/telemetry.ts) stay no-ops
// and cost nothing. The exporter, protocol and headers come from the standard OTEL_* variables.
// No auto-instrumentation is loaded on purpose: spans are created by our own hooks, whose attributes
// are tenant-safe (route templates, never raw URLs that may carry signed capabilities).
import type { AppConfig } from './config';

export interface TelemetryHandle {
  enabled: boolean;
  shutdown(): Promise<void>;
}

export async function startTelemetry(config: AppConfig, component: 'api' | 'worker'): Promise<TelemetryHandle> {
  if (!config.telemetry.otlpEndpoint) return { enabled: false, shutdown: async () => undefined };
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const sdk = new NodeSDK({
    serviceName: component === 'api' ? config.telemetry.serviceName : `${config.telemetry.serviceName}-worker`,
  });
  sdk.start();
  return { enabled: true, shutdown: () => sdk.shutdown() };
}
