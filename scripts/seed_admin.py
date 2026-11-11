#!/usr/bin/env python3
"""Crea (o reutiliza) el primer administrador y lo activa.

Se ejecuta en modo sistema con la service_role key. Nunca se programa:
solo workflow_dispatch o ejecución manual.
"""

import os
import sys

import requests


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None or value == "":
        sys.exit(f"Falta la variable de entorno {name}")
    return value


def main() -> None:
    url = env("SUPABASE_URL").rstrip("/")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    email = env("SEED_ADMIN_EMAIL")
    password = env("SEED_ADMIN_PASSWORD")
    nombre = os.environ.get("SEED_ADMIN_NOMBRE", "Administrador")

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    # 1. Crear el usuario en Auth o reutilizarlo si ya existe.
    response = requests.post(
        f"{url}/auth/v1/admin/users",
        headers=headers,
        json={
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"nombre": nombre},
        },
        timeout=60,
    )

    if response.status_code in (200, 201):
        user = response.json()
    elif response.status_code in (409, 422):
        listing = requests.get(
            f"{url}/auth/v1/admin/users",
            headers=headers,
            params={"per_page": 1000},
            timeout=60,
        )
        listing.raise_for_status()
        users = listing.json().get("users", [])
        user = next(
            (candidate for candidate in users if (candidate.get("email") or "").lower() == email.lower()),
            None,
        )
        if user is None:
            sys.exit(f"El usuario {email} ya existe pero no se pudo encontrar en la lista.")
    else:
        sys.exit(f"No se pudo crear el usuario: {response.status_code} {response.text}")

    user_id = user["id"]

    # 2. Activar el perfil (modo sistema: el trigger BEFORE UPDATE está exento).
    profile = requests.post(
        f"{url}/rest/v1/profiles",
        headers={**headers, "Prefer": "resolution=merge-duplicates,return=representation"},
        params={"on_conflict": "id"},
        json={
            "id": user_id,
            "nombre": nombre,
            "email": email,
            "activo": True,
        },
        timeout=60,
    )
    profile.raise_for_status()

    # 3. Asignar el rol admin (granted_by lo pone el trigger con el sentinela).
    role = requests.post(
        f"{url}/rest/v1/user_roles",
        headers={**headers, "Prefer": "resolution=ignore-duplicates,return=representation"},
        params={"on_conflict": "user_id,rol"},
        json={"user_id": user_id, "rol": "admin"},
        timeout=60,
    )
    role.raise_for_status()

    print(f"OK: {email} ({user_id}) activo y con rol admin.")


if __name__ == "__main__":
    main()
