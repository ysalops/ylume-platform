from contextlib import asynccontextmanager
from datetime import date, datetime
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session, selectinload

from database import Base, engine, get_db
from models import OutputField as OutputFieldModel
from models import Project as ProjectModel


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Cria as tabelas caso ainda não existam.
    Base.metadata.create_all(bind=engine)

    yield


app = FastAPI(
    title="Ylume API",
    description=(
        "API da plataforma Ylume para estruturação "
        "inteligente de dados."
    ),
    version="0.3.0",
    lifespan=lifespan,
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class OutputFieldInput(BaseModel):
    name: str = Field(
        min_length=1,
        max_length=80,
    )

    field_type: Literal[
        "text",
        "number",
        "boolean",
        "date",
        "category",
    ]

    description: str | None = Field(
        default=None,
        max_length=300,
    )


class ProjectCreate(BaseModel):
    project_name: str = Field(
        min_length=2,
        max_length=120,
    )

    context: str = Field(
        min_length=5,
        max_length=3000,
    )

    objective: str = Field(
        min_length=5,
        max_length=2000,
    )

    fields: list[OutputFieldInput] = Field(
        min_length=1,
        max_length=30,
    )


class ProjectPreviewRequest(ProjectCreate):
    sample_text: str = Field(
        min_length=1,
        max_length=10000,
    )


class OutputFieldResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    field_type: str
    description: str | None
    position: int


class ProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    context: str
    objective: str
    created_at: datetime
    fields: list[OutputFieldResponse]


def generate_mock_value(field: OutputFieldInput):
    values = {
        "text": f"Conteúdo estruturado para {field.name}",
        "number": 0,
        "boolean": False,
        "date": date.today().isoformat(),
        "category": "Não classificado",
    }

    return values[field.field_type]


@app.get("/")
async def root():
    return {
        "message": "Ylume API online",
        "version": "0.3.0",
    }


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ylume-api",
        "version": "0.3.0",
    }


@app.get("/database/health")
def database_health(
    database: Session = Depends(get_db),
):
    try:
        database.execute(text("SELECT 1"))
    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail="Não foi possível conectar ao PostgreSQL.",
        ) from error

    return {
        "status": "connected",
        "database": "postgresql",
    }


@app.post(
    "/projects",
    response_model=ProjectResponse,
    status_code=201,
)
def create_project(
    payload: ProjectCreate,
    database: Session = Depends(get_db),
):
    project = ProjectModel(
        name=payload.project_name,
        context=payload.context,
        objective=payload.objective,
    )

    project.fields = [
        OutputFieldModel(
            name=field.name,
            field_type=field.field_type,
            description=field.description,
            position=index,
        )
        for index, field in enumerate(payload.fields)
    ]

    database.add(project)
    database.commit()
    database.refresh(project)

    return project


@app.get(
    "/projects",
    response_model=list[ProjectResponse],
)
def list_projects(
    database: Session = Depends(get_db),
):
    query = (
        select(ProjectModel)
        .options(selectinload(ProjectModel.fields))
        .order_by(ProjectModel.created_at.desc())
    )

    return list(database.scalars(query).all())


@app.get(
    "/projects/{project_id}",
    response_model=ProjectResponse,
)
def get_project(
    project_id: int,
    database: Session = Depends(get_db),
):
    query = (
        select(ProjectModel)
        .options(selectinload(ProjectModel.fields))
        .where(ProjectModel.id == project_id)
    )

    project = database.scalar(query)

    if not project:
        raise HTTPException(
            status_code=404,
            detail="Projeto não encontrado.",
        )

    return project


@app.post("/projects/preview")
async def create_project_preview(
    payload: ProjectPreviewRequest,
):
    structured_data = {
        field.name: generate_mock_value(field)
        for field in payload.fields
    }

    return {
        "project_name": payload.project_name,
        "status": "preview_generated",
        "provider": "mock",
        "input": {
            "context": payload.context,
            "objective": payload.objective,
            "sample_text": payload.sample_text,
        },
        "structured_data": structured_data,
    }