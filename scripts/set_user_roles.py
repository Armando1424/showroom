#!/usr/bin/env python3
"""Asegura roles para usuarios concretos usando la service_role.

Uso:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  python3 scripts/set_user_roles.py --role will=admin --role cristian=proveedor

Para cada usuario:
- lo busca por nombre o por la parte local del correo (case-insensitive);
- activa el perfil si hace falta;
- asegura el rol de forma idempotente;
- imprime los roles finales.

No imprime correos completos, IDs ni tokens.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

PAGE_SIZE = 1000


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"Falta la variable de entorno {name}")
    return value


def call(method: str, url: str, headers: dict[str, str], payload: object | None = None):
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={**headers, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode(errors="replace")
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, {"raw": raw[:300]}


def mask_email(email: str | None) -> str:
    if not email or "@" not in email:
        return email or "(sin correo)"
    local, domain = email.split("@", 1)
    return f"{local[:1]}***@{domain}"


def list_users(url: str, service: dict[str, str]) -> list[dict]:
    users: list[dict] = []
    page = 1
    while True:
        status, data = call(
            "GET",
            f"{url}/auth/v1/admin/users?page={page}&per_page={PAGE_SIZE}",
            service,
        )
        if status != 200:
            sys.exit(f"No se pudo listar usuarios: {status} {data}")
        batch = (data or {}).get("users", [])
        users.extend(batch)
        if len(batch) < PAGE_SIZE:
            return users
        page += 1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--role",
        action="append",
        default=[],
        metavar="USUARIO=ROL",
        help="rol a asegurar (repetible): will=admin, cristian=proveedor",
    )
    args = parser.parse_args()

    if not args.role:
        sys.exit("Nada que hacer: usa --role usuario=rol")

    url = env("SUPABASE_URL").rstrip("/")
    service_key = env("SUPABASE_SERVICE_ROLE_KEY")
    service = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

    users = list_users(url, service)

    for item in args.role:
        if "=" not in item:
            sys.exit(f"--role inválido: {item!r}; usa usuario=rol")
        term, rol = (part.strip().lower() for part in item.split("=", 1))
        if rol not in {"admin", "proveedor", "vendedor"}:
            sys.exit(f"Rol inválido: {rol!r}")

        matches: list[dict] = []
        for user in users:
            metadata = user.get("user_metadata") or {}
            email = (user.get("email") or "").lower()
            local = email.split("@", 1)[0] if "@" in email else ""
            nombre = str(metadata.get("nombre") or "").strip().lower()
            if local == term or nombre == term:
                matches.append(user)

        exact = [
            user
            for user in matches
            if (user.get("email") or "").lower().split("@", 1)[0] == term
        ]
        if len(exact) == 1:
            matches = exact

        print("=" * 60)
        print(f"Usuario: {term}")
        if not matches:
            print("  NO ENCONTRADO por correo ni por nombre.")
            continue
        if len(matches) > 1:
            print(f"  AMBIGUO: {len(matches)} coincidencias; no se toca ninguna.")
            for user in matches:
                print(f"    - {mask_email(user.get('email'))}")
            continue

        user = matches[0]
        user_id = user["id"]
        print(f"  correo: {mask_email(user.get('email'))}")

        # Activar perfil si hiciera falta.
        status, data = call(
            "PATCH",
            f"{url}/rest/v1/profiles?id=eq.{user_id}",
            {**service, "Prefer": "return=representation"},
            {"activo": True},
        )
        if status not in (200, 204):
            print(f"  ✗ no se pudo activar el perfil: {status} {data}")

        # Asegurar el rol (idempotente).
        status, data = call(
            "POST",
            f"{url}/rest/v1/user_roles?on_conflict=user_id,rol",
            {**service, "Prefer": "resolution=ignore-duplicates,return=representation"},
            {"user_id": user_id, "rol": rol},
        )
        if status not in (200, 201):
            print(f"  ✗ no se pudo asignar {rol}: {status} {data}")
            continue
        print(f"  ✓ rol {rol} asegurado")

        # Roles finales.
        status, rows = call(
            "GET",
            f"{url}/rest/v1/user_roles?user_id=eq.{user_id}&select=rol&order=rol",
            service,
        )
        if status == 200:
            finales = ", ".join(row["rol"] for row in (rows or []))
            print(f"  roles finales: {finales or 'NINGUNO'}")
        else:
            print(f"  ✗ no se pudieron leer los roles: {status} {rows}")


if __name__ == "__main__":
    main()
