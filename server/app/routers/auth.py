from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from ..deps import CurrentUser, DbSession
from ..models import Company, User
from ..schemas import CompanyIn, LoginIn, RegisterIn
from ..security import DUMMY_PASSWORD_HASH, create_access_token, hash_password, verify_password
from ..serializers import company_out, user_out

router = APIRouter(prefix="/api", tags=["auth"])


@router.post("/auth/register", status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, db: DbSession) -> dict:
    email = body.email.lower()
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists. Sign in instead.")

    company = Company(name=body.company_name, email=email)
    user = User(company=company, email=email, name=body.name, password_hash=hash_password(body.password), role="owner")
    db.add_all([company, user])
    db.commit()
    return {"token": create_access_token(user.id), "user": user_out(user)}


@router.post("/auth/login")
def login(body: LoginIn, db: DbSession) -> dict:
    user = db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    # Always run the hash so an unknown email takes as long as a wrong password.
    valid = verify_password(body.password, user.password_hash if user else DUMMY_PASSWORD_HASH)
    if not user or not valid:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is incorrect.")
    return {"token": create_access_token(user.id), "user": user_out(user)}


@router.get("/auth/me")
def me(user: CurrentUser) -> dict:
    return user_out(user)


@router.get("/company")
def get_company(user: CurrentUser) -> dict:
    return company_out(user.company)


@router.put("/company")
def update_company(body: CompanyIn, user: CurrentUser, db: DbSession) -> dict:
    if user.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the account owner can change company details.")
    company = user.company
    company.name = body.name
    company.address = body.address
    company.phone = body.phone
    company.email = body.email
    company.payment_instructions = body.payment_instructions
    db.commit()
    return company_out(company)
