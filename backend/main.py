from fastapi import FastAPI

app = FastAPI(
    title="Ylume API",
    description="API da plataforma Ylume para estruturação inteligente de dados.",
    version="0.1.0",
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
    }
