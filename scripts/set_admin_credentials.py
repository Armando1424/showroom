#!/usr/bin/env python3
"""Cambia el correo interno y la contraseña del admin semilla.

Uso:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... VITE_SUPABASE_ANON_KEY=... \
  SEED_ADMIN_EMAIL=local.administrator@showroom.local \
  SEED_ADMIN_PASSWORD=... \
  python3 scripts/set_admin_credentials.py --current administrador

- Busca el usuario de Auth cuyo correo interno sea <current>@showroom.local.
- Lo actualiza a SEED_ADMIN_EMAIL con SEED_ADMIN_PASSWORD, confirmado.
- Valida el login con el nuevo correo y contraseña.
No imprime correos completos, contraseñas ni tokens.
"""

from __future__ import annotations

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
    current = "administrador"
    args = sys.argv[1:]
    if "--current" in args:
        current = args[args.index("--current") + 1].strip().lower()

    url = env("SUPABASE_URL").rstrip("/")
    service_key = env("SUPABASE_SERVICE_ROLE_KEY")
    anon_key = env("VITE_SUPABASE_ANON_KEY")
    new_email = env("SEED_ADMIN_EMAIL").strip().lower()
    new_password = env("SEED_ADMIN_PASSWORD")
    service = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}
    anon = {"apikey": anon_key, "Content-Type": "application/json"}

    if len(new_password) < 8:
        sys.exit("SEED_ADMIN_PASSWORD debe tener al menos 8 caracteres")

    current_email = f"{current}@showroom.local"
    users = list_users(url, service)
    user = next(
        (
            candidate
            for candidate in users
            if (candidate.get("email") or "").strip().lower() == current_email
        ),
        None,
    )
    if user is None:
        sys.exit(f"No existe el usuario {current_email}")

    status, data = call(
        "PUT",
        f"{url}/auth/v1/admin/users/{user['id']}",
        service,
        {"email": new_email, "password": new_password, "email_confirm": True},
    )
    if status != 200:
        sys.exit(f"No se pudo actualizar el admin: {status} {data}")

    status, token = call(
        "POST",
        f"{url}/auth/v1/token?grant_type=password",
        anon,
        {"email": new_email, "password": new_password},
    )
    if status != 200 or not token.get("access_token"):
        detail = token.get("error_description") or token.get("msg") or token
        sys.exit(f"El login del admin falló ({status}): {detail}")

    print(f"Admin actualizado: {new_email}")
    print("LOGIN DEL ADMIN: OK")


if __name__ == "__main__":
    main()
