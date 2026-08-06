from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


app = FastAPI(
    title="Ylume API",
    description="API da plataforma Ylume para estruturação inteligente de dados.",
    version="0.2.0",
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


class OutputField(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    field_type: Literal[
        "text",
        "number",
        "boolean",
        "date",
        "category",
    ]
    description: str | None = Field(default=None, max_length=300)


class ProjectPreviewRequest(BaseModel):
    project_name: str = Field(min_length=2, max_length=120)
    context: str = Field(min_length=5, max_length=3000)
    objective: str = Field(min_length=5, max_length=2000)
    sample_text: str = Field(min_length=1, max_length=10000)
    fields: list[OutputField] = Field(min_length=1, max_length=30)


def generate_mock_value(field: OutputField):
    """
    Gera valores simulados.

    Posteriormente, esta função será substituída por uma chamada
    ao Ollama, Amazon Bedrock ou outro provedor de LLM.
    """

    values = {
        "text": f"Conteúdo estruturado para {field.name}",
        "number": 0,
        "boolean": False,
        "date": "2026-08-05",
        "category": "Não classificado",
    }

    return values[field.field_type]


@app.get("/")
async def root():
    return {
        "message": "Ylume API online",
        "version": "0.2.0",
    }


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ylume-api",
        "version": "0.2.0",
    }


@app.post("/projects/preview")
async def create_project_preview(payload: ProjectPreviewRequest):
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