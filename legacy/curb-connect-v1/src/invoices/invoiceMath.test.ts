import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  displayStatus,
  formatCents,
  invoiceTotals,
  lineItemCents,
  nextInvoiceNumber,
  summarizeInvoices,
  type Invoice
} from "./invoiceMath";
import { emptyCompanyProfile } from "./invoiceStore";
import { renderInvoiceHtml } from "./printInvoice";

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    number: "INV-1001",
    projectId: "project-1",
    issueDate: "2026-06-01",
    dueDate: "2026-07-01",
    lineItems: [
      { id: "a", description: "6x18 curb", quantity: 270, unit: "LF", unitPriceCents: 3250 },
      { id: "b", description: "Saw-cut", quantity: 60, unit: "LF", unitPriceCents: 450 }
    ],
    taxRatePercent: 8.25,
    retainagePercent: 10,
    notes: "",
    status: "sent",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides
  };
}

describe("invoice math", () => {
  it("rounds each line to whole cents", () => {
    expect(lineItemCents({ quantity: 1.5, unitPriceCents: 333 })).toBe(500);
    expect(lineItemCents({ quantity: Number.NaN, unitPriceCents: 100 })).toBe(0);
  });

  it("computes subtotal, tax, retainage, and amount due", () => {
    const totals = invoiceTotals(invoice());
    // 270 * 32.50 = 8,775.00 + 60 * 4.50 = 270.00 -> 9,045.00
    expect(totals.subtotalCents).toBe(904_500);
    // 8.25% of 9,045.00 = 746.2125 -> 746.21
    expect(totals.taxCents).toBe(74_621);
    expect(totals.totalCents).toBe(979_121);
    // 10% retainage of 9,791.21 = 979.121 -> 979.12
    expect(totals.retainageCents).toBe(97_912);
    expect(totals.amountDueCents).toBe(881_209);
  });

  it("clamps out-of-range percentages", () => {
    const totals = invoiceTotals(invoice({ taxRatePercent: -5, retainagePercent: 150 }));
    expect(totals.taxCents).toBe(0);
    expect(totals.amountDueCents).toBe(0);
  });

  it("marks sent invoices overdue after the due date only", () => {
    expect(displayStatus(invoice(), "2026-07-01")).toBe("sent");
    expect(displayStatus(invoice(), "2026-07-02")).toBe("overdue");
    expect(displayStatus(invoice({ status: "paid" }), "2026-08-01")).toBe("paid");
    expect(displayStatus(invoice({ status: "draft" }), "2026-08-01")).toBe("draft");
  });

  it("numbers invoices after the highest existing number", () => {
    expect(nextInvoiceNumber([])).toBe("INV-1001");
    expect(nextInvoiceNumber([{ number: "INV-1004" }, { number: "INV-1010" }, { number: "Custom 9" }])).toBe("INV-1011");
  });

  it("adds days across month and year ends", () => {
    expect(addDaysIso("2026-01-31", 30)).toBe("2026-03-02");
    expect(addDaysIso("2026-12-15", 30)).toBe("2027-01-14");
  });

  it("formats cents as dollars", () => {
    expect(formatCents(881_209)).toBe("$8,812.09");
  });

  it("escapes user text in the printable invoice", () => {
    const html = renderInvoiceHtml(
      invoice({ notes: "<script>alert(1)</script>" }),
      undefined,
      { ...emptyCompanyProfile, name: "Curb & Co <LLC>" }
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Curb &amp; Co &lt;LLC&gt;");
    expect(html).toContain("$8,812.09");
  });

  it("summarizes outstanding, overdue, and paid amounts", () => {
    const summary = summarizeInvoices(
      [
        invoice({ id: "1", dueDate: "2026-06-10" }),
        invoice({ id: "2", dueDate: "2026-12-31" }),
        invoice({ id: "3", status: "paid" }),
        invoice({ id: "4", status: "draft" }),
        invoice({ id: "5", status: "void" })
      ],
      "2026-06-15"
    );
    expect(summary.outstandingCents).toBe(2 * 881_209);
    expect(summary.overdueCents).toBe(881_209);
    expect(summary.paidCents).toBe(881_209);
    expect(summary.draftCount).toBe(1);
  });
});
