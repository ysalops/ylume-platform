#!/bin/sh
set -eu

if [ -z "${N8N_DB:-}" ]; then
  echo "N8N_DB não definido."
  exit 1
fi

echo "Verificando banco do n8n: ${N8N_DB}"

DATABASE_EXISTS="$(
  psql \
    --username "${POSTGRES_USER}" \
    --dbname "${POSTGRES_DB}" \
    --tuples-only \
    --no-align \
    --command "SELECT 1 FROM pg_database WHERE datname='${N8N_DB}'"
)"

if [ "${DATABASE_EXISTS}" != "1" ]; then
  echo "Criando banco ${N8N_DB}..."
  psql \
    --username "${POSTGRES_USER}" \
    --dbname "${POSTGRES_DB}" \
    --command "CREATE DATABASE \"${N8N_DB}\" OWNER \"${POSTGRES_USER}\";"
else
  echo "Banco ${N8N_DB} já existe."
fi
