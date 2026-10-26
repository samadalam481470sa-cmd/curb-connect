from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import CurrentUser, DbSession, load_project
from ..models import Invoice, InvoiceLine, User, utcnow
from ..schemas import InvoiceIn, InvoiceLineIn, InvoicePatch
from ..serializers import invoice_out
from ..services import format_cents, open_balance_cents, record_payment, touch

router = APIRouter(prefix="/api/invoices", tags=["invoices"])

DEFAULT_TERMS_DAYS = 30
NUMBER_PREFIX = "INV-"
FIRST_NUMBER = 1001


def invoice_totals(invoice: Invoice) -> dict[str, int]:
    """Mirrors src/invoices/invoiceMath.ts so the server and the app agree to the cent."""
    subtotal = sum(round(line.quantity * line.unit_price_cents) for line in invoice.line_items)
    tax = round(subtotal * min(max(invoice.tax_rate_percent, 0), 100) / 100)
    total = subtotal + tax
    retainage = round(total * min(max(invoice.retainage_percent, 0), 100) / 100)
    return {"subtotal": subtotal, "tax": tax, "total": total, "retainage": retainage, "amount_due": total - retainage}


def _next_number(db: Session, company_id: str) -> str:
    highest = FIRST_NUMBER - 1
    for number in db.scalars(select(Invoice.number).where(Invoice.company_id == company_id)):
        if number.startswith(NUMBER_PREFIX) and number[len(NUMBER_PREFIX) :].isdigit():
            highest = max(highest, int(number[len(NUMBER_PREFIX) :]))
    return f"{NUMBER_PREFIX}{highest + 1}"


def _set_lines(invoice: Invoice, lines: list[InvoiceLineIn]) -> None:
    invoice.line_items = [
        InvoiceLine(
            position=index,
            description=line.description,
            quantity=line.quantity,
            unit=line.unit,
            unit_price_cents=line.unit_price_cents,
        )
        for index, line in enumerate(lines)
    ]


def _own_invoice(db: Session, invoice_id: str, user: User) -> Invoice:
    invoice = db.get(Invoice, invoice_id)
    if not invoice or invoice.company_id != user.company_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found.")
    return invoice


def _ensure_unique_number(db: Session, company_id: str, number: str, invoice_id: str | None = None) -> None:
    clash = db.scalar(select(Invoice).where(Invoice.company_id == company_id, Invoice.number == number))
    if clash and clash.id != invoice_id:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Invoice number {number} is already used.")


@router.post("", status_code=status.HTTP_201_CREATED)
def create_invoice(body: InvoiceIn, db: DbSession, user: CurrentUser) -> dict:
    project, _role = load_project(db, body.project_id, user)
    number = body.number or _next_number(db, user.company_id)
    _ensure_unique_number(db, user.company_id, number)
    issue_date = body.issue_date or date.today()
    invoice = Invoice(
        company_id=user.company_id,
        project_id=project.id,
        number=number,
        issue_date=issue_date,
        due_date=body.due_date or issue_date + timedelta(days=DEFAULT_TERMS_DAYS),
        tax_rate_percent=body.tax_rate_percent,
        retainage_percent=body.retainage_percent,
        notes=body.notes,
        status="draft",
    )
    if body.line_items is None:
        quantity = f" ({project.quantity})" if project.quantity else ""
        _set_lines(
            invoice,
            [
                InvoiceLineIn(
                    description=f"{project.service} - {project.name}{quantity}",
                    quantity=1,
                    unit="lump sum",
                    unit_price_cents=open_balance_cents(project),
                )
            ],
        )
    else:
        _set_lines(invoice, body.line_items)
    db.add(invoice)
    db.commit()
    return invoice_out(invoice)


@router.patch("/{invoice_id}")
def update_invoice(invoice_id: str, body: InvoicePatch, db: DbSession, user: CurrentUser) -> dict:
    invoice = _own_invoice(db, invoice_id, user)
    if invoice.status != "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only drafts can be edited. Void it and issue a new one instead.")
    changes = body.model_dump(exclude_unset=True, exclude={"line_items"})
    if "number" in changes:
        _ensure_unique_number(db, user.company_id, changes["number"], invoice.id)
    for field, value in changes.items():
        setattr(invoice, field, value)
    if body.line_items is not None:
        _set_lines(invoice, body.line_items)
    invoice.updated_at = utcnow()
    db.commit()
    return invoice_out(invoice)


@router.delete("/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invoice(invoice_id: str, db: DbSession, user: CurrentUser) -> None:
    invoice = _own_invoice(db, invoice_id, user)
    if invoice.status != "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only drafts can be deleted. Void a sent invoice instead.")
    db.delete(invoice)
    db.commit()


@router.post("/{invoice_id}/send")
def send_invoice(invoice_id: str, db: DbSession, user: CurrentUser) -> dict:
    invoice = _own_invoice(db, invoice_id, user)
    if invoice.status != "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, "This invoice was already sent.")
    if invoice_totals(invoice)["total"] <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Add line items before sending.")
    project, _role = load_project(db, invoice.project_id, user)
    invoice.status = "sent"
    invoice.sent_date = date.today()
    invoice.updated_at = utcnow()
    project.invoice_number = invoice.number
    touch(project)
    db.commit()
    return invoice_out(invoice)


@router.post("/{invoice_id}/pay")
def pay_invoice(invoice_id: str, db: DbSession, user: CurrentUser) -> dict:
    """Marks the invoice paid and logs the pre-tax share on the job, in one transaction."""
    invoice = _own_invoice(db, invoice_id, user)
    if invoice.status != "sent":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only sent invoices can be marked paid.")
    project, _role = load_project(db, invoice.project_id, user)
    totals = invoice_totals(invoice)
    # The job's contract amount is pre-tax, so only the pre-tax share counts against its balance.
    contract_cents = round(totals["amount_due"] * totals["subtotal"] / totals["total"]) if totals["total"] else 0
    tax_cents = totals["amount_due"] - contract_cents
    note = f"Payment for {invoice.number}" + (f" (plus {format_cents(tax_cents)} sales tax)" if tax_cents > 0 else "")
    record_payment(db, project, contract_cents, user, note=note, invoice_id=invoice.id)
    invoice.status = "paid"
    invoice.paid_date = date.today()
    invoice.updated_at = utcnow()
    db.commit()
    return {"invoice": invoice_out(invoice), "appliedCents": contract_cents}


@router.post("/{invoice_id}/void")
def void_invoice(invoice_id: str, db: DbSession, user: CurrentUser) -> dict:
    invoice = _own_invoice(db, invoice_id, user)
    if invoice.status not in ("draft", "sent"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Paid invoices can't be voided.")
    invoice.status = "void"
    invoice.updated_at = utcnow()
    db.commit()
    return invoice_out(invoice)
