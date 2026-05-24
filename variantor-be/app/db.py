import json
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row


_database_url = ""


def init_db(database_url: str, migrations_dir: str) -> None:
    global _database_url
    _database_url = database_url
    with connect() as conn:
        conn.execute("select pg_advisory_xact_lock(hashtext('variantor_schema_migrations'))")
        conn.execute(
            """
            create table if not exists schema_migrations (
                version text primary key,
                applied_at timestamptz not null default now()
            )
            """
        )
        for path in sorted(Path(migrations_dir).glob("*.sql")):
            version = path.name
            exists = conn.execute(
                "select 1 from schema_migrations where version = %s",
                (version,),
            ).fetchone()
            if exists:
                continue
            conn.execute(path.read_text(encoding="utf-8"))
            conn.execute("insert into schema_migrations(version) values (%s) on conflict do nothing", (version,))


def connect():
    return psycopg.connect(_database_url, row_factory=dict_row)


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)
