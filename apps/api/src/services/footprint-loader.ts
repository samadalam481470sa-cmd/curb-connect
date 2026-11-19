// Downloads one state's building footprints for summary, through the licence and launch-region gates
// in @fieldline/us-buildings. Nothing is stored here: the footprint table is not designed yet, and
// the map does not read this data. Refuses to run for any source whose licence is not verified.
import {
  assertSourceAllowed,
  parseFootprints,
  requireLaunchState,
  SOURCE_LICENCES,
  stateUrl,
  summarizeState,
  findUsState,
  type FootprintSource,
  type StateSummary,
} from '@fieldline/us-buildings';

export const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

export class IngestRefused extends Error {}

export interface IngestInput {
  sourceId: string;
  urlTemplate: string | null;
  abbr: string;
  fetchImpl?: typeof fetch;
}

export async function summarizeStateFootprints(input: IngestInput): Promise<StateSummary> {
  const licence = SOURCE_LICENCES.find((s) => s.id === input.sourceId);
  if (!licence) throw new IngestRefused(`Unknown data source "${input.sourceId}".`);
  // Storing derived data needs a permissive licence (see licenses.ts). Summaries are derived too.
  assertSourceAllowed(input.sourceId, 'store');
  if (!licence.verifiedOn) {
    throw new IngestRefused(`${licence.name}: terms have not been verified by a person yet.`);
  }
  if (!input.urlTemplate) throw new IngestRefused('No download location is configured for this source.');
  const state = findUsState(input.abbr);
  if (!state) throw new IngestRefused('Unknown state.');
  requireLaunchState(state.abbr);

  const source: FootprintSource = {
    id: licence.id,
    licence: licence.licence,
    attribution: licence.name,
    urlTemplate: input.urlTemplate,
  };
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(stateUrl(source, state.abbr), {
    redirect: 'error',
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!response.ok) throw new IngestRefused(`Download failed (HTTP ${response.status}).`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new IngestRefused('Download is larger than the allowed size.');
  const text = await response.text();
  if (text.length > MAX_DOWNLOAD_BYTES) throw new IngestRefused('Download is larger than the allowed size.');
  return summarizeState(state, parseFootprints(JSON.parse(text) as unknown));
}
