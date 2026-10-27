// String-only decimal helpers for form inputs. Rates never pass through a JS float (docs/adr/0005):
// a percent typed by a person becomes the fraction string the API stores (0.0825 = 8.25%).

const PERCENT = /^(\d{1,2})(?:[.,](\d{1,4}))?$/;

/** "8.25" -> "0.0825"; "0" -> "0"; returns null for anything outside 0..99.9999 with <= 4 dp. */
export function percentToFraction(text: string): string | null {
  const match = PERCENT.exec(text.trim());
  if (!match) return null;
  const whole = match[1] ?? '0';
  const frac = match[2] ?? '';
  // Shift the decimal point two places left: digits = whole + frac, scale = frac.length + 2.
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, '');
  const scale = frac.length + 2;
  const padded = digits.padStart(scale + 1, '0');
  const intPart = padded.slice(0, padded.length - scale).replace(/^0+(?=\d)/, '');
  const fracPart = padded.slice(padded.length - scale).replace(/0+$/, '');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

/** "0.0825" -> "8.25" (display only). */
export function fractionToPercent(fraction: string): string | null {
  const match = /^0(?:\.(\d{1,6}))?$/.exec(fraction.trim());
  if (!match) return null;
  const frac = (match[1] ?? '').padEnd(2, '0');
  const whole = frac.slice(0, 2).replace(/^0(?=\d)/, '');
  const rest = frac.slice(2).replace(/0+$/, '');
  return rest ? `${whole}.${rest}` : whole;
}
