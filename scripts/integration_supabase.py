#!/usr/bin/env python3
"""Integración mutante de RLS/RPC de Showroom contra un Supabase de TEST.

Requiere:
  SUPABASE_TEST_URL
  SUPABASE_TEST_ANON_KEY
  SUPABASE_TEST_SERVICE_ROLE_KEY

Se niega a correr contra el proyecto beta/productivo. Crea usuarios y
productos sintéticos, prueba RLS y las RPC de venta/devolución/visibilidad,
y limpia todo al final. No usa datos reales.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import uuid

PROD_REF = "tojdcyzdeigiynvvvrwz"
PASSWORD = "Test1234!"
PREFIX = "integration-showroom"
DATES = {
    "desde": "2026-01-01T00:00:00Z",
    "hasta": "2026-12-31T23:59:59Z",
}


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"Falta la variable de entorno {name}")
    return value


URL = env("SUPABASE_TEST_URL").rstrip("/")
ANON = env("SUPABASE_TEST_ANON_KEY")
SERVICE = env("SUPABASE_TEST_SERVICE_ROLE_KEY")

if PROD_REF in URL:
    sys.exit("Negado: SUPABASE_TEST_URL apunta al proyecto beta/productivo")


def call(method: str, path: str, headers: dict[str, str], body: object | None = None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        f"{URL}{path}",
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
            return exc.code, {"raw": raw[:400]}


SERVICE_HEADERS = {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}"}
ANON_HEADERS = {"apikey": ANON}


def user_headers(token: str) -> dict[str, str]:
    return {"apikey": ANON, "Authorization": f"Bearer {token}"}


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"  ✓ {message}")


def login(email: str, password: str) -> tuple[str, str]:
    status, data = call(
        "POST",
        "/auth/v1/token?grant_type=password",
        ANON_HEADERS,
        {"email": email, "password": password},
    )
    check(status == 200, f"login {email}")
    return data["access_token"], data["user"]["id"]


def get(token: str, path: str):
    status, data = call("GET", f"/rest/v1/{path}", user_headers(token))
    check(status == 200, f"GET {path}")
    return data


def rpc(token: str, name: str, body: dict):
    status, data = call("POST", f"/rest/v1/rpc/{name}", user_headers(token), body)
    check(status == 200, f"RPC {name}")
    return data


def create_user(email: str, nombre: str) -> str:
    status, data = call(
        "POST",
        "/auth/v1/admin/users",
        SERVICE_HEADERS,
        {
            "email": email,
            "password": PASSWORD,
            "email_confirm": True,
            "user_metadata": {"nombre": nombre},
        },
    )
    check(status in (200, 201), f"crear auth {email}")
    return data["id"]


def activate_profile(user_id: str, activo: bool, proveedor_id: str | None = None) -> None:
    body = {"activo": activo}
    if proveedor_id is not None:
        body["proveedor_id"] = proveedor_id
    status, _ = call(
        "PATCH",
        f"/rest/v1/profiles?id=eq.{user_id}",
        {**SERVICE_HEADERS, "Prefer": "return=representation"},
        body,
    )
    check(status in (200, 204), f"perfil {user_id} activo={activo}")


def add_roles(user_id: str, roles: list[str]) -> None:
    for rol in roles:
        status, _ = call(
            "POST",
            "/rest/v1/user_roles?on_conflict=user_id,rol",
            {**SERVICE_HEADERS, "Prefer": "resolution=ignore-duplicates"},
            {"user_id": user_id, "rol": rol},
        )
        check(status in (200, 201), f"rol {rol} para {user_id}")


def create_product(nombre: str, proveedor_id: str, created_by: str) -> str:
    product_id = str(uuid.uuid4())
    status, _ = call(
        "POST",
        "/rest/v1/productos",
        {**SERVICE_HEADERS, "Prefer": "return=representation"},
        {
            "id": product_id,
            "nombre": nombre,
            "descripcion": "Producto de integración",
            "precio": 100,
            "estado": "disponible",
            "imagen_path": f"{PREFIX}/{product_id}.jpg",
            "proveedor_id": proveedor_id,
            "created_by": created_by,
        },
    )
    check(status in (200, 201), f"producto {nombre}")
    return product_id


def cleanup(user_ids: list[str], product_ids: list[str]) -> None:
    if product_ids:
        ids = ",".join(product_ids)
        call("DELETE", f"/rest/v1/ventas?producto_id=in.({ids})", SERVICE_HEADERS)
        call("DELETE", f"/rest/v1/product_visibility?producto_id=in.({ids})", SERVICE_HEADERS)
        call("DELETE", f"/rest/v1/productos?id=in.({ids})", SERVICE_HEADERS)
    if user_ids:
        ids = ",".join(user_ids)
        call("DELETE", f"/rest/v1/user_roles?user_id=in.({ids})", SERVICE_HEADERS)
        call("DELETE", f"/rest/v1/profiles?id=in.({ids})", SERVICE_HEADERS)
        for user_id in user_ids:
            call("DELETE", f"/auth/v1/admin/users/{user_id}", SERVICE_HEADERS)


def main() -> int:
    stamp = uuid.uuid4().hex[:8]
    emails = {
        "admin": f"admin.{PREFIX}.{stamp}@showroom.test",
        "provider": f"provider.{PREFIX}.{stamp}@showroom.test",
        "seller": f"seller.{PREFIX}.{stamp}@showroom.test",
        "inactive": f"inactive.{PREFIX}.{stamp}@showroom.test",
    }
    user_ids: list[str] = []
    product_ids: list[str] = []

    try:
        print("== usuarios y datos ==")
        admin_id = create_user(emails["admin"], "Admin Integración")
        provider_id = create_user(emails["provider"], "Proveedor Integración")
        seller_id = create_user(emails["seller"], "Vendedor Integración")
        inactive_id = create_user(emails["inactive"], "Inactivo Integración")
        user_ids = [admin_id, provider_id, seller_id, inactive_id]

        activate_profile(admin_id, True)
        activate_profile(provider_id, True)
        activate_profile(seller_id, True, provider_id)
        activate_profile(inactive_id, False, provider_id)

        add_roles(admin_id, ["admin", "proveedor", "vendedor"])
        add_roles(provider_id, ["proveedor", "vendedor"])
        add_roles(seller_id, ["vendedor"])
        add_roles(inactive_id, ["vendedor"])

        provider_product = create_product("Producto del proveedor", provider_id, provider_id)
        admin_product = create_product("Producto del admin", admin_id, admin_id)
        product_ids = [provider_product, admin_product]

        print("== logins y RLS ==")
        admin_token, _ = login(emails["admin"], PASSWORD)
        provider_token, _ = login(emails["provider"], PASSWORD)
        seller_token, _ = login(emails["seller"], PASSWORD)
        inactive_token, _ = login(emails["inactive"], PASSWORD)

        admin_products = get(
            admin_token, "productos?select=id,nombre,proveedor_id,created_by,estado&limit=1000"
        )
        check(len(admin_products) == 2, "admin ve los 2 productos de prueba")
        admin_profiles = get(admin_token, "profiles?select=id,activo&limit=1000")
        check(len(admin_profiles) >= 4, "admin ve todos los perfiles")
        admin_roles = get(admin_token, "user_roles?select=user_id,rol&limit=1000")
        check(len(admin_roles) >= 7, "admin ve todos los roles")

        provider_products = get(
            provider_token,
            "productos?select=id,nombre,proveedor_id,created_by,estado&limit=1000",
        )
        check(
            all(product["proveedor_id"] == provider_id for product in provider_products),
            "proveedor solo ve sus productos",
        )
        check(
            admin_product not in {product["id"] for product in provider_products},
            "proveedor no ve el producto del admin",
        )
        provider_profiles = get(provider_token, "profiles?select=id,activo&limit=1000")
        check(all(row["activo"] for row in provider_profiles), "proveedor solo ve perfiles activos")
        provider_roles = get(provider_token, "user_roles?select=user_id,rol&limit=1000")
        check(
            all(row["user_id"] == provider_id for row in provider_roles),
            "proveedor solo ve sus roles",
        )

        seller_products = get(
            seller_token,
            "productos?select=id,nombre,proveedor_id,created_by,estado&limit=1000",
        )
        seller_product_ids = {product["id"] for product in seller_products}
        check(provider_product in seller_product_ids, "vendedor ve el producto de su proveedor")
        check(admin_product not in seller_product_ids, "vendedor no ve el producto del admin")
        seller_profiles = get(seller_token, "profiles?select=id,activo&limit=1000")
        check(
            {row["id"] for row in seller_profiles} == {seller_id},
            "vendedor solo ve su perfil",
        )
        seller_roles = get(seller_token, "user_roles?select=user_id,rol&limit=1000")
        check(
            all(row["user_id"] == seller_id for row in seller_roles),
            "vendedor solo ve sus roles",
        )

        inactive_products = get(
            inactive_token,
            "productos?select=id,nombre,proveedor_id,created_by,estado&limit=1000",
        )
        check(inactive_products == [], "usuario inactivo no ve productos")

        print("== venta y devolución ==")
        rpc(
            seller_token,
            "marcar_vendido",
            {"p_id": provider_product, "p_metodo_pago": "efectivo", "p_precio": 100},
        )
        sold = get(
            seller_token,
            f"productos?select=id,estado,metodo_pago,precio_venta&id=eq.{provider_product}",
        )
        check(sold and sold[0]["estado"] == "vendido", "vendedor marca vendido")
        ventas = get(
            seller_token,
            f"ventas?select=id,producto_id,vendedor_id,metodo_pago,monto,devuelta_at&producto_id=eq.{provider_product}",
        )
        check(ventas and ventas[0]["vendedor_id"] == seller_id, "la venta registra al vendedor")
        resumen = rpc(
            seller_token,
            "resumen_ventas",
            {
                "p_desde": DATES["desde"],
                "p_hasta": DATES["hasta"],
                "p_proveedor": provider_id,
                "p_granularidad": "month",
            },
        )
        check(
            any(float(row["total_efectivo"]) == 100 for row in resumen),
            "resumen del vendedor suma la venta en efectivo",
        )

        rpc(seller_token, "devolver_producto", {"p_id": provider_product})
        returned = get(
            seller_token,
            f"productos?select=id,estado&id=eq.{provider_product}",
        )
        check(returned and returned[0]["estado"] == "disponible", "vendedor devuelve el producto")
        ventas_devueltas = get(
            seller_token,
            f"ventas?select=id,devuelta_at&producto_id=eq.{provider_product}",
        )
        check(
            ventas_devueltas and ventas_devueltas[0]["devuelta_at"] is not None,
            "la devolución queda registrada en ventas",
        )

        rpc(
            provider_token,
            "marcar_vendido",
            {"p_id": provider_product, "p_metodo_pago": "tarjeta", "p_precio": 100},
        )
        provider_resumen = rpc(
            provider_token,
            "resumen_ventas",
            {
                "p_desde": DATES["desde"],
                "p_hasta": DATES["hasta"],
                "p_proveedor": provider_id,
                "p_granularidad": "month",
            },
        )
        check(
            any(float(row["total_tarjeta"]) == 100 for row in provider_resumen),
            "resumen del proveedor suma la venta con tarjeta",
        )
        rpc(provider_token, "devolver_producto", {"p_id": provider_product})

        print("== visibilidad ==")
        before = get(
            seller_token,
            f"productos?select=id&id=eq.{admin_product}",
        )
        check(before == [], "vendedor no ve el producto del admin por defecto")
        status, _ = call(
            "POST",
            "/rest/v1/product_visibility",
            {**user_headers(admin_token), "Prefer": "return=representation"},
            {"producto_id": admin_product, "user_id": seller_id, "rol": None},
        )
        check(status in (200, 201), "admin otorga visibilidad al vendedor")
        after = get(
            seller_token,
            f"productos?select=id&id=eq.{admin_product}",
        )
        check(after and after[0]["id"] == admin_product, "vendedor ve el producto tras otorgar visibilidad")

        print("\nIntegración RLS/RPC: OK")
        return 0
    finally:
        print("== limpieza ==")
        cleanup(user_ids, product_ids)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(f"\nFALLO: {exc}", file=sys.stderr)
        raise SystemExit(1)
