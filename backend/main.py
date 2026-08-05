from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Ylume API",
    description="API da plataforma Ylume para estruturação inteligente de dados.",
    version="0.1.0",
)

# Endereços permitidos durante o desenvolvimento local.
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "message": "Ylume API online",
        "version": "0.1.0",
    }


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ylume-api",
        "version": "0.1.0",
    }