import { useEffect, useMemo, useState } from "react";
import { getOpenBalance, localIsoDate, makeId } from "../projectUtils";
import type { Project } from "../types";
import {
  addDaysIso,
  displayStatus,
  formatCents,
  invoiceTotals,
  lineItemCents,
  nextInvoiceNumber,
  summarizeInvoices,
  type DisplayStatus,
  type Invoice,
  type InvoiceLineItem
} from "./invoiceMath";
import { loadCompanyProfile, loadInvoices, saveCompanyProfile, saveInvoices, type CompanyProfile } from "./invoiceStore";
import { printInvoice } from "./printInvoice";

interface InvoicesPanelProps {
  projects: Project[];
  /** Logs a payment on the project. Returns an error message, or null on success. */
  onRecordPayment: (projectId: string, amountDollars: number, note: string) => string | null;
  /** Called when an invoice is sent so the project card shows its number. */
  onInvoiceSent: (projectId: string, invoiceNumber: string) => void;
}

const DEFAULT_TERMS_DAYS = 30;

const statusLabels: Record<DisplayStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  overdue: "Overdue",
  paid: "Paid",
  void: "Void"
};

function parseNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function newLineItem(overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem {
  return { id: makeId("line"), description: "", quantity: 1, unit: "ea", unitPriceCents: 0, ...overrides };
}

function InvoicesPanel({ projects, onRecordPayment, onInvoiceSent }: InvoicesPanelProps) {
  const [invoices, setInvoices] = useState<Invoice[]>(() => loadInvoices());
  const [company, setCompany] = useState<CompanyProfile>(() => loadCompanyProfile());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newProjectId, setNewProjectId] = useState("");
  const [filter, setFilter] = useState<DisplayStatus | "all">("all");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!saveInvoices(invoices)) {
      // Surface storage problems instead of silently losing invoices.
      window.setTimeout(() => setMessage("Invoices could not be saved on this device. Browser storage is full or blocked."));
    }
  }, [invoices]);

  useEffect(() => {
    saveCompanyProfile(company);
  }, [company]);

  const today = localIsoDate();
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const summary = useMemo(() => summarizeInvoices(invoices, today), [invoices, today]);
  const editing = invoices.find((invoice) => invoice.id === editingId) ?? null;

  const visibleInvoices = useMemo(
    () =>
      [...invoices]
        .filter((invoice) => filter === "all" || displayStatus(invoice, today) === filter)
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number)),
    [invoices, filter, today]
  );

  function updateInvoice(id: string, changes: Partial<Invoice>) {
    setInvoices((current) =>
      current.map((invoice) =>
        invoice.id === id ? { ...invoice, ...changes, updatedAt: new Date().toISOString() } : invoice
      )
    );
  }

  function updateLineItem(invoiceId: string, lineId: string, changes: Partial<InvoiceLineItem>) {
    const invoice = invoices.find((item) => item.id === invoiceId);
    if (!invoice) {
      return;
    }
    updateInvoice(invoiceId, {
      lineItems: invoice.lineItems.map((line) => (line.id === lineId ? { ...line, ...changes } : line))
    });
  }

  function createInvoice() {
    const project = projectsById.get(newProjectId);
    if (!project) {
      setMessage("Pick a job to invoice first.");
      return;
    }
    const timestamp = new Date().toISOString();
    const balanceCents = Math.round(getOpenBalance(project) * 100);
    const invoice: Invoice = {
      id: makeId("invoice"),
      number: nextInvoiceNumber(invoices),
      projectId: project.id,
      issueDate: today,
      dueDate: addDaysIso(today, DEFAULT_TERMS_DAYS),
      lineItems: [
        newLineItem({
          description: `${project.service} - ${project.name}${project.quantity ? ` (${project.quantity})` : ""}`,
          quantity: 1,
          unit: "lump sum",
          unitPriceCents: balanceCents
        })
      ],
      taxRatePercent: 0,
      retainagePercent: 0,
      notes: "",
      status: "draft",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    setInvoices((current) => [invoice, ...current]);
    setEditingId(invoice.id);
    setMessage("");
  }

  function markSent(invoice: Invoice) {
    if (invoiceTotals(invoice).totalCents <= 0) {
      setMessage(`${invoice.number} has no amount yet. Add line items before sending.`);
      return;
    }
    updateInvoice(invoice.id, { status: "sent", sentDate: today });
    onInvoiceSent(invoice.projectId, invoice.number);
    setEditingId(null);
    setMessage(`${invoice.number} marked as sent.`);
  }

  function markPaid(invoice: Invoice) {
    const totals = invoiceTotals(invoice);
    // The job's contract amount is pre-tax, so only the pre-tax share of the payment counts against its balance.
    const contractCents =
      totals.totalCents > 0 ? Math.round((totals.amountDueCents * totals.subtotalCents) / totals.totalCents) : 0;
    const taxCents = totals.amountDueCents - contractCents;
    const note = `Payment for ${invoice.number}${taxCents > 0 ? ` (plus ${formatCents(taxCents)} sales tax)` : ""}`;
    const error = onRecordPayment(invoice.projectId, contractCents / 100, note);
    if (error) {
      setMessage(`${invoice.number}: ${error}`);
      return;
    }
    updateInvoice(invoice.id, { status: "paid", paidDate: today });
    setMessage(`${invoice.number} marked paid. ${formatCents(contractCents)} was applied to the job balance.`);
  }

  function voidInvoice(invoice: Invoice) {
    if (window.confirm(`Void ${invoice.number}? It stays on record but no longer counts as owed.`)) {
      updateInvoice(invoice.id, { status: "void" });
      if (editingId === invoice.id) {
        setEditingId(null);
      }
    }
  }

  function deleteDraft(invoice: Invoice) {
    if (window.confirm(`Delete draft ${invoice.number}?`)) {
      setInvoices((current) => current.filter((item) => item.id !== invoice.id));
      setEditingId(null);
    }
  }

  function handlePrint(invoice: Invoice) {
    if (!printInvoice(invoice, projectsById.get(invoice.projectId), company)) {
      setMessage("Allow pop-ups for this site to print or save the invoice as a PDF.");
    }
  }

  const editingTotals = editing ? invoiceTotals(editing) : null;
  const editable = editing?.status === "draft";

  return (
    <section className="card invoices-section" aria-label="Invoices">
      <div className="section-heading spread">
        <div>
          <p className="eyebrow">Invoices</p>
          <h2>Bill jobs, track what is owed, and print PDFs</h2>
        </div>
        <div className="invoice-new">
          <select aria-label="Job to invoice" value={newProjectId} onChange={(event) => setNewProjectId(event.target.value)}>
            <option value="">Choose a job…</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <button className="primary-button" type="button" onClick={createInvoice}>
            New invoice
          </button>
        </div>
      </div>

      <div className="invoice-stats">
        <article>
          <span>Outstanding</span>
          <strong>{formatCents(summary.outstandingCents)}</strong>
        </article>
        <article className={summary.overdueCents > 0 ? "alert" : ""}>
          <span>Overdue</span>
          <strong>{formatCents(summary.overdueCents)}</strong>
        </article>
        <article>
          <span>Paid</span>
          <strong>{formatCents(summary.paidCents)}</strong>
        </article>
        <article>
          <span>Drafts</span>
          <strong>{summary.draftCount}</strong>
        </article>
      </div>

      {message ? (
        <p className="invoice-message" role="status">
          {message}
        </p>
      ) : null}

      {editing && editingTotals ? (
        // Keyed by invoice so the uncontrolled number inputs reset when another invoice is opened.
        <div className="invoice-editor" key={editing.id}>
          <div className="invoice-editor-head">
            <h3>
              {editing.number} · {projectsById.get(editing.projectId)?.name ?? "Deleted job"}
            </h3>
            <span className={`invoice-pill ${displayStatus(editing, today)}`}>{statusLabels[displayStatus(editing, today)]}</span>
          </div>
          {!editable ? <p className="empty-state compact">Sent, paid, and void invoices are locked so the record matches what the customer received.</p> : null}

          <div className="three-column">
            <label>
              Invoice number
              <input
                value={editing.number}
                disabled={!editable}
                onChange={(event) => updateInvoice(editing.id, { number: event.target.value })}
              />
            </label>
            <label>
              Issue date
              <input
                type="date"
                value={editing.issueDate}
                disabled={!editable}
                onChange={(event) => updateInvoice(editing.id, { issueDate: event.target.value })}
              />
            </label>
            <label>
              Due date
              <input
                type="date"
                value={editing.dueDate}
                disabled={!editable}
                onChange={(event) => updateInvoice(editing.id, { dueDate: event.target.value })}
              />
            </label>
          </div>

          <div className="line-items" role="table" aria-label="Line items">
            <div className="line-item head" role="row">
              <span role="columnheader">Description</span>
              <span role="columnheader">Qty</span>
              <span role="columnheader">Unit</span>
              <span role="columnheader">Rate ($)</span>
              <span role="columnheader">Amount</span>
              <span />
            </div>
            {editing.lineItems.map((line) => (
              <div className="line-item" role="row" key={line.id}>
                <input
                  aria-label="Description"
                  value={line.description}
                  disabled={!editable}
                  onChange={(event) => updateLineItem(editing.id, line.id, { description: event.target.value })}
                  placeholder="e.g. 6 x 18 curb & gutter"
                />
                <input
                  aria-label="Quantity"
                  type="number"
                  min="0"
                  step="any"
                  defaultValue={line.quantity}
                  disabled={!editable}
                  onChange={(event) => updateLineItem(editing.id, line.id, { quantity: parseNumber(event.target.value) })}
                />
                <input
                  aria-label="Unit"
                  value={line.unit}
                  disabled={!editable}
                  onChange={(event) => updateLineItem(editing.id, line.id, { unit: event.target.value })}
                />
                <input
                  aria-label="Rate"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={line.unitPriceCents / 100}
                  disabled={!editable}
                  onChange={(event) =>
                    updateLineItem(editing.id, line.id, { unitPriceCents: Math.round(parseNumber(event.target.value) * 100) })
                  }
                />
                <strong className="num">{formatCents(lineItemCents(line))}</strong>
                {editable ? (
                  <button
                    type="button"
                    aria-label={`Remove ${line.description || "line"}`}
                    onClick={() =>
                      updateInvoice(editing.id, { lineItems: editing.lineItems.filter((item) => item.id !== line.id) })
                    }
                  >
                    ×
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
            {editable ? (
              <button
                className="secondary-button add-line"
                type="button"
                onClick={() => updateInvoice(editing.id, { lineItems: [...editing.lineItems, newLineItem()] })}
              >
                Add line item
              </button>
            ) : null}
          </div>

          <div className="invoice-bottom">
            <div className="invoice-options">
              <div className="two-column">
                <label>
                  Sales tax %
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue={editing.taxRatePercent}
                    disabled={!editable}
                    onChange={(event) => updateInvoice(editing.id, { taxRatePercent: parseNumber(event.target.value) })}
                  />
                </label>
                <label>
                  Retainage %
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    defaultValue={editing.retainagePercent}
                    disabled={!editable}
                    onChange={(event) => updateInvoice(editing.id, { retainagePercent: parseNumber(event.target.value) })}
                  />
                </label>
              </div>
              <label>
                Notes on invoice
                <textarea
                  rows={3}
                  value={editing.notes}
                  disabled={!editable}
                  onChange={(event) => updateInvoice(editing.id, { notes: event.target.value })}
                  placeholder="Scope, change orders, lien waiver terms…"
                />
              </label>
            </div>
            <dl className="invoice-totals">
              <div><dt>Subtotal</dt><dd>{formatCents(editingTotals.subtotalCents)}</dd></div>
              <div><dt>Tax</dt><dd>{formatCents(editingTotals.taxCents)}</dd></div>
              <div><dt>Total</dt><dd>{formatCents(editingTotals.totalCents)}</dd></div>
              {editingTotals.retainageCents > 0 ? (
                <div><dt>Retainage held</dt><dd>-{formatCents(editingTotals.retainageCents)}</dd></div>
              ) : null}
              <div className="due"><dt>Amount due</dt><dd>{formatCents(editingTotals.amountDueCents)}</dd></div>
            </dl>
          </div>

          <div className="invoice-actions">
            {editable ? (
              <button className="primary-button" type="button" onClick={() => markSent(editing)}>
                Mark as sent
              </button>
            ) : null}
            <button className="secondary-button" type="button" onClick={() => handlePrint(editing)}>
              Print / save PDF
            </button>
            <button className="secondary-button" type="button" onClick={() => setEditingId(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      <div className="invoice-filters" role="group" aria-label="Filter invoices">
        {(["all", "draft", "sent", "overdue", "paid", "void"] as const).map((option) => (
          <button key={option} type="button" className={filter === option ? "active" : ""} onClick={() => setFilter(option)}>
            {option === "all" ? "All" : statusLabels[option]}
          </button>
        ))}
      </div>

      {visibleInvoices.length === 0 ? (
        <p className="empty-state compact">
          {invoices.length === 0 ? "No invoices yet. Choose a job above and create one." : "No invoices with this status."}
        </p>
      ) : (
        <div className="invoice-table-wrap">
          <table className="invoice-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Job</th>
                <th>Issued</th>
                <th>Due</th>
                <th>Status</th>
                <th className="num">Amount due</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleInvoices.map((invoice) => {
                const status = displayStatus(invoice, today);
                return (
                  <tr key={invoice.id} className={invoice.id === editingId ? "selected" : ""}>
                    <td>
                      <button type="button" className="link-button" onClick={() => setEditingId(invoice.id)}>
                        {invoice.number}
                      </button>
                    </td>
                    <td>{projectsById.get(invoice.projectId)?.name ?? "Deleted job"}</td>
                    <td>{invoice.issueDate}</td>
                    <td>{invoice.dueDate}</td>
                    <td>
                      <span className={`invoice-pill ${status}`}>{statusLabels[status]}</span>
                    </td>
                    <td className="num">{formatCents(invoiceTotals(invoice).amountDueCents)}</td>
                    <td className="row-actions">
                      {invoice.status === "draft" ? (
                        <>
                          <button type="button" onClick={() => markSent(invoice)}>Send</button>
                          <button type="button" onClick={() => deleteDraft(invoice)}>Delete</button>
                        </>
                      ) : null}
                      {invoice.status === "sent" ? (
                        <>
                          <button type="button" onClick={() => markPaid(invoice)}>Mark paid</button>
                          <button type="button" onClick={() => voidInvoice(invoice)}>Void</button>
                        </>
                      ) : null}
                      <button type="button" onClick={() => handlePrint(invoice)}>Print</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <details className="company-profile">
        <summary>Your company details (printed on every invoice)</summary>
        <div className="two-column">
          <label>
            Company name
            <input value={company.name} onChange={(event) => setCompany({ ...company, name: event.target.value })} />
          </label>
          <label>
            Phone
            <input value={company.phone} onChange={(event) => setCompany({ ...company, phone: event.target.value })} />
          </label>
          <label>
            Email
            <input type="email" value={company.email} onChange={(event) => setCompany({ ...company, email: event.target.value })} />
          </label>
          <label>
            Address
            <textarea rows={2} value={company.address} onChange={(event) => setCompany({ ...company, address: event.target.value })} />
          </label>
        </div>
        <label>
          Payment instructions
          <textarea
            rows={2}
            value={company.paymentInstructions}
            onChange={(event) => setCompany({ ...company, paymentInstructions: event.target.value })}
          />
        </label>
      </details>
    </section>
  );
}

export default InvoicesPanel;
