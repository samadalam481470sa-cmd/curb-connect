"""Turns database rows into the JSON shapes the web app reads (camelCase, cents, ISO dates)."""

from datetime import date, datetime, timezone
from typing import Any

from .models import Company, Invoice, Project, User


def iso_date(value: date | None) -> str:
    return value.isoformat() if value else ""


def iso_time(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def payment_status(project: Project, today: date | None = None) -> str:
    today = today or date.today()
    if project.contract_cents <= 0:
        return "paid" if project.paid_cents > 0 else "unpaid"
    if project.paid_cents >= project.contract_cents:
        return "paid"
    if project.due_date and project.due_date < today:
        return "overdue"
    return "partial" if project.paid_cents > 0 else "unpaid"


def project_out(project: Project, viewer_role: str) -> dict[str, Any]:
    return {
        "id": project.id,
        "name": project.name,
        "contractor": project.contractor_name,
        "subcontractor": project.subcontractor_name,
        "location": project.location,
        "service": project.service,
        "status": project.status,
        "priority": project.priority,
        "startDate": iso_date(project.start_date),
        "dueDate": iso_date(project.due_date),
        "completedDate": iso_date(project.completed_date) or None,
        "contractCents": project.contract_cents,
        "paidCents": project.paid_cents,
        "paymentStatus": payment_status(project),
        "notes": project.notes,
        "siteContact": project.site_contact,
        "crewSize": project.crew_size,
        "quantity": project.quantity,
        "invoiceNumber": project.invoice_number,
        "tasks": [
            {
                "id": task.id,
                "title": task.title,
                "owner": task.owner,
                "dueDate": iso_date(task.due_date),
                "complete": task.complete,
            }
            for task in sorted(project.tasks, key=lambda item: item.created_at)
        ],
        "documents": [
            {
                "id": document.id,
                "name": document.name,
                "type": document.content_type,
                "size": document.size,
                "uploadedBy": document.uploaded_by,
                "uploadedAt": iso_time(document.uploaded_at),
            }
            for document in sorted(project.documents, key=lambda item: item.uploaded_at, reverse=True)
        ],
        "messages": [
            {"id": message.id, "sender": message.sender, "body": message.body, "createdAt": iso_time(message.created_at)}
            for message in sorted(project.messages, key=lambda item: item.created_at, reverse=True)
        ],
        "createdAt": iso_time(project.created_at),
        "updatedAt": iso_time(project.updated_at),
        "viewerRole": viewer_role,
        "subcontractorLinked": project.sub_company_id is not None,
    }


def invoice_out(invoice: Invoice) -> dict[str, Any]:
    return {
        "id": invoice.id,
        "companyId": invoice.company_id,
        "number": invoice.number,
        "projectId": invoice.project_id,
        "issueDate": iso_date(invoice.issue_date),
        "dueDate": iso_date(invoice.due_date),
        "lineItems": [
            {
                "id": line.id,
                "description": line.description,
                "quantity": line.quantity,
                "unit": line.unit,
                "unitPriceCents": line.unit_price_cents,
            }
            for line in invoice.line_items
        ],
        "taxRatePercent": invoice.tax_rate_percent,
        "retainagePercent": invoice.retainage_percent,
        "notes": invoice.notes,
        "status": invoice.status,
        "sentDate": iso_date(invoice.sent_date) or None,
        "paidDate": iso_date(invoice.paid_date) or None,
        "createdAt": iso_time(invoice.created_at),
        "updatedAt": iso_time(invoice.updated_at),
    }


def company_out(company: Company) -> dict[str, Any]:
    return {
        "id": company.id,
        "name": company.name,
        "address": company.address,
        "phone": company.phone,
        "email": company.email,
        "paymentInstructions": company.payment_instructions,
    }


def user_out(user: User) -> dict[str, Any]:
    return {"id": user.id, "name": user.name, "email": user.email, "role": user.role, "company": company_out(user.company)}
