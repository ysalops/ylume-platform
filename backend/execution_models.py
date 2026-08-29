import datetime as dt
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Execution(Base):
    """
    Registra cada processamento realizado pela Ylume AI.
    """

    __tablename__ = "executions"

    id: Mapped[int] = mapped_column(
        primary_key=True,
    )

    project_id: Mapped[int] = mapped_column(
        ForeignKey(
            "projects.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    source_text: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    structured_data: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
    )

    provider: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
    )

    success: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )

    duration_ms: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    processed_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: dt.datetime.now(dt.timezone.utc),
    )