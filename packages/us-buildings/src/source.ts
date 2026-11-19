// Data-source descriptor. The download location is configuration, not code: it must be set by the
// owner after confirming the current URL and licence for the chosen dataset. Nothing is fetched by
// default, and no data is presented as current until a refresh succeeds.
export interface FootprintSource {
  id: string;
  /** SPDX-style licence identifier from the dataset's own terms. */
  licence: string;
  attribution: string;
  /** Template with {abbr} for the USPS state code, e.g. https://example.org/{abbr}.geojson */
  urlTemplate: string;
}

export function stateUrl(source: FootprintSource, abbr: string): string {
  if (!source.urlTemplate.includes('{abbr}')) throw new RangeError('urlTemplate must contain {abbr}.');
  if (!/^[A-Z]{2}$/.test(abbr)) throw new RangeError('State must be a two-letter USPS code.');
  const url = new URL(source.urlTemplate.replace('{abbr}', abbr));
  if (url.protocol !== 'https:') throw new RangeError('Footprint sources must use https.');
  return url.toString();
}
