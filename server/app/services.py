"""Business rules shared by the routes."""

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from .models import Message, Payment, Project, User, utcnow


def format_cents(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def open_balance_cents(project: Project) -> int:
    return max(project.contract_cents - project.paid_cents, 0)


def touch(project: Project) -> None:
    """Marks the job changed so other open screens pick it up on their next sync."""
    project.updated_at = utcnow()


def system_message(project: Project, body: str) -> None:
    project.messages.append(Message(sender="System", body=body, created_at=utcnow()))
    touch(project)


def apply_status(project: Project, new_status: str, today: date | None = None) -> None:
    today = today or date.today()
    if new_status == project.status:
        return
    project.status = new_status
    if new_status in ("finished", "complete"):
        project.completed_date = project.completed_date or today
    else:
        project.completed_date = None
    labels = {"not-started": "Not started", "started": "Started", "finished": "Finished", "complete": "Complete"}
    system_message(project, f"Status changed to {labels[new_status]}.")


def record_payment(
    db: Session,
    project: Project,
    amount_cents: int,
    user: User,
    note: str = "",
    invoice_id: str | None = None,
) -> Payment:
    """Logs a payment. Rejects payments above the open balance so totals never exceed the contract."""
    if amount_cents <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter a payment amount greater than $0.")
    balance = open_balance_cents(project)
    if project.contract_cents > 0 and amount_cents > balance:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Payment is more than the {format_cents(balance)} open balance. "
            "Update the contract amount first if this covers extra work.",
        )

    payment = Payment(
        amount_cents=amount_cents, note=note, invoice_id=invoice_id, recorded_by=user.id, created_at=utcnow()
    )
    project.payments.append(payment)
    project.paid_cents += amount_cents

    # A finished job that is now fully paid closes out automatically.
    fully_paid = project.contract_cents > 0 and project.paid_cents >= project.contract_cents
    if fully_paid and project.status == "finished":
        project.status = "complete"
        project.completed_date = project.completed_date or date.today()

    prefix = f"{note}. " if note else ""
    system_message(
        project,
        f"{prefix}Payment logged: {format_cents(amount_cents)}. Open balance is {format_cents(open_balance_cents(project))}.",
    )
    db.flush()
    return payment
