import type { PaymentStatus, Project, ProjectStats } from "./types";

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(amount);
}

export function getOpenBalance(project: Pick<Project, "contractAmount" | "paidAmount">): number {
  return Math.max(project.contractAmount - project.paidAmount, 0);
}

export function inferPaymentStatus(
  contractAmount: number,
  paidAmount: number,
  dueDate?: string,
  today = new Date()
): PaymentStatus {
  if (contractAmount <= 0) {
    return paidAmount > 0 ? "paid" : "unpaid";
  }

  if (paidAmount >= contractAmount) {
    return "paid";
  }

  const balanceDue = contractAmount - paidAmount;
  const dueTimestamp = dueDate ? new Date(`${dueDate}T23:59:59`).getTime() : Number.NaN;

  if (balanceDue > 0 && Number.isFinite(dueTimestamp) && dueTimestamp < today.getTime()) {
    return "overdue";
  }

  return paidAmount > 0 ? "partial" : "unpaid";
}

/** Payment status as of `today`, so a job that passes its due date shows overdue without a new payment. */
export function currentPaymentStatus(
  project: Pick<Project, "contractAmount" | "paidAmount" | "dueDate">,
  today = new Date()
): PaymentStatus {
  return inferPaymentStatus(project.contractAmount, project.paidAmount, project.dueDate, today);
}

/** Rounds a dollar amount to whole cents. */
export function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Adds dollar amounts in whole cents so repeated payments never drift (0.1 + 0.2 === 0.3). */
export function addMoney(a: number, b: number): number {
  return (Math.round(a * 100) + Math.round(b * 100)) / 100;
}

/** YYYY-MM-DD in the user's local time zone. `toISOString()` uses UTC and is a day ahead on US evenings. */
export function localIsoDate(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export type PaymentValidation = { ok: true; amount: number } | { ok: false; error: string };

export function validatePayment(
  rawAmount: string,
  project: Pick<Project, "contractAmount" | "paidAmount">
): PaymentValidation {
  const amount = roundToCents(Number.parseFloat(rawAmount));

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter a payment amount greater than $0." };
  }

  const balance = getOpenBalance(project);
  if (project.contractAmount > 0 && amount > balance + 0.004) {
    return {
      ok: false,
      error: `Payment is more than the ${formatCurrency(balance)} open balance. Update the contract amount first if this covers extra work.`
    };
  }

  return { ok: true, amount };
}

export function getProjectStats(projects: Project[]): ProjectStats {
  return projects.reduce<ProjectStats>(
    (stats, project) => ({
      totalProjects: stats.totalProjects + 1,
      notStarted: stats.notStarted + (project.status === "not-started" ? 1 : 0),
      started: stats.started + (project.status === "started" ? 1 : 0),
      finished: stats.finished + (project.status === "finished" ? 1 : 0),
      complete: stats.complete + (project.status === "complete" ? 1 : 0),
      contractTotal: stats.contractTotal + project.contractAmount,
      paidTotal: stats.paidTotal + project.paidAmount,
      openBalance: stats.openBalance + getOpenBalance(project)
    }),
    {
      totalProjects: 0,
      notStarted: 0,
      started: 0,
      finished: 0,
      complete: 0,
      contractTotal: 0,
      paidTotal: 0,
      openBalance: 0
    }
  );
}

export function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
