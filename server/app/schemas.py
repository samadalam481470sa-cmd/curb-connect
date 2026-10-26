"""Request bodies. Field names are camelCase on the wire to match the web app."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from pydantic.alias_generators import to_camel

ServiceType = Literal[
    "Standard curb",
    "Cut curb",
    "Washout",
    "Retaining wall",
    "Sidewalk tie-in",
    "ADA ramp",
    "Demo and haul-off",
    "Other",
]
ProjectStatus = Literal["not-started", "started", "finished", "complete"]
Priority = Literal["normal", "rush", "waiting-on-info"]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, str_strip_whitespace=True)


def _empty_date_to_none(value: object) -> object:
    return None if value == "" else value


class RegisterIn(CamelModel):
    company_name: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str = Field(min_length=10, max_length=200)


class LoginIn(CamelModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class CompanyIn(CamelModel):
    name: str = Field(min_length=1, max_length=200)
    address: str = Field(default="", max_length=1000)
    phone: str = Field(default="", max_length=50)
    email: str = Field(default="", max_length=200)
    payment_instructions: str = Field(default="", max_length=2000)


class ProjectIn(CamelModel):
    name: str = Field(min_length=1, max_length=300)
    contractor: str = Field(min_length=1, max_length=200)
    subcontractor: str = Field(min_length=1, max_length=200)
    location: str = Field(default="", max_length=500)
    service: ServiceType = "Standard curb"
    status: ProjectStatus = "not-started"
    priority: Priority = "normal"
    start_date: date | None = None
    due_date: date | None = None
    contract_cents: int = Field(default=0, ge=0, le=10_000_000_000)
    notes: str = Field(default="", max_length=10_000)
    site_contact: str = Field(default="", max_length=200)
    crew_size: int = Field(default=0, ge=0, le=10_000)
    quantity: str = Field(default="", max_length=300)
    invoice_number: str = Field(default="", max_length=50)

    _dates = field_validator("start_date", "due_date", mode="before")(_empty_date_to_none)


class ProjectPatch(CamelModel):
    """Only the fields sent are changed."""

    name: str | None = Field(default=None, min_length=1, max_length=300)
    location: str | None = Field(default=None, max_length=500)
    service: ServiceType | None = None
    status: ProjectStatus | None = None
    priority: Priority | None = None
    start_date: date | None = None
    due_date: date | None = None
    contract_cents: int | None = Field(default=None, ge=0, le=10_000_000_000)
    notes: str | None = Field(default=None, max_length=10_000)
    site_contact: str | None = Field(default=None, max_length=200)
    crew_size: int | None = Field(default=None, ge=0, le=10_000)
    quantity: str | None = Field(default=None, max_length=300)
    invoice_number: str | None = Field(default=None, max_length=50)

    _dates = field_validator("start_date", "due_date", mode="before")(_empty_date_to_none)


class TaskIn(CamelModel):
    title: str = Field(min_length=1, max_length=300)
    due_date: date | None = None

    _dates = field_validator("due_date", mode="before")(_empty_date_to_none)


class TaskPatch(CamelModel):
    complete: bool


class MessageIn(CamelModel):
    body: str = Field(min_length=1, max_length=10_000)


class PaymentIn(CamelModel):
    amount_cents: int = Field(gt=0, le=10_000_000_000)
    note: str = Field(default="", max_length=300)


class InviteIn(CamelModel):
    email: str = Field(default="", max_length=200)


class InvoiceLineIn(CamelModel):
    description: str = Field(default="", max_length=500)
    quantity: float = Field(default=1, ge=0, le=1_000_000_000)
    unit: str = Field(default="ea", max_length=30)
    unit_price_cents: int = Field(default=0, ge=0, le=10_000_000_000)


class InvoiceIn(CamelModel):
    project_id: str
    number: str | None = Field(default=None, max_length=50)
    issue_date: date | None = None
    due_date: date | None = None
    tax_rate_percent: float = Field(default=0, ge=0, le=100)
    retainage_percent: float = Field(default=0, ge=0, le=100)
    notes: str = Field(default="", max_length=5000)
    line_items: list[InvoiceLineIn] | None = Field(default=None, max_length=200)


class InvoicePatch(CamelModel):
    number: str | None = Field(default=None, min_length=1, max_length=50)
    issue_date: date | None = None
    due_date: date | None = None
    tax_rate_percent: float | None = Field(default=None, ge=0, le=100)
    retainage_percent: float | None = Field(default=None, ge=0, le=100)
    notes: str | None = Field(default=None, max_length=5000)
    line_items: list[InvoiceLineIn] | None = Field(default=None, max_length=200)
