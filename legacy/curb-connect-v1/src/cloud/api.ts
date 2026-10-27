/**
 * Client for the Curb Connect API (server/). Enabled when VITE_API_URL is set; otherwise the app
 * runs as a single-browser demo. The server works in cents; the app's Project type uses dollars.
 */

import type { Invoice, InvoiceLineItem } from "../invoices/invoiceMath";
import type { Project, ProjectStatus } from "../types";

export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");
export const cloudEnabled = API_URL.length > 0;

const TOKEN_KEY = "curb-connect-token";

export interface CloudCompany {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  paymentInstructions: string;
}

export interface CloudUser {
  id: string;
  name: string;
  email: string;
  role: string;
  company: CloudCompany;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Storage blocked: the session lasts until the tab closes.
  }
}

const unauthorizedListeners = new Set<() => void>();

/** Called when the server rejects the saved token, so the app can return to the sign-in screen. */
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") {
      return detail;
    }
    // FastAPI validation errors: [{loc: [...], msg: "..."}]
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { loc?: unknown[]; msg?: string };
      const field = Array.isArray(first.loc) ? first.loc[first.loc.length - 1] : "";
      return `${field ? `${String(field)}: ` : ""}${first.msg ?? "Invalid input."}`;
    }
  }
  return status >= 500 ? "The server had a problem. Try again in a moment." : `Request failed (${status}).`;
}

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, method, headers, body: payload });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }

  if (response.status === 401 && token) {
    setToken(null);
    unauthorizedListeners.forEach((listener) => listener());
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const data: unknown = isJson ? await response.json() : undefined;
  if (!response.ok) {
    throw new ApiError(errorMessage(data, response.status), response.status);
  }
  return data as T;
}

// ---- Mapping between server records (cents) and app records (dollars) ----

export interface ApiProject extends Omit<Project, "contractAmount" | "paidAmount"> {
  contractCents: number;
  paidCents: number;
}

export function fromApiProject(project: ApiProject): Project {
  const { contractCents, paidCents, ...rest } = project;
  return { ...rest, contractAmount: contractCents / 100, paidAmount: paidCents / 100 };
}

function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export interface NewProjectInput {
  name: string;
  contractor: string;
  subcontractor: string;
  location: string;
  service: Project["service"];
  status: ProjectStatus;
  priority: Project["priority"];
  startDate: string;
  dueDate: string;
  contractAmount: number;
  notes: string;
  siteContact: string;
  crewSize: number;
  quantity: string;
  invoiceNumber: string;
}

interface AuthResponse {
  token: string;
  user: CloudUser;
}

export interface SyncResponse {
  serverTime: string;
  projects: ApiProject[];
  projectIds: string[];
  invoices: Invoice[];
  invoiceIds: string[];
}

export type InvoiceChanges = Partial<
  Pick<Invoice, "number" | "issueDate" | "dueDate" | "taxRatePercent" | "retainagePercent" | "notes">
> & { lineItems?: Omit<InvoiceLineItem, "id">[] };

export const api = {
  async register(input: { companyName: string; name: string; email: string; password: string }) {
    const result = await request<AuthResponse>("POST", "/api/auth/register", input);
    setToken(result.token);
    return result.user;
  },
  async login(email: string, password: string) {
    const result = await request<AuthResponse>("POST", "/api/auth/login", { email, password });
    setToken(result.token);
    return result.user;
  },
  me: () => request<CloudUser>("GET", "/api/auth/me"),
  updateCompany: (company: Omit<CloudCompany, "id">) => request<CloudCompany>("PUT", "/api/company", company),

  sync: (since?: string) =>
    request<SyncResponse>("GET", `/api/sync${since ? `?since=${encodeURIComponent(since)}` : ""}`),

  async createProject(input: NewProjectInput) {
    const { contractAmount, ...rest } = input;
    return fromApiProject(
      await request<ApiProject>("POST", "/api/projects", { ...rest, contractCents: toCents(contractAmount) })
    );
  },
  async updateProject(id: string, changes: { status?: ProjectStatus; contractAmount?: number; invoiceNumber?: string }) {
    const { contractAmount, ...rest } = changes;
    const body = contractAmount === undefined ? rest : { ...rest, contractCents: toCents(contractAmount) };
    return fromApiProject(await request<ApiProject>("PATCH", `/api/projects/${id}`, body));
  },
  async addTask(id: string, title: string) {
    return fromApiProject(await request<ApiProject>("POST", `/api/projects/${id}/tasks`, { title }));
  },
  async setTaskComplete(id: string, taskId: string, complete: boolean) {
    return fromApiProject(await request<ApiProject>("PATCH", `/api/projects/${id}/tasks/${taskId}`, { complete }));
  },
  async addMessage(id: string, body: string) {
    return fromApiProject(await request<ApiProject>("POST", `/api/projects/${id}/messages`, { body }));
  },
  async addPayment(id: string, amountDollars: number, note = "") {
    return fromApiProject(
      await request<ApiProject>("POST", `/api/projects/${id}/payments`, { amountCents: toCents(amountDollars), note })
    );
  },
  async uploadDocuments(id: string, files: File[]) {
    const form = new FormData();
    files.forEach((file) => form.append("files", file, file.name));
    return fromApiProject(await request<ApiProject>("POST", `/api/projects/${id}/documents`, form));
  },
  async removeDocument(id: string, documentId: string) {
    return fromApiProject(await request<ApiProject>("DELETE", `/api/projects/${id}/documents/${documentId}`));
  },
  /** Fetches a job file with the session token and opens or downloads it. */
  async openDocument(projectId: string, documentId: string, downloadName?: string) {
    const token = getToken();
    const response = await fetch(
      `${API_URL}/api/projects/${projectId}/documents/${documentId}${downloadName ? "?download=true" : ""}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    if (!response.ok) {
      throw new ApiError(response.status === 404 ? "This file is no longer available." : "Could not open this file.", response.status);
    }
    const url = URL.createObjectURL(await response.blob());
    if (downloadName) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = downloadName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } else {
      window.open(url, "_blank", "noopener");
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  createInvite: (id: string, email = "") =>
    request<{ token: string; link: string; expiresInDays: number }>("POST", `/api/projects/${id}/invites`, { email }),
  async acceptInvite(token: string) {
    return fromApiProject(await request<ApiProject>("POST", `/api/invites/${encodeURIComponent(token)}/accept`));
  },

  createInvoice: (projectId: string) => request<Invoice>("POST", "/api/invoices", { projectId }),
  updateInvoice: (id: string, changes: InvoiceChanges) => request<Invoice>("PATCH", `/api/invoices/${id}`, changes),
  deleteInvoice: (id: string) => request<void>("DELETE", `/api/invoices/${id}`),
  sendInvoice: (id: string) => request<Invoice>("POST", `/api/invoices/${id}/send`),
  payInvoice: (id: string) => request<{ invoice: Invoice; appliedCents: number }>("POST", `/api/invoices/${id}/pay`),
  voidInvoice: (id: string) => request<Invoice>("POST", `/api/invoices/${id}/void`)
};
