#!/usr/bin/env python3
"""Prueba el login nativo de Showroom (usuario o correo + contraseña).

Uso:
  SHOWROOM_TEST_PASSWORD=... python3 scripts/test_login.py --identifier will
  SHOWROOM_TEST_PASSWORD=... python3 scripts/test_login.py --identifier cristian

El usuario se mapea a <usuario>@showroom.local, el correo interno que usa
Supabase Auth. No usa la Edge Function login ni tokens de despliegue.
No imprime tokens ni la contraseña.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_URL = "https://tojdcyzdeigiynvvvrwz.supabase.co"
PAGES = "https://armando1424.github.io/showroom/"
JWT = re.compile(r"eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*")


def anon_key(explicit: str | None) -> str:
    key = explicit or os.environ.get("VITE_SUPABASE_ANON_KEY", "")
    if key.strip():
        return key.strip()

    with urllib.request.urlopen(PAGES, timeout=30) as response:
        html = response.read().decode()

    match = re.search(r'assets/index-[^"]+\.js', html)
    if not match:
        sys.exit("No se pudo encontrar el bundle de Pages.")

    with urllib.request.urlopen(urllib.parse.urljoin(PAGES, match.group(0)), timeout=30) as response:
        bundle = response.read().decode()

    match = JWT.search(bundle)
    if not match:
        sys.exit("No se pudo encontrar la anon key en el bundle de Pages.")
    return match.group(0)


def email_for(identifier: str) -> str:
    value = identifier.strip().lower()
    return value if "@" in value else f"{value}@showroom.local"


def login(url: str, key: str, identifier: str, password: str) -> tuple[int, dict]:
    body = json.dumps({"email": email_for(identifier), "password": password}).encode()
    request = urllib.request.Request(
        f"{url}/auth/v1/token?grant_type=password",
        data=body,
        method="POST",
        headers={"apikey": key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode(errors="replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"error": raw[:200]}
        return exc.code, payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--identifier", default="will", help="usuario o correo a probar")
    parser.add_argument("--password", default=os.environ.get("SHOWROOM_TEST_PASSWORD"))
    parser.add_argument("--url", default=os.environ.get("SUPABASE_URL", DEFAULT_URL))
    parser.add_argument("--anon-key")
    args = parser.parse_args()

    password = args.password or getpass.getpass("Contraseña de prueba: ")
    key = anon_key(args.anon_key)
    url = args.url.rstrip("/")

    cases: list[tuple[str, str, str, int]] = [
        ("usuario", args.identifier, password, 200),
        ("usuario en mayúsculas", args.identifier.upper(), password, 200),
    ]

    if password.lower() != password:
        cases.append(("contraseña en minúsculas", args.identifier, password.lower(), 400))

    failures = 0
    for label, identifier, candidate, expected in cases:
        status, payload = login(url, key, identifier, candidate)
        ok = status == expected
        detail = "OK" if ok else f"esperaba {expected}, recibí {status}"
        if not ok:
            failures += 1
            error = payload.get("error_description") or payload.get("msg") or payload.get("error")
            if error:
                detail += f" ({error})"
        print(f"{label:28} {identifier:20} -> {status} {detail}")

    if failures:
        sys.exit(f"{failures} prueba(s) fallaron")

    print("Todas las pruebas de login pasaron.")


if __name__ == "__main__":
    main()
