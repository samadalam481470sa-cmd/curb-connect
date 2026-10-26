from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import or_, select

from ..config import settings
from ..deps import CurrentUser, DbSession, load_project, project_role
from ..models import Document, Invite, Invoice, Message, Project, Task, new_id, utcnow
from ..schemas import InviteIn, MessageIn, PaymentIn, ProjectIn, ProjectPatch, TaskIn, TaskPatch
from ..security import hash_invite_token, new_invite_token
from ..serializers import invoice_out, iso_time, project_out
from ..services import apply_status, record_payment, system_message, touch

router = APIRouter(prefix="/api", tags=["projects"])

INVITE_LIFETIME = timedelta(days=14)
# Types a browser may display inline. Anything else downloads, so an uploaded HTML file can't run in our origin.
INLINE_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain"}
CONTRACTOR_ONLY_FIELDS = {
    "name",
    "location",
    "service",
    "priority",
    "start_date",
    "due_date",
    "contract_cents",
    "notes",
    "site_contact",
    "crew_size",
    "quantity",
    "invoice_number",
}


def _visible_projects(db: DbSession, user: CurrentUser) -> list[Project]:
    return list(
        db.scalars(
            select(Project)
            .where(or_(Project.owner_company_id == user.company_id, Project.sub_company_id == user.company_id))
            .order_by(Project.created_at.desc())
        )
    )


def _out(project: Project, user: CurrentUser) -> dict:
    role = project_role(project, user)
    assert role is not None
    return project_out(project, role)


@router.get("/projects")
def list_projects(db: DbSession, user: CurrentUser) -> list[dict]:
    return [_out(project, user) for project in _visible_projects(db, user)]


@router.get("/sync")
def sync(
    db: DbSession,
    user: CurrentUser,
    since: Annotated[str | None, Query(description="ISO timestamp from the previous sync's serverTime")] = None,
) -> dict:
    """Everything changed since `since`, for live updates. Ids let the client drop records that were removed."""
    server_time = utcnow()
    since_time: datetime | None = None
    if since:
        try:
            since_time = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "since must be an ISO timestamp.") from None
        if since_time.tzinfo is None:
            since_time = since_time.replace(tzinfo=timezone.utc)

    projects = _visible_projects(db, user)
    invoices = _visible_invoices(db, user, projects)

    def changed(updated_at: datetime) -> bool:
        if since_time is None:
            return True
        stamp = updated_at if updated_at.tzinfo else updated_at.replace(tzinfo=timezone.utc)
        return stamp > since_time

    return {
        "serverTime": iso_time(server_time),
        "projects": [_out(project, user) for project in projects if changed(project.updated_at)],
        "projectIds": [project.id for project in projects],
        "invoices": [invoice_out(invoice) for invoice in invoices if changed(invoice.updated_at)],
        "invoiceIds": [invoice.id for invoice in invoices],
    }


def _visible_invoices(db: DbSession, user: CurrentUser, projects: list[Project]) -> list[Invoice]:
    """Your company's invoices, plus invoices sent to you on jobs you're part of (never their drafts)."""
    project_ids = [project.id for project in projects]
    if not project_ids:
        return list(db.scalars(select(Invoice).where(Invoice.company_id == user.company_id)))
    return list(
        db.scalars(
            select(Invoice).where(
                or_(
                    Invoice.company_id == user.company_id,
                    (Invoice.project_id.in_(project_ids)) & (Invoice.status != "draft"),
                )
            )
        )
    )


@router.post("/projects", status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectIn, db: DbSession, user: CurrentUser) -> dict:
    now = utcnow()
    project = Project(
        owner_company_id=user.company_id,
        name=body.name,
        contractor_name=body.contractor,
        subcontractor_name=body.subcontractor,
        location=body.location or "Location not set",
        service=body.service,
        status=body.status,
        priority=body.priority,
        start_date=body.start_date,
        due_date=body.due_date,
        completed_date=date.today() if body.status in ("finished", "complete") else None,
        contract_cents=body.contract_cents,
        notes=body.notes,
        site_contact=body.site_contact or "No site contact added",
        crew_size=body.crew_size,
        quantity=body.quantity or "Quantity not set",
        invoice_number=body.invoice_number or "Draft",
        created_at=now,
        updated_at=now,
    )
    first_task = "Confirm schedule and release to field" if body.status == "not-started" else "Send field update"
    project.tasks.append(
        Task(title=first_task, owner="Contractor", due_date=body.start_date or body.due_date or date.today())
    )
    if body.notes:
        project.messages.append(Message(sender="Contractor", author_id=user.id, body=f"Project notes: {body.notes}"))
    else:
        project.messages.append(Message(sender="System", body="Project created and ready for coordination."))
    db.add(project)
    db.commit()
    return _out(project, user)


@router.get("/projects/{project_id}")
def get_project(project_id: str, db: DbSession, user: CurrentUser) -> dict:
    project, role = load_project(db, project_id, user)
    return project_out(project, role)


@router.patch("/projects/{project_id}")
def update_project(project_id: str, body: ProjectPatch, db: DbSession, user: CurrentUser) -> dict:
    project, role = load_project(db, project_id, user)
    changes = body.model_dump(exclude_unset=True)

    if role != "Contractor" and CONTRACTOR_ONLY_FIELDS & changes.keys():
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the contractor can change job details.")
    new_status = changes.pop("status", None)
    if new_status == "complete" and role != "Contractor":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the contractor can close out a job as complete.")

    for field, value in changes.items():
        setattr(project, field, value)
    if new_status:
        apply_status(project, new_status)
    touch(project)
    db.commit()
    return project_out(project, role)


