import datetime as dt

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(
        primary_key=True,
    )

    owner_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
            name="fk_projects_owner_id_users",
        ),
        nullable=True,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
    )

    context: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    objective: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: dt.datetime.now(dt.timezone.utc),
        nullable=False,
    )

    fields: Mapped[list["OutputField"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="OutputField.position",
    )


class OutputField(Base):
    __tablename__ = "output_fields"

    id: Mapped[int] = mapped_column(
        primary_key=True,
    )

    project_id: Mapped[int] = mapped_column(
        ForeignKey(
            "projects.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(
        String(80),
        nullable=False,
    )

    field_type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    position: Mapped[int] = mapped_column(
        nullable=False,
        default=0,
    )

    project: Mapped["Project"] = relationship(
        back_populates="fields",
    )