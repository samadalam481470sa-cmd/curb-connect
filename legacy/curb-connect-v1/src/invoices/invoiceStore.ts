import type { Invoice } from "./invoiceMath";

const INVOICES_KEY = "curb-connect-invoices-v1";
const COMPANY_KEY = "curb-connect-company-v1";

/** Business details printed in the invoice header. */
export interface CompanyProfile {
  name: string;
  address: string;
  phone: string;
  email: string;
  paymentInstructions: string;
}

export const emptyCompanyProfile: CompanyProfile = {
  name: "",
  address: "",
  phone: "",
  email: "",
  paymentInstructions: "Make checks payable to the company above. Net 30."
};

function read<T>(key: string, fallback: T): T {
  try {
    const saved = window.localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadInvoices(): Invoice[] {
  return read<Invoice[]>(INVOICES_KEY, []);
}

export function saveInvoices(invoices: Invoice[]): boolean {
  return write(INVOICES_KEY, invoices);
}

export function loadCompanyProfile(): CompanyProfile {
  return { ...emptyCompanyProfile, ...read<Partial<CompanyProfile>>(COMPANY_KEY, {}) };
}

export function saveCompanyProfile(profile: CompanyProfile): boolean {
  return write(COMPANY_KEY, profile);
}
