#!/usr/bin/env python3
"""Genera el mapa hash(correo real) → username para el login del frontend.

- Lee los perfiles (correo real) y los usuarios de Auth (correo interno
  <username>@showroom.local).
- Imprime un objeto TypeScript con SHA-256 del correo en minúsculas.
- Con --test valida, para los usuarios con contraseña conocida, que el correo
  real resuelve al username y que ese username puede iniciar sesión.

No imprime correos completos, contraseñas ni tokens.
"""

from __future__ import annotations

import hashlib
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
    url = env("SUPABASE_URL").rstrip("/")
    service_key = env("SUPABASE_SERVICE_ROLE_KEY")
    service = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

    status, profiles = call(
        "GET",
        f"{url}/rest/v1/profiles?select=id,nombre,email",
        service,
    )
    if status != 200:
        sys.exit(f"No se pudieron listar perfiles: {status} {profiles}")

    users = {user["id"]: user for user in list_users(url, service)}

    rows: list[tuple[str, str, str]] = []
    for profile in profiles or []:
        user = users.get(profile["id"])
        if user is None:
            continue
        auth_email = (user.get("email") or "").strip().lower()
        if not auth_email.endswith("@showroom.local"):
            continue
        username = auth_email.split("@", 1)[0]
        real_email = (profile.get("email") or "").strip().lower()
        if not real_email or real_email.endswith("@showroom.local"):
            continue
        digest = hashlib.sha256(real_email.encode("utf-8")).hexdigest()
        rows.append((username, real_email, digest))

    print("// Generado por scripts/generate_email_map.py")
    print("export const EMAIL_HASH_TO_USERNAME: Record<string, string> = {")
    for _username, _real_email, digest in sorted(rows, key=lambda row: row[0]):
        print(f'  "{digest}": "{_username}",')
    print("}")

    if "--test" not in sys.argv:
        return

    passwords = {
        "will": os.environ.get("WILL_TEST_PASSWORD"),
        "cristian": os.environ.get("CRISTIAN_TEST_PASSWORD"),
        "administrador": os.environ.get("SEED_ADMIN_PASSWORD"),
    }
    anon_key = env("VITE_SUPABASE_ANON_KEY")
    anon = {"apikey": anon_key, "Content-Type": "application/json"}

    print("// Pruebas de correo registrado")
    for username, _real_email, digest in sorted(rows, key=lambda row: row[0]):
        password = passwords.get(username)
        if not password:
            continue
        # Simula el frontend: hash(correo) -> username -> correo interno.
        resolved = next(
            (row[0] for row in rows if row[2] == digest),
            None,
        )
        email = f"{resolved}@showroom.local" if resolved else _real_email
        status, _ = call(
            "POST",
            f"{url}/auth/v1/token?grant_type=password",
            anon,
            {"email": email, "password": password},
        )
        print(f"// {username}: correo real -> {resolved} -> {'OK' if status == 200 else 'FALLO'}")


if __name__ == "__main__":
    main()
