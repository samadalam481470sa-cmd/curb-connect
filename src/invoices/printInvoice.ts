import type { Project } from "../types";
import { formatCents, invoiceTotals, lineItemCents, type Invoice } from "./invoiceMath";
import type { CompanyProfile } from "./invoiceStore";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function multiline(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

function formatDate(iso: string): string {
  if (!iso) {
    return "";
  }
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** Standalone, printable HTML for one invoice. All user text is escaped. */
export function renderInvoiceHtml(invoice: Invoice, project: Project | undefined, company: CompanyProfile): string {
  const totals = invoiceTotals(invoice);
  const rows = invoice.lineItems
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.description)}</td>
        <td class="num">${item.quantity.toLocaleString("en-US")}</td>
        <td>${escapeHtml(item.unit)}</td>
        <td class="num">${formatCents(item.unitPriceCents)}</td>
        <td class="num">${formatCents(lineItemCents(item))}</td>
      </tr>`
    )
    .join("");

  const billTo = project
    ? `<strong>${escapeHtml(project.contractor)}</strong><br />Project: ${escapeHtml(project.name)}<br />${escapeHtml(project.location)}`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(invoice.number)}${company.name ? ` - ${escapeHtml(company.name)}` : ""}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 48px; font-family: "Segoe UI", system-ui, sans-serif; color: #172033; }
  header { display: flex; justify-content: space-between; gap: 32px; margin-bottom: 36px; }
  h1 { margin: 0 0 4px; font-size: 32px; letter-spacing: -0.02em; }
  .muted { color: #5b6474; }
  .meta { text-align: right; }
  .meta div { margin-bottom: 4px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 28px; }
  .label { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #b06b1d; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #5b6474; border-bottom: 2px solid #172033; padding: 8px 6px; }
  td { padding: 10px 6px; border-bottom: 1px solid #e2e6ec; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .totals { margin-left: auto; width: 320px; }
  .totals div { display: flex; justify-content: space-between; padding: 6px 0; }
  .totals .due { border-top: 2px solid #172033; margin-top: 6px; padding-top: 10px; font-size: 18px; font-weight: 800; }
  .notes { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e6ec; }
  .status { display: inline-block; padding: 2px 10px; border-radius: 999px; background: #eef1f5; font-size: 12px; font-weight: 700; text-transform: uppercase; }
  @media print { body { padding: 0; } @page { margin: 18mm; } }
</style>
</head>
<body>
<header>
  <div>
    <h1>${escapeHtml(company.name || "Your company name")}</h1>
    <div class="muted">${multiline(company.address)}</div>
    <div class="muted">${escapeHtml([company.phone, company.email].filter(Boolean).join(" · "))}</div>
  </div>
  <div class="meta">
    <h1>Invoice</h1>
    <div><strong>${escapeHtml(invoice.number)}</strong> <span class="status">${escapeHtml(invoice.status)}</span></div>
    <div>Issued ${escapeHtml(formatDate(invoice.issueDate))}</div>
    <div>Due ${escapeHtml(formatDate(invoice.dueDate))}</div>
  </div>
</header>
<section class="parties">
  <div><div class="label">Bill to</div>${billTo}</div>
  <div><div class="label">From</div>${project ? escapeHtml(project.subcontractor) : escapeHtml(company.name)}</div>
</section>
<table>
  <thead><tr><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5" class="muted">No line items</td></tr>'}</tbody>
</table>
<div class="totals">
  <div><span>Subtotal</span><span>${formatCents(totals.subtotalCents)}</span></div>
  <div><span>Tax (${invoice.taxRatePercent}%)</span><span>${formatCents(totals.taxCents)}</span></div>
  <div><span>Total</span><span>${formatCents(totals.totalCents)}</span></div>
  ${
    totals.retainageCents > 0
      ? `<div><span>Retainage held (${invoice.retainagePercent}%)</span><span>-${formatCents(totals.retainageCents)}</span></div>`
      : ""
  }
  <div class="due"><span>Amount due</span><span>${formatCents(totals.amountDueCents)}</span></div>
</div>
${invoice.notes || company.paymentInstructions ? `<section class="notes">${invoice.notes ? `<div class="label">Notes</div><p>${multiline(invoice.notes)}</p>` : ""}${company.paymentInstructions ? `<div class="label">Payment</div><p>${multiline(company.paymentInstructions)}</p>` : ""}</section>` : ""}
</body>
</html>`;
}

/** Opens the invoice in a new window and starts the print dialog (where "Save as PDF" is offered). */
export function printInvoice(invoice: Invoice, project: Project | undefined, company: CompanyProfile): boolean {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    return false;
  }
  printWindow.document.open();
  printWindow.document.write(renderInvoiceHtml(invoice, project, company));
  printWindow.document.close();
  let printed = false;
  const startPrint = () => {
    if (!printed) {
      printed = true;
      printWindow.focus();
      printWindow.print();
    }
  };
  printWindow.addEventListener("load", startPrint);
  // Some browsers have already fired load for document.write content.
  window.setTimeout(startPrint, 400);
  return true;
}
