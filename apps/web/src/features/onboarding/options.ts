export { BRAND, type MeasurementSystem, type ProductLine } from '@fieldline/contracts';

/** Currencies offered at setup. The API accepts any ISO 4217 code; this is a starting list. */
export const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD - US dollar' },
  { value: 'CAD', label: 'CAD - Canadian dollar' },
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'GBP', label: 'GBP - Pound sterling' },
  { value: 'AUD', label: 'AUD - Australian dollar' },
  { value: 'NZD', label: 'NZD - New Zealand dollar' },
  { value: 'MXN', label: 'MXN - Mexican peso' },
] as const;