@router.post("/projects/{project_id}/tasks", status_code=status.HTTP_201_CREATED)
def add_task(project_id: str, body: TaskIn, db: DbSession, user: CurrentUser) -> dict:
    project, role = load_project(db, project_id, user)
    project.tasks.append(Task(title=body.title, owner=role, due_date=body.due_date or project.due_date or date.today()))
    system_message(project, f"{role} task added: {body.title}")
    db.commit()
    return project_out(project, role)


@router.patch("/projects/{project_id}/tasks/{task_id}")
def update_task(project_id: str, task_id: str, body: TaskPatch, db: DbSession, user: CurrentUser) -> dict:
    project, role = load_project(db, project_id, user)
    task = next((item for item in project.tasks if item.id == task_id), None)
    if not task:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found.")
    task.complete = body.complete
    touch(project)
    db.commit()
    return project_out(project, role)


@router.post("/projects/{project_id}/messages", status_code=status.HTTP_201_CREATED)
def add_message(project_id: str, body: MessageIn, db: DbSession, user: CurrentUser) -> dict:
    project, role = load_project(db, project_id, user)
    project.messages.append(Message(sender=role, author_id=user.id, body=body.body, created_at=utcnow()))
    touch(project)
    db.commit()
    return project_out(project, role)


@router.post("/projects/{project_id}/payments", status_code=status.HTTP_201_CREATED)
def add_payment(project_id: str, body: PaymentIn, db: DbSession, user: CurrentUser) -> dict:
    project, role = load_project(db, project_id, user)
    record_payment(db, project, body.amount_cents, user, note=body.note)
    db.commit()
    return project_out(project, role)


@router.post("/projects/{project_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_documents(
    project_id: str, files: Annotated[list[UploadFile], File()], db: DbSession, user: CurrentUser
) -> dict:
    project, role = load_project(db, project_id, user)
    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose at least one file.")
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    try:
        for upload in files:
            storage_key = new_id()
            path = settings.upload_dir / storage_key
            size = 0
            with path.open("wb") as handle:
                written.append(path)
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > settings.max_upload_bytes:
                        raise HTTPException(
                            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"{upload.filename} is larger than {settings.max_upload_bytes // (1024 * 1024)} MB.",
                        )
                    handle.write(chunk)
            project.documents.append(
                Document(
                    name=(upload.filename or "file")[:300],
                    content_type=(upload.content_type or "application/octet-stream")[:150],
                    size=size,
                    storage_key=storage_key,
                    uploaded_by=role,
                    uploaded_at=utcnow(),
                )
            )
    except BaseException:
        # Don't leave orphaned files behind when an upload fails partway.
        for path in written:
            path.unlink(missing_ok=True)
        raise
    system_message(project, f"{role} uploaded {len(files)} document{'' if len(files) == 1 else 's'}.")
    db.commit()
    return project_out(project, role)


@router.get("/projects/{project_id}/documents/{document_id}")
def download_document(
    project_id: str,
    document_id: str,
    db: DbSession,
    user: CurrentUser,
    download: bool = False,
) -> FileResponse:
    project, _role = load_project(db, project_id, user)
    document = next((item for item in project.documents if item.id == document_id), None)
    path = settings.upload_dir / document.storage_key if document else None
    if not document or not path or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.")
    inline = not download and document.content_type in INLINE_TYPES
    disposition = "inline" if inline else "attachment"
    return FileResponse(
        path,
        media_type=document.content_type if inline else "application/octet-stream",
        headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(document.name)}",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/projects/{project_id}/documents/{document_id}")
def delete_document(project_id: str, document_id: str, db: DbSession, user: CurrentUser) -> dict:
    project, role = load_project(db, project_id, user)
    document = next((item for item in project.documents if item.id == document_id), None)
    if not document:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.")
    if role != "Contractor" and document.uploaded_by != role:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only remove files your side uploaded.")
    path = settings.upload_dir / document.storage_key
    project.documents.remove(document)
    system_message(project, "Document removed from project record.")
    db.commit()
    path.unlink(missing_ok=True)
    return project_out(project, role)


@router.post("/projects/{project_id}/invites", status_code=status.HTTP_201_CREATED)
def create_invite(project_id: str, body: InviteIn, db: DbSession, user: CurrentUser) -> dict:
    project, role = load_project(db, project_id, user)
    if role != "Contractor":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the contractor can invite a subcontractor.")
    token, token_hash = new_invite_token()
    db.add(
        Invite(
            project_id=project.id,
            token_hash=token_hash,
            email=body.email,
            created_by=user.id,
            expires_at=utcnow() + INVITE_LIFETIME,
        )
    )
    db.commit()
    return {"token": token, "link": f"{settings.app_url}/?invite={token}", "expiresInDays": INVITE_LIFETIME.days}


@router.post("/invites/{token}/accept")
def accept_invite(token: str, db: DbSession, user: CurrentUser) -> dict:
    invite = db.scalar(select(Invite).where(Invite.token_hash == hash_invite_token(token)))
    # SQLite returns naive datetimes; they were written as UTC.
    expires = invite.expires_at.replace(tzinfo=invite.expires_at.tzinfo or timezone.utc) if invite else None
    if not invite or invite.accepted_at or not expires or expires < utcnow():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This invite link is invalid, expired, or already used.")
    project = db.get(Project, invite.project_id)
    if not project:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This job no longer exists.")
    if project.owner_company_id == user.company_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't join your own job as its subcontractor.")
    if project.sub_company_id and project.sub_company_id != user.company_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Another subcontractor already joined this job.")

    project.sub_company_id = user.company_id
    invite.accepted_at = utcnow()
    system_message(project, f"{user.company.name} joined as the subcontractor.")
    db.commit()
    return project_out(project, "Subcontractor")
