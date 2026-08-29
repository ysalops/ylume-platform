FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app/backend

RUN groupadd --system ylume \
    && useradd --system --gid ylume --home-dir /app ylume

COPY requirements.txt ./requirements.txt

RUN python -m pip install --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chown -R ylume:ylume /app

USER ylume

EXPOSE 8001

CMD [
  "python",
  "-m",
  "uvicorn",
  "main:app",
  "--host",
  "0.0.0.0",
  "--port",
  "8001",
  "--proxy-headers",
  "--forwarded-allow-ips=*"
]
