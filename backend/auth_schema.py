from sqlalchemy import text

from database import engine


def ensure_auth_schema() -> None:
    """
    Migração idempotente de transição para a Produção 1.

    O projeto ainda usa Base.metadata.create_all para o MVP.
    Como a tabela projects já existe no ambiente local,
    create_all não adicionaria owner_id sozinho.

    Esta função:
    - adiciona owner_id se necessário;
    - cria o índice;
    - cria a FK para users.

    Na fase de infraestrutura de produção, esta transição
    deve ser substituída por migrations versionadas.
    """

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                ALTER TABLE projects
                ADD COLUMN IF NOT EXISTS
                owner_id INTEGER
                """
            ),
        )

        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS
                ix_projects_owner_id
                ON projects (owner_id)
                """
            ),
        )

        connection.execute(
            text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conname =
                            'fk_projects_owner_id_users'
                    ) THEN
                        ALTER TABLE projects
                        ADD CONSTRAINT
                            fk_projects_owner_id_users
                        FOREIGN KEY (owner_id)
                        REFERENCES users(id)
                        ON DELETE CASCADE;
                    END IF;
                END $$;
                """
            ),
        )