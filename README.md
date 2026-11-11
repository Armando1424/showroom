# Showroom

Aplicación web privada para showrooms: catálogo con lista blanca de
visibilidad, venta de productos y limpieza programada. Sustituye el registro
manual en iPad/Excel y el aviso por WhatsApp.

## Stack

- **Frontend**: React + Vite + TypeScript, `HashRouter`, GitHub Pages.
- **Backend**: Supabase (Postgres + RLS + RPCs `SECURITY DEFINER`).
- **Auth**: Supabase Auth (email + password). Sin registro público; usuarios
  creados por invitación desde el Dashboard.
- **Purga**: GitHub Actions (cron diario) con `service_role` desde secretos.

## Estructura

```text
showroom/
├── frontend/                  # React + Vite + TS (pendiente)
├── supabase/
│   └── migrations/
│       └── 0001_init.sql      # tablas, RLS, triggers, RPCs, grants
├── scripts/                   # seed_admin.py, purge.py (pendiente)
├── .github/workflows/         # deploy, purge, seed-admin (pendiente)
├── docs/
│   ├── modelo-datos.md
│   └── operacion.md           # pausa de Supabase, cron 60 días (pendiente)
├── .env.example
└── README.md
```

## Modelo

| Tabla | Propósito |
|---|---|
| `profiles` | Perfil 1:1 con `auth.users`; `activo=false` hasta que un admin lo active. |
| `user_roles` | Roles `admin`, `proveedor`, `vendedor`; un usuario puede tener varios. |
| `productos` | Producto único; estado `disponible`/`vendido`; borrado lógico. |
| `product_visibility` | Lista blanca por usuario (`user_id`) **o** por rol (`rol`). |
| `audit_log` | Historial inmutable escrito solo por triggers. |

Detalle completo en [docs/modelo-datos.md](docs/modelo-datos.md).

## Seguridad (resumen)

- RLS en todas las tablas; **nunca** `FORCE ROW LEVEL SECURITY` (rompería las
  funciones `SECURITY DEFINER`).
- Visibilidad default-deny: un producto no se ve hasta que exista una fila en
  `product_visibility` (para el usuario o para uno de sus roles), salvo que
  seas el creador o admin.
- `productos`: sin políticas `UPDATE`/`DELETE` y con `REVOKE UPDATE, DELETE`.
  Toda modificación pasa por las RPCs `actualizar_producto`, `marcar_vendido`
  y `eliminar_producto`.
- `audit_log`: sin `INSERT`/`UPDATE`/`DELETE` para `authenticated`; solo los
  triggers `SECURITY DEFINER` escriben. `SELECT` solo para admin.
- `service_role` nunca llega al frontend; solo scripts locales y GitHub
  Actions.
- Las columnas "who" no tienen FK: son históricas y admiten el sentinela
  `00000000-0000-0000-0000-000000000000` para operaciones de sistema.

## Aplicar la migración

En un proyecto Supabase **desechable**:

1. SQL Editor → pegar `supabase/migrations/0001_init.sql`.
2. Ejecutar como `postgres`.
3. Verificar que no hay errores y que el trigger `on_auth_user_created` quedó
   creado en `auth.users`.

El bloque de reset del inicio del archivo está comentado; úsalo solo en el
proyecto de pruebas.

## Variables de entorno

Copia `.env.example` a `.env` (frontend) y configura los secretos del repo para
los scripts.

```dotenv
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...   # solo Actions / local
```

## Pendiente

- Frontend (login, lista, alta, marcar vendido, panel admin).
- `scripts/seed_admin.py` y `scripts/purge.py`.
- Workflows `deploy`, `purge` y `seed-admin`.
- Confirmar nombre del repositorio para la URL de GitHub Pages.
