from typing import Annotated, Literal

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from .db import get_db
from .models import Project, User
from .security import decode_access_token

DbSession = Annotated[Session, Depends(get_db)]
Role = Literal["Contractor", "Subcontractor"]


def get_current_user(db: DbSession, authorization: Annotated[str | None, Header()] = None) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sign in to continue.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not authorization or not authorization.lower().startswith("bearer "):
        raise unauthorized
    user_id = decode_access_token(authorization.split(" ", 1)[1].strip())
    if not user_id:
        raise unauthorized
    user = db.get(User, user_id)
    if not user:
        raise unauthorized
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def project_role(project: Project, user: User) -> Role | None:
    if project.owner_company_id == user.company_id:
        return "Contractor"
    if project.sub_company_id == user.company_id:
        return "Subcontractor"
    return None


def load_project(db: Session, project_id: str, user: User) -> tuple[Project, Role]:
    """Returns the job and the caller's side of it. Jobs from other companies look like they don't exist."""
    project = db.get(Project, project_id)
    role = project_role(project, user) if project else None
    if not project or not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
    return project, role
