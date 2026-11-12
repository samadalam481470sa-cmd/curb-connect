import type { IssuedInvoice } from '@fieldline/contracts';

function format(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
}

/** Read-only, printable representation of the same company-owned invoice returned by the API. */
export function InvoicePrint({
  invoice,
  companyName,
}: {
  invoice: IssuedInvoice;
  companyName: string;
}) {
  return (
    <article id="fieldpro-invoice-print" className="invoice-studio__document" aria-label="Printable invoice">
      <header className="invoice-studio__document-header">
        <div>
          <p className="invoice-studio__document-kicker">FIELD PRO · INVOICE</p>
          <h3>{companyName || 'Issuing company'}</h3>
          <p>Prepared using your company&apos;s Field Pro billing records</p>
        </div>
        <div className="invoice-studio__document-number">
          <span>INVOICE</span>
          <strong>{invoice.number}</strong>
          <span>{invoice.deliveryStatus}</span>
        </div>
      </header>
      <div className="invoice-studio__document-details">
        <div><span>Bill to</span><strong>{invoice.recipientName ?? 'Recipient not specified'}</strong>
          <small>{invoice.projectName ?? 'Standalone invoice'}</small></div>
        <div><span>Issued</span><strong>{invoice.issuedOn ?? 'Draft — not issued'}</strong></div>
        <div><span>Due date</span><strong>{invoice.dueOn ?? 'Not specified'}</strong></div>
      </div>
      <div className="invoice-studio__document-table">
        <table>
          <thead>
            <tr><th>Description</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th></tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={index}>
                <td>{line.description}</td>
                <td>{line.quantity}</td>
                <td>{line.unit}</td>
                <td>{format(line.unitPriceMinor, invoice.currency)}</td>
                <td>{format(line.amountMinor, invoice.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="invoice-studio__document-totals">
        <div><span>Subtotal</span><strong>{format(invoice.subtotalMinor, invoice.currency)}</strong></div>
        <div><span>Tax</span><strong>{format(invoice.taxMinor, invoice.currency)}</strong></div>
        <div className="invoice-studio__document-grand"><span>Total due</span>
          <strong>{format(invoice.totalMinor, invoice.currency)}</strong></div>
      </div>
      {invoice.memo && <div className="invoice-studio__document-memo">
        <strong>Notes</strong><p>{invoice.memo}</p>
      </div>}
      <footer>
        <strong>Thank you for your business.</strong>
        <span>This document reflects the invoice record above; payment details are provided separately.</span>
      </footer>
    </article>
  );
}
