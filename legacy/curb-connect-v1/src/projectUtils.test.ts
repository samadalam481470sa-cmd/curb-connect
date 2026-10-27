import { describe, expect, it } from "vitest";
import {
  addMoney,
  currentPaymentStatus,
  getOpenBalance,
  getProjectStats,
  inferPaymentStatus,
  localIsoDate,
  validatePayment
} from "./projectUtils";
import type { Project } from "./types";

const baseProject: Project = {
  id: "project-test",
  name: "Test curb project",
  contractor: "Prime GC",
  subcontractor: "Curb Sub",
  location: "Lot 1",
  service: "Standard curb",
  status: "started",
  priority: "normal",
  startDate: "2026-06-01",
  dueDate: "2026-06-10",
  contractAmount: 1000,
  paidAmount: 250,
  paymentStatus: "partial",
  notes: "",
  siteContact: "Test contact",
  crewSize: 3,
  quantity: "100 LF",
  invoiceNumber: "INV-TEST",
  tasks: [],
  documents: [],
  messages: [],
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z"
};

describe("project utilities", () => {
  it("calculates balances without returning negative values", () => {
    expect(getOpenBalance({ contractAmount: 1000, paidAmount: 250 })).toBe(750);
    expect(getOpenBalance({ contractAmount: 1000, paidAmount: 1200 })).toBe(0);
  });

  it("infers payment status from amount and due date", () => {
    const today = new Date("2026-06-15T12:00:00.000Z");

    expect(inferPaymentStatus(1000, 1000, "2026-06-10", today)).toBe("paid");
    expect(inferPaymentStatus(1000, 250, "2026-06-20", today)).toBe("partial");
    expect(inferPaymentStatus(1000, 0, "2026-06-20", today)).toBe("unpaid");
    expect(inferPaymentStatus(1000, 0, "2026-06-10", today)).toBe("overdue");
  });

  it("re-derives overdue status from today's date instead of the saved value", () => {
    const savedAsPartial = { ...baseProject, paymentStatus: "partial" as const };
    expect(currentPaymentStatus(savedAsPartial, new Date("2026-06-05T12:00:00"))).toBe("partial");
    expect(currentPaymentStatus(savedAsPartial, new Date("2026-06-11T12:00:00"))).toBe("overdue");
  });

  it("adds money in whole cents", () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(addMoney(1999.99, 0.01)).toBe(2000);
  });

  it("uses the local calendar date, not UTC", () => {
    // 9 PM local on June 10 is still June 10 even when UTC has rolled over.
    expect(localIsoDate(new Date(2026, 5, 10, 21, 0, 0))).toBe("2026-06-10");
    expect(localIsoDate(new Date(2026, 0, 5, 0, 30, 0))).toBe("2026-01-05");
  });

  it("validates payments against the open balance", () => {
    expect(validatePayment("250.006", baseProject)).toEqual({ ok: true, amount: 250.01 });
    expect(validatePayment("750", baseProject)).toEqual({ ok: true, amount: 750 });
    expect(validatePayment("750.50", baseProject).ok).toBe(false);
    expect(validatePayment("0", baseProject).ok).toBe(false);
    expect(validatePayment("abc", baseProject).ok).toBe(false);
    // Jobs without a contract amount accept any positive payment.
    expect(validatePayment("500", { contractAmount: 0, paidAmount: 0 })).toEqual({ ok: true, amount: 500 });
  });

  it("summarizes projects by workflow and payment totals", () => {
    const stats = getProjectStats([
      baseProject,
      { ...baseProject, id: "project-two", status: "not-started", contractAmount: 500, paidAmount: 500 },
      { ...baseProject, id: "project-three", status: "complete", contractAmount: 300, paidAmount: 100 }
    ]);

    expect(stats.totalProjects).toBe(3);
    expect(stats.notStarted).toBe(1);
    expect(stats.started).toBe(1);
    expect(stats.complete).toBe(1);
    expect(stats.contractTotal).toBe(1800);
    expect(stats.paidTotal).toBe(850);
    expect(stats.openBalance).toBe(950);
  });
});
