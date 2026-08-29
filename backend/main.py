import asyncio
import csv
import io
import json
import os
import re
from collections import Counter
from contextlib import asynccontextmanager
from time import perf_counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import delete, select, text, update
from sqlalchemy.orm import Session, selectinload
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font

from auth import (
    clear_auth_cookie,
    create_access_token,
    get_current_user,
    hash_password,
    normalize_email,
    set_auth_cookie,
    validate_auth_configuration,
    verify_password,
)
from auth_models import User as UserModel
from auth_schema import ensure_auth_schema
from database import Base, engine, get_db
from execution_models import Execution as ExecutionModel
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
        os.getenv("N8N_TIMEOUT_SECONDS", "120"),
    )
except ValueError:
    N8N_TIMEOUT_SECONDS = 120.0



ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        (
            "http://localhost:5173,"
            "http://127.0.0.1:5173,"
            "http://localhost:5174,"
            "http://127.0.0.1:5174"
        ),
    ).split(",")
    if origin.strip()
]


ALLOW_LOCAL_PROJECT_CLAIM = (
    os.getenv(
        "ALLOW_LOCAL_PROJECT_CLAIM",
        "false",
    )
    .strip()
    .lower()
    in {
        "1",
        "true",
        "yes",
        "on",
    }
)


# CICLO DE VIDA DA APLICAÇÃO

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Executa ações ao iniciar e encerrar a API.
    """

    validate_auth_configuration()

    # Cria novas tabelas que ainda não existam, como users.
    Base.metadata.create_all(bind=engine)

    # Adiciona owner_id ao banco local existente de forma
    # idempotente, preservando os projetos atuais.
    ensure_auth_schema()

    # Cliente HTTP reutilizável para comunicação com o n8n.
    app.state.http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(
            N8N_TIMEOUT_SECONDS,
        ),
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
    version="1.1.0",
    lifespan=lifespan,
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers_and_origin_guard(
    request: Request,
    call_next,
):
    unsafe_methods = {
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
    }

    origin = request.headers.get(
        "origin",
    )

    if (
        request.method
        in unsafe_methods
        and origin
        and origin
        not in ALLOWED_ORIGINS
    ):
        return Response(
            content=(
                "Origem não autorizada."
            ),
            status_code=403,
            media_type="text/plain",
        )

    response = await call_next(
        request,
    )

    response.headers[
        "X-Content-Type-Options"
    ] = "nosniff"

    response.headers[
        "X-Frame-Options"
    ] = "DENY"

    response.headers[
        "Referrer-Policy"
    ] = "no-referrer"

    response.headers[
        "Permissions-Policy"
    ] = (
        "camera=(), microphone=(), "
        "geolocation=()"
    )

    return response


# SCHEMAS PYDANTIC

class RegisterRequest(BaseModel):
    display_name: str = Field(
        min_length=2,
        max_length=120,
    )

    email: EmailStr

    password: str = Field(
        min_length=10,
        max_length=128,
    )


class LoginRequest(BaseModel):
    email: EmailStr

    password: str = Field(
        min_length=1,
        max_length=128,
    )


class AuthUserResponse(BaseModel):
    id: int
    email: str
    display_name: str
    created_at: datetime
    can_claim_local_projects: bool


class ClaimProjectsResponse(BaseModel):
    claimed_projects: int


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
    project_id: int = Field(
        gt=0,
    )

    sample_text: str = Field(
        min_length=1,
        max_length=10000,
    )


class BatchProcessRequest(BaseModel):
    texts: list[str] = Field(
        min_length=1,
        max_length=25,
    )

    source_name: str | None = Field(
        default=None,
        max_length=255,
    )


class OutputFieldResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )

    id: int
    name: str
    field_type: str
    description: str | None
    position: int


class ProjectResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )

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


class ExecutionResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )

    id: int
    project_id: int
    source_text: str
    structured_data: dict[str, Any]
    provider: str
    success: bool
    duration_ms: int | None
    processed_at: datetime



class DashboardMetricsResponse(BaseModel):
    total_executions: int
    successful_executions: int
    failed_executions: int
    success_rate: float
    average_duration_ms: int | None
    latest_processed_at: datetime | None


class DashboardProviderResponse(BaseModel):
    provider: str
    count: int
    percentage: float


class DashboardDistributionItem(BaseModel):
    label: str
    count: int
    percentage: float


class DashboardFieldInsight(BaseModel):
    name: str
    field_type: str
    total_values: int
    missing_values: int
    coverage_rate: float
    unique_values: int
    distribution: list[DashboardDistributionItem]
    numeric_min: float | None = None
    numeric_max: float | None = None
    numeric_average: float | None = None


class BatchItemResponse(BaseModel):
    row_number: int
    success: bool
    execution_id: int | None
    duration_ms: int | None
    structured_data: dict[str, Any] | None
    error: str | None


class BatchProcessResponse(BaseModel):
    project_id: int
    source_name: str | None
    total_rows: int
    successful_rows: int
    failed_rows: int
    total_duration_ms: int
    items: list[BatchItemResponse]


class DatasetFieldResponse(BaseModel):
    name: str
    field_type: str
    description: str | None


class DatasetRowResponse(BaseModel):
    execution_id: int
    project_id: int
    source_text: str
    structured_data: dict[str, Any]
    values: dict[str, Any]
    provider: str
    success: bool
    error: str | None
    duration_ms: int | None
    processed_at: datetime


class ProjectDatasetResponse(BaseModel):
    project_id: int
    project_name: str
    total_rows: int
    fields: list[DatasetFieldResponse]
    rows: list[DatasetRowResponse]


class ProjectDashboardResponse(BaseModel):
    project_id: int
    project_name: str
    field_count: int
    metrics: DashboardMetricsResponse
    providers: list[DashboardProviderResponse]
    field_insights: list[DashboardFieldInsight]
    recent_executions: list[ExecutionResponse]


# FUNÇÕES AUXILIARES

def build_preview_payload(
    project: ProjectModel,
    sample_text: str,
) -> ProjectPreviewRequest:
    return ProjectPreviewRequest(
        project_id=project.id,
        project_name=project.name,
        context=project.context,
        objective=project.objective,
        fields=[
            OutputFieldInput(
                name=field.name,
                field_type=field.field_type,
                description=field.description,
            )
            for field in project.fields
        ],
        sample_text=sample_text,
    )


def normalize_whitespace(
    value: str,
) -> str:
    return " ".join(
        value.strip().split(),
    )


def normalize_value_label(
    value: Any,
) -> str:
    if isinstance(value, bool):
        return "Sim" if value else "Não"

    if isinstance(value, (dict, list)):
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
        )

    return normalize_whitespace(
        str(value),
    )


def canonical_boolean_label(
    value: Any,
) -> str:
    if isinstance(value, bool):
        return "Sim" if value else "Não"

    normalized = (
        normalize_value_label(value)
        .casefold()
    )

    yes_values = {
        "sim",
        "s",
        "yes",
        "y",
        "true",
        "1",
    }

    no_values = {
        "não",
        "nao",
        "n",
        "no",
        "false",
        "0",
    }

    if normalized in yes_values:
        return "Sim"

    if normalized in no_values:
        return "Não"

    return normalize_value_label(
        value,
    )


def normalized_distribution(
    values: list[Any],
    field_type: str,
) -> list[tuple[str, int]]:
    """
    Agrupa rótulos equivalentes sem alterar
    o dado bruto salvo no PostgreSQL.
    """

    grouped: dict[
        str,
        dict[str, Any],
    ] = {}

    for value in values:
        label = (
            canonical_boolean_label(
                value,
            )
            if field_type == "boolean"
            else normalize_value_label(
                value,
            )
        )

        key = label.casefold()

        if key not in grouped:
            grouped[key] = {
                "label": label,
                "count": 0,
            }

        grouped[key]["count"] += 1

    return sorted(
        (
            (
                item["label"],
                item["count"],
            )
            for item in grouped.values()
        ),
        key=lambda item: (
            -item[1],
            item[0].casefold(),
        ),
    )


def get_structured_value(
    structured_data: dict[str, Any],
    field_name: str,
) -> Any:
    if field_name in structured_data:
        return structured_data[field_name]

    expected_key = (
        field_name.strip().casefold()
    )

    for key, value in structured_data.items():
        if (
            str(key).strip().casefold()
            == expected_key
        ):
            return value

    return None


def is_missing_value(
    value: Any,
) -> bool:
    if value is None:
        return True

    if isinstance(value, str):
        normalized = (
            value.strip().casefold()
        )

        return normalized in {
            "",
            "null",
            "none",
            "undefined",
        }

    return False


def build_dataset_row(
    project: ProjectModel,
    execution: ExecutionModel,
) -> DatasetRowResponse:
    structured_data = (
        execution.structured_data
        or {}
    )

    values: dict[str, Any] = {}

    for field in project.fields:
        value = get_structured_value(
            structured_data,
            field.name,
        )

        values[field.name] = (
            None
            if is_missing_value(value)
            else value
        )

    execution_error = (
        structured_data.get(
            "_error",
        )
        if isinstance(
            structured_data,
            dict,
        )
        else None
    )

    return DatasetRowResponse(
        execution_id=execution.id,
        project_id=execution.project_id,
        source_text=execution.source_text,
        structured_data=structured_data,
        values=values,
        provider=execution.provider,
        success=execution.success,
        error=(
            str(execution_error)
            if execution_error
            else None
        ),
        duration_ms=execution.duration_ms,
        processed_at=execution.processed_at,
    )


def safe_export_filename(
    project_name: str,
) -> str:
    normalized = re.sub(
        r"[^A-Za-z0-9_-]+",
        "_",
        project_name.strip(),
    ).strip("_")

    return (
        normalized.lower()
        or "ylume_dataset"
    )


def serialize_export_value(
    value: Any,
) -> str | int | float | bool | None:
    if is_missing_value(value):
        return None

    if isinstance(
        value,
        (
            str,
            int,
            float,
            bool,
        ),
    ):
        return value

    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
    )


def serialize_auth_user(
    user: UserModel,
) -> AuthUserResponse:
    return AuthUserResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        created_at=user.created_at,
        can_claim_local_projects=(
            ALLOW_LOCAL_PROJECT_CLAIM
        ),
    )


def get_owned_project(
    project_id: int,
    database: Session,
    owner_id: int,
) -> ProjectModel:
    query = (
        select(ProjectModel)
        .where(
            ProjectModel.id
            == project_id,
            ProjectModel.owner_id
            == owner_id,
        )
    )

    project = database.scalar(
        query,
    )

    if not project:
        raise HTTPException(
            status_code=404,
            detail="Projeto não encontrado.",
        )

    return project


def get_project_with_fields(
    project_id: int,
    database: Session,
    owner_id: int,
) -> ProjectModel:
    query = (
        select(ProjectModel)
        .options(
            selectinload(
                ProjectModel.fields,
            ),
        )
        .where(
            ProjectModel.id
            == project_id,
            ProjectModel.owner_id
            == owner_id,
        )
    )

    project = database.scalar(
        query,
    )

    if not project:
        raise HTTPException(
            status_code=404,
            detail="Projeto não encontrado.",
        )

    return project


def get_project_executions(
    project_id: int,
    database: Session,
) -> list[ExecutionModel]:
    query = (
        select(ExecutionModel)
        .where(
            ExecutionModel.project_id
            == project_id,
        )
        .order_by(
            ExecutionModel.processed_at.desc(),
        )
    )

    return list(
        database.scalars(
            query,
        ).all(),
    )


def build_field_insight(
    field: OutputFieldModel,
    executions: list[ExecutionModel],
) -> DashboardFieldInsight:
    raw_values: list[Any] = []

    for execution in executions:
        if not execution.success:
            continue

        value = get_structured_value(
            execution.structured_data or {},
            field.name,
        )

        if is_missing_value(
            value,
        ):
            continue

        raw_values.append(value)

    successful_total = sum(
        1
        for execution in executions
        if execution.success
    )

    total_values = len(raw_values)
    missing_values = max(
        successful_total - total_values,
        0,
    )

    coverage_rate = (
        round(
            total_values
            / successful_total
            * 100,
            1,
        )
        if successful_total
        else 0.0
    )

    labels = [
        (
            canonical_boolean_label(
                value,
            )
            if field.field_type
            == "boolean"
            else normalize_value_label(
                value,
            )
        )
        for value in raw_values
    ]

    unique_values = len(
        {
            label.casefold()
            for label in labels
        },
    )

    distribution: list[DashboardDistributionItem] = []
    numeric_min: float | None = None
    numeric_max: float | None = None
    numeric_average: float | None = None

    if field.field_type == "number":
        numeric_values: list[float] = []

        for value in raw_values:
            if isinstance(value, bool):
                continue

            if isinstance(value, (int, float)):
                numeric_values.append(
                    float(value),
                )
                continue

            if isinstance(value, str):
                candidate = value.strip()

                if (
                    "," in candidate
                    and "." in candidate
                ):
                    candidate = (
                        candidate
                        .replace(".", "")
                        .replace(",", ".")
                    )
                elif "," in candidate:
                    candidate = (
                        candidate
                        .replace(",", ".")
                    )

                try:
                    numeric_values.append(
                        float(candidate),
                    )
                except ValueError:
                    pass

        if numeric_values:
            numeric_min = round(
                min(numeric_values),
                2,
            )
            numeric_max = round(
                max(numeric_values),
                2,
            )
            numeric_average = round(
                sum(numeric_values)
                / len(numeric_values),
                2,
            )

    should_build_distribution = (
        field.field_type
        in {"category", "boolean", "date"}
        or (
            field.field_type == "text"
            and unique_values <= 12
            and unique_values < total_values
        )
    )

    if (
        should_build_distribution
        and labels
    ):
        normalized_counts = (
            normalized_distribution(
                raw_values,
                field.field_type,
            )
        )

        most_common = (
            normalized_counts[:7]
        )

        represented = sum(
            count
            for _, count in most_common
        )

        distribution = [
            DashboardDistributionItem(
                label=label,
                count=count,
                percentage=round(
                    count
                    / total_values
                    * 100,
                    1,
                ),
            )
            for label, count in most_common
        ]

        remaining = (
            total_values - represented
        )

        if remaining > 0:
            distribution.append(
                DashboardDistributionItem(
                    label="Outros",
                    count=remaining,
                    percentage=round(
                        remaining
                        / total_values
                        * 100,
                        1,
                    ),
                ),
            )

    return DashboardFieldInsight(
        name=field.name,
        field_type=field.field_type,
        total_values=total_values,
        missing_values=missing_values,
        coverage_rate=coverage_rate,
        unique_values=unique_values,
        distribution=distribution,
        numeric_min=numeric_min,
        numeric_max=numeric_max,
        numeric_average=numeric_average,
    )


def exception_detail_to_text(
    error: HTTPException,
) -> str:
    detail = error.detail

    if isinstance(detail, str):
        return detail

    if isinstance(detail, dict):
        message = detail.get("message")
        if message:
            return str(message)

    return str(detail)



async def send_preview_to_n8n(
    payload: ProjectPreviewRequest,
    http_client: httpx.AsyncClient,
) -> dict[str, Any]:
    """
    Envia o conteúdo para o workflow de produção
    do n8n e devolve a resposta estruturada.
    """

    if not N8N_WEBHOOK_URL:
        raise HTTPException(
            status_code=503,
            detail=(
                "N8N_WEBHOOK_URL não foi configurada "
                "no arquivo .env."
            ),
        )

    # project_id é usado somente pelo backend.
    # O workflow atual do n8n continua recebendo
    # o mesmo formato que já funciona hoje.
    request_body = payload.model_dump(
        mode="json",
        exclude={"project_id"},
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
                "Confirme se o container ylume-n8n "
                "está ligado e se o workflow está publicado."
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
        status_code = (
            error.response.status_code
        )

        try:
            n8n_error = (
                error.response.json()
            )
        except ValueError:
            n8n_error = (
                error.response.text[:500]
            )

        raise HTTPException(
            status_code=502,
            detail={
                "message": (
                    "O n8n retornou um erro "
                    "durante o processamento."
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
        validated_response = (
            N8NPreviewResponse.model_validate(
                response_data,
            )
        )

    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail={
                "message": (
                    "O n8n retornou um JSON com "
                    "estrutura diferente da esperada."
                ),
                "received_response": (
                    response_data
                ),
            },
        ) from error

    return validated_response.model_dump(
        mode="json",
    )


# AUTENTICAÇÃO

@app.post(
    "/auth/register",
    response_model=AuthUserResponse,
    status_code=201,
)
def register_user(
    payload: RegisterRequest,
    response: Response,
    database: Session = Depends(
        get_db,
    ),
):
    email = normalize_email(
        str(payload.email),
    )

    existing_user = database.scalar(
        select(UserModel).where(
            UserModel.email == email,
        ),
    )

    if existing_user:
        raise HTTPException(
            status_code=409,
            detail=(
                "Já existe uma conta "
                "com este e-mail."
            ),
        )

    user = UserModel(
        email=email,
        display_name=(
            payload.display_name.strip()
        ),
        password_hash=hash_password(
            payload.password,
        ),
    )

    try:
        database.add(user)
        database.commit()
        database.refresh(user)

        if ALLOW_LOCAL_PROJECT_CLAIM:
            database.execute(
                update(ProjectModel)
                .where(
                    ProjectModel.owner_id
                    .is_(None),
                )
                .values(
                    owner_id=user.id,
                ),
            )
            database.commit()

    except Exception as error:
        database.rollback()

        raise HTTPException(
            status_code=500,
            detail=(
                "Não foi possível criar "
                "a conta."
            ),
        ) from error

    token = create_access_token(
        user.id,
    )

    set_auth_cookie(
        response,
        token,
    )

    return serialize_auth_user(
        user,
    )


@app.post(
    "/auth/login",
    response_model=AuthUserResponse,
)
def login_user(
    payload: LoginRequest,
    response: Response,
    database: Session = Depends(
        get_db,
    ),
):
    email = normalize_email(
        str(payload.email),
    )

    user = database.scalar(
        select(UserModel).where(
            UserModel.email == email,
        ),
    )

    if (
        not user
        or not verify_password(
            payload.password,
            user.password_hash,
        )
    ):
        raise HTTPException(
            status_code=401,
            detail=(
                "E-mail ou senha inválidos."
            ),
        )

    if not user.is_active:
        raise HTTPException(
            status_code=403,
            detail="Conta desativada.",
        )

    user.last_login_at = (
        datetime.now(
            timezone.utc,
        )
    )

    database.commit()

    token = create_access_token(
        user.id,
    )

    set_auth_cookie(
        response,
        token,
    )

    return serialize_auth_user(
        user,
    )


@app.post(
    "/auth/logout",
    status_code=204,
)
def logout_user(
    response: Response,
):
    clear_auth_cookie(
        response,
    )

    return None


@app.get(
    "/auth/me",
    response_model=AuthUserResponse,
)
def get_my_account(
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    return serialize_auth_user(
        current_user,
    )


@app.post(
    "/auth/claim-local-projects",
    response_model=ClaimProjectsResponse,
)
def claim_local_projects(
    database: Session = Depends(
        get_db,
    ),
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    if not ALLOW_LOCAL_PROJECT_CLAIM:
        raise HTTPException(
            status_code=403,
            detail=(
                "Importação de projetos "
                "locais está desativada."
            ),
        )

    result = database.execute(
        update(ProjectModel)
        .where(
            ProjectModel.owner_id
            .is_(None),
        )
        .values(
            owner_id=current_user.id,
        ),
    )

    database.commit()

    return ClaimProjectsResponse(
        claimed_projects=(
            result.rowcount or 0
        ),
    )


# ROTAS GERAIS

@app.get("/")
async def root():
    return {
        "message": "Ylume API online",
        "version": "1.1.0",
    }


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ylume-api",
        "version": "1.1.0",
        "n8n_configured": bool(
            N8N_WEBHOOK_URL,
        ),
    }


@app.get("/database/health")
def database_health(
    database: Session = Depends(
        get_db,
    ),
):
    try:
        database.execute(
            text("SELECT 1"),
        )

    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail=(
                "Não foi possível conectar "
                "ao PostgreSQL."
            ),
        ) from error

    return {
        "status": "connected",
        "database": "postgresql",
    }


# CRIAR PROJETO

@app.post(
    "/projects",
    response_model=ProjectResponse,
    status_code=201,
)
def create_project(
    payload: ProjectCreate,
    database: Session = Depends(
        get_db,
    ),
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    project = ProjectModel(
        owner_id=current_user.id,
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
        for index, field in enumerate(
            payload.fields,
        )
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
                "Não foi possível salvar "
                "o projeto no PostgreSQL."
            ),
        ) from error

    return project


# ATUALIZAR PROJETO

@app.put(
    "/projects/{project_id}",
    response_model=ProjectResponse,
)
def update_project(
    project_id: int,
    payload: ProjectCreate,
    database: Session = Depends(
        get_db,
    ),
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    query = (
        select(ProjectModel)
        .options(
            selectinload(
                ProjectModel.fields,
            ),
        )
        .where(
            ProjectModel.id
            == project_id,
            ProjectModel.owner_id
            == current_user.id,
        )
    )

    project = database.scalar(
        query,
    )

    if not project:
        raise HTTPException(
            status_code=404,
            detail="Projeto não encontrado.",
        )

    try:
        # Atualiza os dados principais.
        project.name = (
            payload.project_name
        )

        project.context = (
            payload.context
        )

        project.objective = (
            payload.objective
        )

        # Remove os campos antigos.
        for existing_field in list(
            project.fields,
        ):
            database.delete(
                existing_field,
            )

        database.flush()

        # Cria novamente a estrutura
        # de campos recebida do frontend.
        project.fields = [
            OutputFieldModel(
                name=field.name,
                field_type=(
                    field.field_type
                ),
                description=(
                    field.description
                ),
                position=index,
            )
            for index, field in enumerate(
                payload.fields,
            )
        ]

        database.commit()

    except Exception as error:
        database.rollback()

        raise HTTPException(
            status_code=500,
            detail=(
                "Não foi possível atualizar "
                "o projeto."
            ),
        ) from error

    # Busca novamente o projeto
    # já atualizado e com os campos.
    updated_query = (
        select(ProjectModel)
        .options(
            selectinload(
                ProjectModel.fields,
            ),
        )
        .where(
            ProjectModel.id
            == project_id,
            ProjectModel.owner_id
            == current_user.id,
        )
    )

    updated_project = (
        database.scalar(
            updated_query,
        )
    )

    return updated_project


# LISTAR PROJETOS

@app.get(
    "/projects",
    response_model=list[
        ProjectResponse
    ],
)
def list_projects(
    database: Session = Depends(
        get_db,
    ),
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    query = (
        select(ProjectModel)
        .options(
            selectinload(
                ProjectModel.fields,
            ),
        )
        .where(
            ProjectModel.owner_id
            == current_user.id,
        )
        .order_by(
            ProjectModel.created_at.desc(),
        )
    )

    projects = (
        database.scalars(
            query,
        ).all()
    )

    return list(projects)


# LISTAR EXECUÇÕES DE UM PROJETO

@app.get(
    "/projects/{project_id}/executions",
    response_model=list[ExecutionResponse],
)
def list_project_executions(
    project_id: int,
    database: Session = Depends(
        get_db,
    ),
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    get_owned_project(
        project_id,
        database,
        current_user.id,
    )

    query = (
        select(ExecutionModel)
        .where(
            ExecutionModel.project_id
            == project_id,
        )
        .order_by(
            ExecutionModel.processed_at.desc(),
        )
    )

    return list(
        database.scalars(query).all(),
    )


# DATASET DO PROJETO

@app.get(
    "/projects/{project_id}/dataset",
    response_model=ProjectDatasetResponse,
)
def get_project_dataset(
    project_id: int,
    database: Session = Depends(
        get_db,
    ),
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    project = get_project_with_fields(
        project_id,
        database,
        current_user.id,
    )

    executions = (
        get_project_executions(
            project_id,
            database,
        )
    )

    rows = [
        build_dataset_row(
            project,
            execution,
        )
        for execution in executions
    ]

    return ProjectDatasetResponse(
        project_id=project.id,
        project_name=project.name,
        total_rows=len(rows),
        fields=[
            DatasetFieldResponse(
                name=field.name,
                field_type=field.field_type,
                description=field.description,
            )
            for field in project.fields
        ],
        rows=rows,
    )


# EXPORTAÇÃO CSV

@app.get(
    "/projects/{project_id}/export/csv",
)
def export_project_csv(
    project_id: int,
    database: Session = Depends(
        get_db,
    ),
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    project = get_project_with_fields(
        project_id,
        database,
        current_user.id,
    )

    executions = (
        get_project_executions(
            project_id,
            database,
        )
    )

    output = io.StringIO(
        newline="",
    )

    writer = csv.writer(
        output,
        delimiter=",",
        quotechar='"',
        quoting=csv.QUOTE_MINIMAL,
    )

    headers = [
        "execution_id",
        "source_text",
        *[
            field.name
            for field in project.fields
        ],
        "provider",
        "success",
        "duration_ms",
        "processed_at",
    ]

    writer.writerow(
        headers,
    )

    for execution in executions:
        row = build_dataset_row(
            project,
            execution,
        )

        writer.writerow(
            [
                row.execution_id,
                row.source_text,
                *[
                    serialize_export_value(
                        row.values.get(
                            field.name,
                        ),
                    )
                    for field
                    in project.fields
                ],
                row.provider,
                row.success,
                row.duration_ms,
                row.processed_at.isoformat(),
            ],
        )

    content = (
        "\ufeff"
        + output.getvalue()
    ).encode("utf-8")

    filename = (
        f"{safe_export_filename(project.name)}"
        "_dataset.csv"
    )

    return Response(
        content=content,
        media_type=(
            "text/csv; charset=utf-8"
        ),
        headers={
            "Content-Disposition":
                f'attachment; filename="{filename}"',
        },
    )


# EXPORTAÇÃO JSON

@app.get(
    "/projects/{project_id}/export/json",
)
def export_project_json(
    project_id: int,
    database: Session = Depends(
        get_db,
    ),
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    project = get_project_with_fields(
        project_id,
        database,
        current_user.id,
    )

    executions = (
        get_project_executions(
            project_id,
            database,
        )
    )

    rows = [
        build_dataset_row(
            project,
            execution,
        )
        for execution in executions
    ]

    payload = {
        "project": {
            "id": project.id,
            "name": project.name,
        },
        "fields": [
            {
                "name": field.name,
                "field_type":
                    field.field_type,
                "description":
                    field.description,
            }
            for field in project.fields
        ],
        "total_rows": len(rows),
        "rows": [
            {
                "execution_id":
                    row.execution_id,
                "source_text":
                    row.source_text,
                **{
                    field.name:
                        row.values.get(
                            field.name,
                        )
                    for field
                    in project.fields
                },
                "provider":
                    row.provider,
                "success":
                    row.success,
                "duration_ms":
                    row.duration_ms,
                "processed_at":
                    row.processed_at.isoformat(),
            }
            for row in rows
        ],
    }

    content = json.dumps(
        payload,
        ensure_ascii=False,
        indent=2,
        default=str,
    ).encode("utf-8")

    filename = (
        f"{safe_export_filename(project.name)}"
        "_dataset.json"
    )

    return Response(
        content=content,
        media_type=(
            "application/json; charset=utf-8"
        ),
        headers={
            "Content-Disposition":
                f'attachment; filename="{filename}"',
        },
    )


# EXPORTAÇÃO EXCEL

@app.get(
    "/projects/{project_id}/export/xlsx",
)
def export_project_xlsx(
    project_id: int,
    database: Session = Depends(
        get_db,
    ),
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    project = get_project_with_fields(
        project_id,
        database,
        current_user.id,
    )

    executions = (
        get_project_executions(
            project_id,
            database,
        )
    )

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Dataset"

    headers = [
        "execution_id",
        "source_text",
        *[
            field.name
            for field in project.fields
        ],
        "provider",
        "success",
        "duration_ms",
        "processed_at",
    ]

    sheet.append(
        headers,
    )

    for cell in sheet[1]:
        cell.font = Font(
            bold=True,
        )
        cell.alignment = Alignment(
            vertical="top",
        )

    for execution in executions:
        row = build_dataset_row(
            project,
            execution,
        )

        sheet.append(
            [
                row.execution_id,
                row.source_text,
                *[
                    serialize_export_value(
                        row.values.get(
                            field.name,
                        ),
                    )
                    for field
                    in project.fields
                ],
                row.provider,
                row.success,
                row.duration_ms,
                row.processed_at.replace(
                    tzinfo=None,
                ),
            ],
        )

    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = (
        sheet.dimensions
    )

    for column_cells in sheet.columns:
        max_length = 0

        for cell in column_cells:
            value = (
                ""
                if cell.value is None
                else str(cell.value)
            )

            max_length = max(
                max_length,
                len(value),
            )

            cell.alignment = Alignment(
                vertical="top",
                wrap_text=True,
            )

        column_letter = (
            column_cells[0]
            .column_letter
        )

        sheet.column_dimensions[
            column_letter
        ].width = min(
            max(max_length + 2, 12),
            45,
        )

    buffer = io.BytesIO()

    workbook.save(
        buffer,
    )

    filename = (
        f"{safe_export_filename(project.name)}"
        "_dataset.xlsx"
    )

    return Response(
        content=buffer.getvalue(),
        media_type=(
            "application/vnd.openxmlformats-"
            "officedocument.spreadsheetml.sheet"
        ),
        headers={
            "Content-Disposition":
                f'attachment; filename="{filename}"',
        },
    )


# DASHBOARD DO PROJETO

@app.get(
    "/projects/{project_id}/dashboard",
    response_model=ProjectDashboardResponse,
)
def get_project_dashboard(
    project_id: int,
    database: Session = Depends(
        get_db,
    ),
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    project_query = (
        select(ProjectModel)
        .options(
            selectinload(
                ProjectModel.fields,
            ),
        )
        .where(
            ProjectModel.id
            == project_id,
            ProjectModel.owner_id
            == current_user.id,
        )
    )

    project = database.scalar(
        project_query,
    )

    if not project:
        raise HTTPException(
            status_code=404,
            detail="Projeto não encontrado.",
        )

    execution_query = (
        select(ExecutionModel)
        .where(
            ExecutionModel.project_id
            == project_id,
        )
        .order_by(
            ExecutionModel.processed_at.desc(),
        )
    )

    executions = list(
        database.scalars(
            execution_query,
        ).all(),
    )

    total_executions = len(
        executions,
    )

    successful_executions = sum(
        1
        for execution in executions
        if execution.success
    )

    failed_executions = (
        total_executions
        - successful_executions
    )

    success_rate = (
        round(
            (
                successful_executions
                / total_executions
            )
            * 100,
            1,
        )
        if total_executions
        else 0.0
    )

    durations = [
        execution.duration_ms
        for execution in executions
        if execution.duration_ms
        is not None
    ]

    average_duration_ms = (
        round(
            sum(durations)
            / len(durations),
        )
        if durations
        else None
    )

    latest_processed_at = (
        executions[0].processed_at
        if executions
        else None
    )

    provider_counts = Counter(
        execution.provider
        for execution in executions
    )

    providers = [
        DashboardProviderResponse(
            provider=provider,
            count=count,
            percentage=(
                round(
                    (
                        count
                        / total_executions
                    )
                    * 100,
                    1,
                )
                if total_executions
                else 0.0
            ),
        )
        for provider, count
        in provider_counts.most_common()
    ]

    field_insights = [
        build_field_insight(
            field,
            executions,
        )
        for field in project.fields
    ]

    recent_executions = (
        executions[:10]
    )

    return ProjectDashboardResponse(
        project_id=project.id,
        project_name=project.name,
        field_count=len(
            project.fields,
        ),
        metrics=DashboardMetricsResponse(
            total_executions=(
                total_executions
            ),
            successful_executions=(
                successful_executions
            ),
            failed_executions=(
                failed_executions
            ),
            success_rate=success_rate,
            average_duration_ms=(
                average_duration_ms
            ),
            latest_processed_at=(
                latest_processed_at
            ),
        ),
        providers=providers,
        field_insights=(
            field_insights
        ),
        recent_executions=(
            recent_executions
        ),
    )


# BUSCAR UMA EXECUÇÃO

@app.get(
    "/executions/{execution_id}",
    response_model=ExecutionResponse,
)
def get_execution(
    execution_id: int,
    database: Session = Depends(
        get_db,
    ),
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    query = (
        select(ExecutionModel)
        .join(
            ProjectModel,
            ProjectModel.id
            == ExecutionModel.project_id,
        )
        .where(
            ExecutionModel.id
            == execution_id,
            ProjectModel.owner_id
            == current_user.id,
        )
    )

    execution = database.scalar(
        query,
    )

    if not execution:
        raise HTTPException(
            status_code=404,
            detail="Execução não encontrada.",
        )

    return execution


# EXCLUIR UMA EXECUÇÃO

@app.delete(
    "/executions/{execution_id}",
    status_code=204,
)
def delete_execution(
    execution_id: int,
    database: Session = Depends(
        get_db,
    ),
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    query = (
        select(ExecutionModel)
        .join(
            ProjectModel,
            ProjectModel.id
            == ExecutionModel.project_id,
        )
        .where(
            ExecutionModel.id
            == execution_id,
            ProjectModel.owner_id
            == current_user.id,
        )
    )

    execution = database.scalar(
        query,
    )

    if not execution:
        raise HTTPException(
            status_code=404,
            detail="Execução não encontrada.",
        )

    try:
        database.delete(
            execution,
        )
        database.commit()

    except Exception as error:
        database.rollback()

        raise HTTPException(
            status_code=500,
            detail=(
                "Não foi possível excluir "
                "a execução."
            ),
        ) from error

    return None


# BUSCAR PROJETO

@app.get(
    "/projects/{project_id}",
    response_model=ProjectResponse,
)
def get_project(
    project_id: int,
    database: Session = Depends(
        get_db,
    ),
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    query = (
        select(ProjectModel)
        .options(
            selectinload(
                ProjectModel.fields,
            ),
        )
        .where(
            ProjectModel.id
            == project_id,
            ProjectModel.owner_id
            == current_user.id,
        )
    )

    project = database.scalar(
        query,
    )

    if not project:
        raise HTTPException(
            status_code=404,
            detail="Projeto não encontrado.",
        )

    return project

# EXCLUIR PROJETO

@app.delete(
    "/projects/{project_id}",
    status_code=204,
)
def delete_project(
    project_id: int,
    database: Session = Depends(get_db),
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    query = (
        select(ProjectModel)
        .options(
            selectinload(
                ProjectModel.fields,
            ),
        )
        .where(
            ProjectModel.id
            == project_id,
            ProjectModel.owner_id
            == current_user.id,
        )
    )

    project = database.scalar(query)

    if not project:
        raise HTTPException(
            status_code=404,
            detail="Projeto não encontrado.",
        )

    try:
        # Remove as execuções do projeto.
        database.execute(
            delete(ExecutionModel).where(
                ExecutionModel.project_id
                == project_id,
            ),
        )

        # Remove os campos associados.
        for field in list(project.fields):
            database.delete(field)

        database.flush()

        # Depois remove o projeto.
        database.delete(project)

        database.commit()

    except Exception as error:
        database.rollback()

        raise HTTPException(
            status_code=500,
            detail=(
                "Não foi possível excluir "
                "o projeto."
            ),
        ) from error

    return None

# LIMPAR EXECUÇÕES DE UM PROJETO

@app.delete(
    "/projects/{project_id}/executions",
    status_code=204,
)
def delete_project_executions(
    project_id: int,
    database: Session = Depends(
        get_db,
    ),
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    get_owned_project(
        project_id,
        database,
        current_user.id,
    )

    try:
        database.execute(
            delete(ExecutionModel).where(
                ExecutionModel.project_id
                == project_id,
            ),
        )

        database.commit()

    except Exception as error:
        database.rollback()

        raise HTTPException(
            status_code=500,
            detail=(
                "Não foi possível limpar "
                "as execuções do projeto."
            ),
        ) from error

    return None


# PROCESSAMENTO EM LOTE COM N8N + OLLAMA

@app.post(
    "/projects/{project_id}/batch",
    response_model=BatchProcessResponse,
)
async def process_project_batch(
    project_id: int,
    payload: BatchProcessRequest,
    request: Request,
    database: Session = Depends(
        get_db,
    ),
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    project_query = (
        select(ProjectModel)
        .options(
            selectinload(
                ProjectModel.fields,
            ),
        )
        .where(
            ProjectModel.id
            == project_id,
            ProjectModel.owner_id
            == current_user.id,
        )
    )

    project = database.scalar(
        project_query,
    )

    if not project:
        raise HTTPException(
            status_code=404,
            detail="Projeto não encontrado.",
        )

    cleaned_texts = [
        text_value.strip()
        for text_value in payload.texts
        if text_value.strip()
    ]

    if not cleaned_texts:
        raise HTTPException(
            status_code=422,
            detail=(
                "O lote não possui textos "
                "válidos para processamento."
            ),
        )

    too_long_rows = [
        index + 1
        for index, text_value
        in enumerate(cleaned_texts)
        if len(text_value) > 10000
    ]

    if too_long_rows:
        raise HTTPException(
            status_code=422,
            detail=(
                "Cada registro pode ter no máximo "
                "10.000 caracteres."
            ),
        )

    http_client: httpx.AsyncClient = (
        request.app.state.http_client
    )

    semaphore = asyncio.Semaphore(2)
    batch_started_at = perf_counter()

    async def process_row(
        row_number: int,
        source_text: str,
    ) -> dict[str, Any]:
        async with semaphore:
            row_started_at = perf_counter()
            preview_payload = (
                build_preview_payload(
                    project,
                    source_text,
                )
            )

            try:
                n8n_result = (
                    await send_preview_to_n8n(
                        payload=preview_payload,
                        http_client=http_client,
                    )
                )

                duration_ms = round(
                    (
                        perf_counter()
                        - row_started_at
                    )
                    * 1000,
                )

                return {
                    "row_number": row_number,
                    "source_text": source_text,
                    "success": bool(
                        n8n_result.get(
                            "success",
                            True,
                        ),
                    ),
                    "provider": n8n_result[
                        "provider"
                    ],
                    "structured_data": (
                        n8n_result[
                            "structured_data"
                        ]
                    ),
                    "duration_ms": duration_ms,
                    "error": None,
                }

            except HTTPException as error:
                duration_ms = round(
                    (
                        perf_counter()
                        - row_started_at
                    )
                    * 1000,
                )

                error_message = (
                    exception_detail_to_text(
                        error,
                    )
                )

                return {
                    "row_number": row_number,
                    "source_text": source_text,
                    "success": False,
                    "provider": "n8n/ollama",
                    "structured_data": {
                        "_error":
                            error_message,
                    },
                    "duration_ms": duration_ms,
                    "error": error_message,
                }

    processed_rows = await asyncio.gather(
        *(
            process_row(
                index + 1,
                source_text,
            )
            for index, source_text
            in enumerate(cleaned_texts)
        ),
    )

    execution_pairs: list[
        tuple[dict[str, Any], ExecutionModel]
    ] = []

    for item in processed_rows:
        execution = ExecutionModel(
            project_id=project_id,
            source_text=item[
                "source_text"
            ],
            structured_data=item[
                "structured_data"
            ],
            provider=item[
                "provider"
            ],
            success=item[
                "success"
            ],
            duration_ms=item[
                "duration_ms"
            ],
        )

        database.add(execution)
        execution_pairs.append(
            (item, execution),
        )

    try:
        database.commit()

        for _, execution in execution_pairs:
            database.refresh(execution)

    except Exception as error:
        database.rollback()

        raise HTTPException(
            status_code=500,
            detail=(
                "O lote foi processado, mas o "
                "histórico não pôde ser salvo."
            ),
        ) from error

    items = [
        BatchItemResponse(
            row_number=item[
                "row_number"
            ],
            success=item[
                "success"
            ],
            execution_id=(
                execution.id
            ),
            duration_ms=item[
                "duration_ms"
            ],
            structured_data=(
                item[
                    "structured_data"
                ]
                if item[
                    "success"
                ]
                else None
            ),
            error=item[
                "error"
            ],
        )
        for item, execution
        in execution_pairs
    ]

    successful_rows = sum(
        1
        for item in items
        if item.success
    )

    failed_rows = (
        len(items)
        - successful_rows
    )

    total_duration_ms = round(
        (
            perf_counter()
            - batch_started_at
        )
        * 1000,
    )

    return BatchProcessResponse(
        project_id=project_id,
        source_name=payload.source_name,
        total_rows=len(items),
        successful_rows=successful_rows,
        failed_rows=failed_rows,
        total_duration_ms=(
            total_duration_ms
        ),
        items=items,
    )


# PROCESSAMENTO INDIVIDUAL COM N8N + OLLAMA

@app.post(
    "/projects/preview",
)
async def create_project_preview(
    payload: ProjectPreviewRequest,
    request: Request,
    database: Session = Depends(
        get_db,
    ),
    current_user: UserModel = Depends(
        get_current_user,
    ),
):
    project = get_owned_project(
        payload.project_id,
        database,
        current_user.id,
    )

    http_client: httpx.AsyncClient = (
        request.app.state.http_client
    )

    started_at = perf_counter()

    try:
        n8n_result = (
            await send_preview_to_n8n(
                payload=payload,
                http_client=http_client,
            )
        )

    except HTTPException as error:
        duration_ms = round(
            (
                perf_counter()
                - started_at
            )
            * 1000,
        )

        error_message = (
            exception_detail_to_text(
                error,
            )
        )

        failed_execution = ExecutionModel(
            project_id=payload.project_id,
            source_text=payload.sample_text,
            structured_data={
                "_error":
                    error_message,
            },
            provider="n8n/ollama",
            success=False,
            duration_ms=duration_ms,
        )

        try:
            database.add(
                failed_execution,
            )
            database.commit()

        except Exception:
            database.rollback()

        raise error

    duration_ms = round(
        (
            perf_counter()
            - started_at
        )
        * 1000,
    )

    execution = ExecutionModel(
        project_id=payload.project_id,
        source_text=payload.sample_text,
        structured_data=(
            n8n_result[
                "structured_data"
            ]
        ),
        provider=(
            n8n_result["provider"]
        ),
        success=bool(
            n8n_result.get(
                "success",
                True,
            ),
        ),
        duration_ms=duration_ms,
    )

    try:
        database.add(execution)
        database.commit()
        database.refresh(execution)

    except Exception as error:
        database.rollback()

        raise HTTPException(
            status_code=500,
            detail=(
                "A IA processou o conteúdo, "
                "mas não foi possível salvar "
                "o histórico da execução."
            ),
        ) from error

    return {
        **n8n_result,

        "status":
            "preview_generated",

        "execution": {
            "id":
                execution.id,
            "project_id":
                execution.project_id,
            "duration_ms":
                execution.duration_ms,
            "processed_at":
                execution.processed_at,
        },

        "input": {
            "context":
                payload.context,
            "objective":
                payload.objective,
            "sample_text":
                payload.sample_text,
        },
    }