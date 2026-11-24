#!/usr/bin/env python3
"""Habilita el login por usuario para todas las cuentas existentes.

Para cada perfil activo:
- deriva un username del nombre (o de la parte local del correo);
- resuelve colisiones con -2, -3...;
- cambia el correo interno de Auth a <username>@showroom.local y lo confirma;
- deja intactos el correo real del perfil, la contraseña y los roles.

No cambia contraseñas: cada usuario conserva la que ya tenía.
No imprime correos completos, IDs ni tokens.
"""

from __future__ import annotations

import json
import os
import re
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


def sanitize(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9._-]+", "", value)
    return value[:24]


def main() -> None:
    url = env("SUPABASE_URL").rstrip("/")
    service_key = env("SUPABASE_SERVICE_ROLE_KEY")
    service = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

    status, profiles = call(
        "GET",
        f"{url}/rest/v1/profiles?select=id,nombre,email,activo,created_at&order=created_at,id",
        service,
    )
    if status != 200:
        sys.exit(f"No se pudieron listar perfiles: {status} {profiles}")

    status, admin_rows = call(
        "GET",
        f"{url}/rest/v1/user_roles?select=user_id&rol=eq.admin",
        service,
    )
    admins = {row["user_id"] for row in (admin_rows or [])} if status == 200 else set()

    users = {user["id"]: user for user in list_users(url, service)}
    used: set[str] = set()
    admin_username = None

    for profile in profiles or []:
        user_id = profile["id"]
        user = users.get(user_id)
        if user is None:
            continue

        nombre = str(profile.get("nombre") or "").strip()
        current_email = str(user.get("email") or "").lower()
        local = current_email.split("@", 1)[0] if "@" in current_email else ""

        base = sanitize(nombre.split()[0] if nombre else "")
        if not base:
            base = sanitize(local)
        if not base:
            base = "usuario"

        candidate = base
        suffix = 1
        while candidate in used:
            suffix += 1
            candidate = f"{base}-{suffix}"
        used.add(candidate)

        auth_email = f"{candidate}@showroom.local"
        changed = current_email != auth_email
        confirmed = bool(user.get("email_confirmed_at") or user.get("confirmed_at"))

        if changed or not confirmed:
            status, data = call(
                "PUT",
                f"{url}/auth/v1/admin/users/{user_id}",
                service,
                {"email": auth_email, "email_confirm": True},
            )
            if status != 200:
                print(f"✗ {nombre or '(sin nombre)'} → {candidate}: {status} {data}")
                continue

        if user_id in admins:
            admin_username = candidate

        estado = "actualizado" if changed else "sin cambio"
        print(f"{nombre or '(sin nombre)'} → {candidate} ({estado})")

    if admin_username:
        print(f"ADMIN_USERNAME={admin_username}")
    else:
        print("ADMIN_USERNAME=(no encontrado)")


if __name__ == "__main__":
    main()
