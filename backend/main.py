import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session, selectinload

from database import Base, engine, get_db
from models import OutputField as OutputFieldModel
from models import Project as ProjectModel


# CONFIGURAÇÕES

PROJECT_ROOT = Path(__file__).resolve().parents[1]

load_dotenv(PROJECT_ROOT / ".env")

N8N_WEBHOOK_URL = os.getenv(
    "N8N_WEBHOOK_URL",
    "",
).strip()

try:
    N8N_TIMEOUT_SECONDS = float(
        os.getenv("N8N_TIMEOUT_SECONDS", "30"),
    )
except ValueError:
    N8N_TIMEOUT_SECONDS = 30.0


# CICLO DE VIDA DA APLICAÇÃO

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Executa ações ao iniciar e encerrar a API.
    """

    # Cria as tabelas do PostgreSQL caso ainda não existam.
    Base.metadata.create_all(bind=engine)

    # Cliente HTTP reutilizável para comunicação com o n8n.
    app.state.http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(N8N_TIMEOUT_SECONDS),
    )

    yield

    await app.state.http_client.aclose()


# APLICAÇÃO FASTAPI

app = FastAPI(
    title="Ylume API",
    description=(
        "API da plataforma Ylume para estruturação "
        "inteligente de dados."
    ),
    version="0.4.0",
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


# SCHEMAS PYDANTIC

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


class N8NPreviewResponse(BaseModel):
    success: bool = True
    provider: str
    project_name: str | None = None
    structured_data: dict[str, Any]
    source_text: str | None = None
    processed_at: datetime | str | None = None


# FUNÇÕES AUXILIARES

async def send_preview_to_n8n(
    payload: ProjectPreviewRequest,
    http_client: httpx.AsyncClient,
) -> dict[str, Any]:
    """
    Envia o projeto para o webhook de produção do n8n.
    """

    if not N8N_WEBHOOK_URL:
        raise HTTPException(
            status_code=503,
            detail=(
                "N8N_WEBHOOK_URL não foi configurada "
                "no arquivo .env."
            ),
        )

    request_body = payload.model_dump(
        mode="json",
    )

    try:
        response = await http_client.post(
            N8N_WEBHOOK_URL,
            json=request_body,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )

        response.raise_for_status()

    except httpx.ConnectError as error:
        raise HTTPException(
            status_code=503,
            detail=(
                "Não foi possível conectar ao n8n. "
                "Confirme se o container ylume-n8n está ligado "
                "e se o workflow está publicado."
            ),
        ) from error

    except httpx.TimeoutException as error:
        raise HTTPException(
            status_code=504,
            detail=(
                "O n8n demorou mais que o permitido "
                "para responder."
            ),
        ) from error

    except httpx.HTTPStatusError as error:
        status_code = error.response.status_code

        try:
            n8n_error = error.response.json()
        except ValueError:
            n8n_error = error.response.text[:500]

        raise HTTPException(
            status_code=502,
            detail={
                "message": (
                    "O n8n retornou um erro durante "
                    "o processamento."
                ),
                "n8n_status_code": status_code,
                "n8n_response": n8n_error,
            },
        ) from error

    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail=(
                "Ocorreu uma falha de comunicação "
                "entre o FastAPI e o n8n."
            ),
        ) from error

    try:
        response_data = response.json()
    except ValueError as error:
        raise HTTPException(
            status_code=502,
            detail=(
                "O n8n respondeu, mas o conteúdo "
                "não é um JSON válido."
            ),
        ) from error

    try:
        validated_response = N8NPreviewResponse.model_validate(
            response_data,
        )
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail={
                "message": (
                    "O n8n retornou um JSON com estrutura "
                    "diferente da esperada."
                ),
                "received_response": response_data,
            },
        ) from error

    return validated_response.model_dump(
        mode="json",
    )


# ROTAS GERAIS

@app.get("/")
async def root():
    return {
        "message": "Ylume API online",
        "version": "0.4.0",
    }


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ylume-api",
        "version": "0.4.0",
        "n8n_configured": bool(N8N_WEBHOOK_URL),
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


# ROTAS DE PROJETOS

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

    try:
        database.add(project)
        database.commit()
        database.refresh(project)

    except Exception as error:
        database.rollback()

        raise HTTPException(
            status_code=500,
            detail=(
                "Não foi possível salvar o projeto "
                "no PostgreSQL."
            ),
        ) from error

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

    return list(
        database.scalars(query).all(),
    )


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


# ROTA DE PROCESSAMENTO PELO N8N

@app.post("/projects/preview")
async def create_project_preview(
    payload: ProjectPreviewRequest,
    request: Request,
):
    http_client: httpx.AsyncClient = (
        request.app.state.http_client
    )

    n8n_result = await send_preview_to_n8n(
        payload=payload,
        http_client=http_client,
    )

    return {
        **n8n_result,
        "status": "preview_generated",
        "input": {
            "context": payload.context,
            "objective": payload.objective,
            "sample_text": payload.sample_text,
        },
    }