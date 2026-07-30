from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


class Application(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[str] = Field(default=None, index=True)
    company: str
    position: str
    location: Optional[str] = None
    link: Optional[str] = None
    salary: Optional[str] = None
    source_site: Optional[str] = None
    date_applied: Optional[str] = None
    stage: Optional[str] = "Applied"
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class History(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[str] = Field(default=None, index=True)
    application_id: Optional[int] = Field(default=None, index=True)
    event: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
