#!/usr/bin/env python3
"""Valida el usuario admin: existencia, perfil, rol y contraseña.

No imprime claves ni tokens. Usa la librería estándar (no requiere pip).

Variables:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  VITE_SUPABASE_ANON_KEY
  SEED_ADMIN_EMAIL
  SEED_ADMIN_PASSWORD
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"Falta la variable de entorno {name}")
    return value


def call(method: str, url: str, headers: dict, payload=None):
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url,
        data=body,
        headers={**headers, "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8") or "{}"
            return response.status, json.loads(raw)
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8") or "{}"
        try:
            return error.code, json.loads(raw)
        except json.JSONDecodeError:
            return error.code, {"raw": raw}


def main() -> int:
    url = env("SUPABASE_URL").rstrip("/")
    service_key = env("SUPABASE_SERVICE_ROLE_KEY")
    anon_key = env("VITE_SUPABASE_ANON_KEY")
    email = env("SEED_ADMIN_EMAIL")
    password = env("SEED_ADMIN_PASSWORD")

    service_headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }

    status, data = call("GET", f"{url}/auth/v1/admin/users?per_page=1000", service_headers)
    if status != 200:
        print(f"No se pudo listar usuarios: {status} {data}")
        return 1

    users = data.get("users", [])
    user = next(
        (candidate for candidate in users if (candidate.get("email") or "").lower() == email.lower()),
        None,
    )

    if user is None:
        print(f"NO EXISTE un usuario con email {email}.")
        print("Ejecuta el seed o crea el usuario desde el Dashboard.")
        return 1

    user_id = user["id"]
    print(f"Usuario:        {email}")
    print(f"ID:             {user_id}")
    print(f"Email conf.:    {user.get('email_confirmed_at') or 'NO CONFIRMADO'}")
    print(f"Último login:   {user.get('last_sign_in_at') or 'nunca'}")

    query = urllib.parse.urlencode({"id": f"eq.{user_id}", "select": "id,nombre,email,activo"})
    status, profile = call("GET", f"{url}/rest/v1/profiles?{query}", service_headers)
    print(f"Perfil:         {profile if status == 200 else f'ERROR {status} {profile}'}")

    query = urllib.parse.urlencode({"user_id": f"eq.{user_id}", "select": "rol"})
    status, roles = call("GET", f"{url}/rest/v1/user_roles?{query}", service_headers)
    print(f"Roles:          {roles if status == 200 else f'ERROR {status} {roles}'}")

    status, token = call(
        "POST",
        f"{url}/auth/v1/token?grant_type=password",
        {"apikey": anon_key},
        {"email": email, "password": password},
    )

    if status == 200 and token.get("access_token"):
        print("LOGIN:          OK (la contraseña coincide).")
        return 0

    detail = token.get("error_description") or token.get("msg") or token
    print(f"LOGIN:          FALLÓ ({status}) {detail}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
