#!/usr/bin/env python3
"""Configura y valida el login por correo de usuarios concretos.

Uso:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... VITE_SUPABASE_ANON_KEY=... \
  python3 scripts/setup_login_users.py --set will=Will123 --set cristian=Cristian123

Para cada usuario:
- lo busca por la parte local del correo o por el nombre (case-insensitive);
- confirma el correo y fija la contraseña;
- activa el perfil y asegura los roles proveedor + vendedor si no tiene;
- valida el login por correo contra Supabase Auth.

No imprime contraseñas, tokens ni correos completos.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

PAGE_SIZE = 1000


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"Falta la variable de entorno {name}")
    return value


def call(
    method: str,
    url: str,
    headers: dict[str, str],
    payload: object | None = None,
):
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


def parse_sets(values: list[str]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for value in values:
        if "=" not in value:
            sys.exit(f"--set inválido: {value!r}; usa usuario=contraseña")
        term, password = value.split("=", 1)
        term = term.strip().lower()
        if not term or len(password) < 6:
            sys.exit(f"--set inválido para {term!r}: la contraseña debe tener 6+ caracteres")
        pairs.append((term, password))
    return pairs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--set",
        action="append",
        default=[],
        metavar="USUARIO=CONTRASEÑA",
        help="usuario a configurar (repetible)",
    )
    args = parser.parse_args()

    url = env("SUPABASE_URL").rstrip("/")
    service_key = env("SUPABASE_SERVICE_ROLE_KEY")
    anon_key = env("VITE_SUPABASE_ANON_KEY")
    service = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}
    anon = {"apikey": anon_key, "Authorization": f"Bearer {anon_key}"}

    pairs = parse_sets(args.set)
    if not pairs:
        sys.exit("Nada que hacer: usa --set usuario=contraseña")

    users = list_users(url, service)

    for term, password in pairs:
        matches: list[dict] = []
        for user in users:
            metadata = user.get("user_metadata") or {}
            email = (user.get("email") or "").lower()
            local = email.split("@", 1)[0] if "@" in email else ""
            nombre = str(metadata.get("nombre") or "").strip().lower()
            if local == term or nombre == term:
                matches.append(user)

        # Preferir coincidencia exacta por parte local del correo.
        exact = [
            user
            for user in matches
            if (user.get("email") or "").lower().split("@", 1)[0] == term
        ]
        if len(exact) == 1:
            matches = exact

        print("=" * 60)
        print(f"Usuario buscado: {term}")
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
        email = (user.get("email") or "").lower()
        local = email.split("@", 1)[0] if "@" in email else ""
        nombre = (user.get("user_metadata") or {}).get("nombre") or ""
        print(f"  correo: {mask_email(email)}")
        print(f"  nombre: {nombre or '(sin nombre)'}")
        print(f"  username candidato: {local or nombre.lower()}")

        # 1. Confirmar correo y fijar contraseña.
        status, data = call(
            "PUT",
            f"{url}/auth/v1/admin/users/{user_id}",
            service,
            {"password": password, "email_confirm": True},
        )
        if status != 200:
            print(f"  ✗ no se pudo actualizar Auth: {status} {data}")
            continue
        print("  ✓ correo confirmado y contraseña fijada")

        # 2. Activar perfil.
        status, data = call(
            "PATCH",
            f"{url}/rest/v1/profiles?id=eq.{user_id}",
            {**service, "Prefer": "return=representation"},
            {"activo": True},
        )
        if status not in (200, 204):
            print(f"  ✗ no se pudo activar el perfil: {status} {data}")
        else:
            print("  ✓ perfil activo")

        # 3. Roles por defecto si no tiene.
        status, roles = call(
            "GET",
            f"{url}/rest/v1/user_roles?user_id=eq.{user_id}&select=rol",
            service,
        )
        actuales = {row["rol"] for row in (roles or [])} if status == 200 else set()
        for rol in ("proveedor", "vendedor"):
            if rol in actuales:
                continue
            status, data = call(
                "POST",
                f"{url}/rest/v1/user_roles?on_conflict=user_id,rol",
                {**service, "Prefer": "resolution=ignore-duplicates,return=representation"},
                {"user_id": user_id, "rol": rol},
            )
            if status not in (200, 201):
                print(f"  ✗ no se pudo asignar {rol}: {status} {data}")
        if status in (200, 201):
            print("  ✓ roles proveedor/vendedor asegurados")

        # 4. Validar login por correo.
        status, data = call(
            "POST",
            f"{url}/auth/v1/token?grant_type=password",
            anon,
            {"email": email, "password": password},
        )
        if status == 200:
            print("  ✓ LOGIN POR CORREO: OK")
        else:
            print(f"  ✗ LOGIN POR CORREO: falló ({status}) {data}")


if __name__ == "__main__":
    main()
