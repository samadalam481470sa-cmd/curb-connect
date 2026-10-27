"""Curb Connect API. Run with: uvicorn app.main:app --reload (from the server folder)."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models  # noqa: F401  (registers tables)
from .config import settings
from .db import Base, engine
from .routers import auth, invoices, projects


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Creates missing tables. Schema changes after launch should move to Alembic migrations.
    Base.metadata.create_all(engine)
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Curb Connect API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(invoices.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
