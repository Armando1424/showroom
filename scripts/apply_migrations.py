#!/usr/bin/env python3
"""Aplica las migraciones pendientes de supabase/migrations vía Management API.

- Lleva un registro en private.applied_migrations.
- En la primera ejecución marca 0001-0003 como aplicadas (ya estaban en la base)
  y empieza desde la siguiente.
- Se detiene en el primer error y no registra la migración fallida.

Uso:
    SUPABASE_ACCESS_TOKEN=... python3 scripts/apply_migrations.py
    SUPABASE_ACCESS_TOKEN=... python3 scripts/apply_migrations.py --dry-run
"""
from __future__ import annotations

import json
import os
import pathlib
import sys
import urllib.request

PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "tojdcyzdeigiynvvvrwz")
API = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
MIGRATIONS = pathlib.Path(__file__).resolve().parent.parent / "supabase" / "migrations"
BASELINE = ["0001_init.sql", "0002_imagen.sql", "0003_admin_devolucion.sql"]


def query(sql: str):
    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        raise SystemExit("Falta SUPABASE_ACCESS_TOKEN")

    body = json.dumps({"query": sql}).encode()
    request = urllib.request.Request(
        API,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = response.read().decode()
    except urllib.error.HTTPError as exc:  # type: ignore[attr-defined]
        detail = exc.read().decode()
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc

    if not payload.strip():
        return []
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return []


def applied() -> set[str]:
    query("create schema if not exists private;")
    query(
        "create table if not exists private.applied_migrations ("
        " name text primary key,"
        " applied_at timestamptz not null default now()"
        ");"
    )
    rows = query("select name from private.applied_migrations;")
    return {row["name"] for row in rows}


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    done = applied()
    files = sorted(p.name for p in MIGRATIONS.glob("*.sql"))

    if not done:
        print("Registro vacío: marcando como aplicadas", ", ".join(BASELINE))
        if not dry_run:
            for name in BASELINE:
                query(
                    "insert into private.applied_migrations (name) values ($1) "
                    "on conflict do nothing;".replace("$1", "'" + name + "'")
                )
        done = set(BASELINE)

    pending = [f for f in files if f not in done]
    if not pending:
        print("No hay migraciones pendientes.")
        return 0

    for name in pending:
        sql = (MIGRATIONS / name).read_text(encoding="utf-8")
        print(f"→ {name} ({len(sql)} bytes)")
        if dry_run:
            continue
        try:
            query(sql)
        except RuntimeError as exc:
            print(f"✗ {name} falló: {exc}", file=sys.stderr)
            return 1
        query(
            "insert into private.applied_migrations (name) values ('" + name + "') "
            "on conflict do nothing;"
        )
        print(f"✓ {name} aplicada")

    if not dry_run:
        query("notify pgrst, 'reload schema';")
        print("Esquema recargado en PostgREST.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
