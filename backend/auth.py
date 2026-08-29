import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
from fastapi import Depends, HTTPException, Request, Response
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash
from dotenv import load_dotenv
from sqlalchemy.orm import Session

from auth_models import User
from database import get_db


PROJECT_ROOT = Path(__file__).resolve().parents[1]

load_dotenv(
    PROJECT_ROOT / ".env",
)

COOKIE_NAME = os.getenv(
    "AUTH_COOKIE_NAME",
    "ylume_session",
).strip()

JWT_SECRET_KEY = os.getenv(
    "JWT_SECRET_KEY",
    "",
).strip()

JWT_ALGORITHM = "HS256"

try:
    ACCESS_TOKEN_EXPIRE_MINUTES = int(
        os.getenv(
            "ACCESS_TOKEN_EXPIRE_MINUTES",
            "480",
        ),
    )
except ValueError:
    ACCESS_TOKEN_EXPIRE_MINUTES = 480

AUTH_COOKIE_SECURE = (
    os.getenv(
        "AUTH_COOKIE_SECURE",
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

password_hash = PasswordHash.recommended()


def validate_auth_configuration() -> None:
    if len(JWT_SECRET_KEY) < 32:
        raise RuntimeError(
            "JWT_SECRET_KEY não foi configurada ou é muito curta. "
            "Gere uma chave aleatória forte e salve no .env da raiz."
        )


def normalize_email(
    email: str,
) -> str:
    return email.strip().casefold()


def hash_password(
    password: str,
) -> str:
    return password_hash.hash(
        password,
    )


def verify_password(
    plain_password: str,
    hashed_password: str,
) -> bool:
    try:
        return password_hash.verify(
            plain_password,
            hashed_password,
        )
    except Exception:
        return False


def create_access_token(
    user_id: int,
) -> str:
    now = datetime.now(
        timezone.utc,
    )

    expires_at = (
        now
        + timedelta(
            minutes=(
                ACCESS_TOKEN_EXPIRE_MINUTES
            ),
        )
    )

    payload = {
        "sub": str(user_id),
        "type": "access",
        "iat": now,
        "exp": expires_at,
    }

    return jwt.encode(
        payload,
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM,
    )


def set_auth_cookie(
    response: Response,
    token: str,
) -> None:
    max_age = (
        ACCESS_TOKEN_EXPIRE_MINUTES
        * 60
    )

    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=max_age,
        httponly=True,
        secure=AUTH_COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def clear_auth_cookie(
    response: Response,
) -> None:
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        httponly=True,
        secure=AUTH_COOKIE_SECURE,
        samesite="lax",
    )


def decode_access_token(
    token: str,
) -> int:
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET_KEY,
            algorithms=[
                JWT_ALGORITHM,
            ],
            options={
                "require": [
                    "sub",
                    "exp",
                    "iat",
                ],
            },
        )
    except InvalidTokenError as error:
        raise HTTPException(
            status_code=401,
            detail=(
                "Sessão inválida ou expirada."
            ),
        ) from error

    if payload.get("type") != "access":
        raise HTTPException(
            status_code=401,
            detail="Token inválido.",
        )

    try:
        return int(
            payload["sub"],
        )
    except (
        KeyError,
        TypeError,
        ValueError,
    ) as error:
        raise HTTPException(
            status_code=401,
            detail="Token inválido.",
        ) from error


def get_current_user(
    request: Request,
    database: Session = Depends(
        get_db,
    ),
) -> User:
    token = request.cookies.get(
        COOKIE_NAME,
    )

    if not token:
        raise HTTPException(
            status_code=401,
            detail=(
                "Autenticação necessária."
            ),
        )

    user_id = decode_access_token(
        token,
    )

    user = database.get(
        User,
        user_id,
    )

    if (
        not user
        or not user.is_active
    ):
        raise HTTPException(
            status_code=401,
            detail=(
                "Usuário não encontrado "
                "ou inativo."
            ),
        )

    return user