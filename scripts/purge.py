#!/usr/bin/env python3
"""Purga de productos vendidos en dos etapas.

Etapa 1: borrado lógico de vendidos con sold_at anterior a PURGE_LOGICAL_DAYS.
Etapa 2: borrado físico de productos con deleted_at anterior a PURGE_PHYSICAL_DAYS.

Se ejecuta con service_role (modo sistema). Los triggers de auditoría
registran borrado_logico y purga con actor sentinela.
"""

import os
import sys
from datetime import datetime, timedelta, timezone

import requests


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None or value == "":
        sys.exit(f"Falta la variable de entorno {name}")
    return value


def main() -> None:
    url = env("SUPABASE_URL").rstrip("/")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    logical_days = int(os.environ.get("PURGE_LOGICAL_DAYS", "7"))
    physical_days = int(os.environ.get("PURGE_PHYSICAL_DAYS", "30"))

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    now = datetime.now(timezone.utc)
    logical_cutoff = (now - timedelta(days=logical_days)).isoformat()
    physical_cutoff = (now - timedelta(days=physical_days)).isoformat()

    # Etapa 1: vendidos antiguos -> borrado lógico.
    stage1 = requests.patch(
        f"{url}/rest/v1/productos",
        headers=headers,
        params={
            "estado": "eq.vendido",
            "deleted_at": "is.null",
            "sold_at": f"lt.{logical_cutoff}",
            "select": "id",
        },
        json={"deleted_at": now.isoformat()},
        timeout=120,
    )
    stage1.raise_for_status()
    stage1_data = stage1.json()
    stage1_ids = stage1_data if isinstance(stage1_data, list) else []

    # Etapa 2: borrados antiguos -> purga física.
    stage2 = requests.delete(
        f"{url}/rest/v1/productos",
        headers=headers,
        params={
            "deleted_at": f"lt.{physical_cutoff}",
            "select": "id,imagen_path",
        },
        timeout=120,
    )
    stage2.raise_for_status()
    stage2_data = stage2.json()
    stage2_ids = stage2_data if isinstance(stage2_data, list) else []

    image_paths = [
        row["imagen_path"]
        for row in stage2_ids
        if isinstance(row, dict) and row.get("imagen_path")
    ]

    if image_paths:
        removed = requests.delete(
            f"{url}/storage/v1/object/productos",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={"prefixes": image_paths},
            timeout=120,
        )
        if removed.status_code >= 400:
            print(
                f"AVISO: no se pudieron borrar {len(image_paths)} imágenes: "
                f"{removed.status_code} {removed.text}"
            )

    print(
        f"Etapa 1: {len(stage1_ids)} productos con borrado lógico "
        f"(vendidos antes de {logical_cutoff})."
    )
    print(
        f"Etapa 2: {len(stage2_ids)} productos purgados físicamente "
        f"(borrados antes de {physical_cutoff}); imágenes: {len(image_paths)}."
    )


if __name__ == "__main__":
    main()
