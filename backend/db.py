from sqlmodel import create_engine, SQLModel
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "jobtracker.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"


def get_engine(echo: bool = False):
    # ensure folder exists
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return create_engine(DATABASE_URL, echo=echo, connect_args={"check_same_thread": False})


def create_db_and_tables(engine=None):
    if engine is None:
        engine = get_engine()
    from . import models  # noqa: WPS433 - import models so tables are registered

    SQLModel.metadata.create_all(engine)
