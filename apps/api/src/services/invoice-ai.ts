// Gated AI reading for scanned invoices (Phase B item 10): scanned PDFs and photos are read by
// the always-on home AI server (HOME_AI_BASE_URL) when it is connected, with the open model
// (OPEN_MODEL_*) as backup. When neither is configured nothing is sent anywhere and the caller
// keeps the manual-entry path — no fake reading, no hardcoded URLs or keys.
import {
  askOpenModelWithFallback,
  type FetchLike,
  type OpenModelInput,
  type OpenModelSettings,
} from './open-model';

export type InvoiceAiSource = 'home' | 'open';

export interface InvoiceAiConfig {
  homeAi: OpenModelSettings | null;
  openModel: OpenModelSettings | null;
}

export interface InvoiceAiAnswer {
  reply: string;
  model: string;
  source: InvoiceAiSource;
}

/** Which AI servers are connected, for honest status reporting. Never includes URLs or keys. */
export function invoiceAiStatus(config: InvoiceAiConfig): {
  homeAiServer: 'configured' | 'not_configured';
  backupModel: 'configured' | 'not_configured';
  aiReading: boolean;
} {
  return {
    homeAiServer: config.homeAi ? 'configured' : 'not_configured',
    backupModel: config.openModel ? 'configured' : 'not_configured',
    aiReading: config.homeAi !== null || config.openModel !== null,
  };
}

/**
 * Reads one scanned invoice with the home AI server first, then the open model. Returns null
 * when no AI server is configured or every configured server fails, so the caller can fall back
 * to text extraction / manual entry exactly as before.
 */
export async function readScannedInvoice(
  config: InvoiceAiConfig,
  input: OpenModelInput,
  fetchImpl: FetchLike = fetch,
  onFailure?: (source: InvoiceAiSource, error: Error) => void,
): Promise<InvoiceAiAnswer | null> {
  const candidates: { source: InvoiceAiSource; settings: OpenModelSettings }[] = [];
  if (config.homeAi) candidates.push({ source: 'home', settings: config.homeAi });
  if (config.openModel) candidates.push({ source: 'open', settings: config.openModel });
  for (const { source, settings } of candidates) {
    try {
      const answer = await askOpenModelWithFallback(settings, input, fetchImpl);
      return { ...answer, source };
    } catch (error) {
      onFailure?.(source, error as Error);
    }
  }
  return null;
}
