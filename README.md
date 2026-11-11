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
├── frontend/                  # React + Vite + TS, HashRouter
├── supabase/
│   ├── functions/
│   │   └── admin-users/index.ts  # Edge Function para crear usuarios
│   ├── migrations/
│   │   ├── 0001_init.sql      # tablas, RLS, triggers, RPCs, grants
│   │   ├── 0002_imagen.sql    # imagen obligatoria + bucket privado
│   │   └── 0003_admin_devolucion.sql  # devolver venta + borrado admin
│   ├── reset.sql
│   ├── verify.sql
│   ├── verify_imagen.sql
│   └── verify_admin.sql
├── scripts/
│   ├── seed_admin.py          # primer admin (service_role, manual)
│   └── purge.py               # dos etapas (7 / 30 días)
├── .github/workflows/
│   ├── deploy.yml             # build + GitHub Pages
│   ├── purge.yml              # cron diario
│   └── seed-admin.yml         # workflow_dispatch
├── docs/
│   ├── modelo-datos.md
│   └── operacion.md
├── .env.example
└── README.md
```

## Modelo

| Tabla | Propósito |
|---|---|
| `profiles` | Perfil 1:1 con `auth.users`; `activo=false` hasta que un admin lo active. |
| `user_roles` | Roles `admin`, `proveedor`, `vendedor`; un usuario puede tener varios. |
| `productos` | Producto único; estado `disponible`/`vendido`; **imagen obligatoria**; borrado lógico. |
| `product_visibility` | Lista blanca por usuario (`user_id`) **o** por rol (`rol`). |
| `audit_log` | Historial inmutable escrito solo por triggers. |

Detalle completo en [docs/modelo-datos.md](docs/modelo-datos.md).

## Imágenes

- Cada producto exige una imagen (`imagen_path NOT NULL`).
- Bucket **privado** `productos` en Supabase Storage; ruta
  `<producto_id>/<timestamp>.<ext>`.
- El frontend sube la imagen al crear/editar y muestra URLs firmadas (1 hora).
- RLS de Storage: admin ve todo; el dueño y los usuarios con visibilidad ven
  la imagen del producto. Un vendedor sin visibilidad no puede firmar la URL.
- La purga física elimina también el objeto del bucket.
- Para aplicar: ejecutar `supabase/migrations/0002_imagen.sql` después de
  `0001_init.sql`.

## Agregar usuarios

La app tiene **Usuarios → Agregar usuario**. El formulario llama a la Edge
Function `admin-users`, que corre en Supabase con la `service_role` del lado
servidor y valida que quien llama sea admin. Nunca expone esa clave al
navegador.

- **Crear con contraseña**: usuario confirmado; comparte la contraseña.
- **Invitar por correo**: Supabase envía la invitación; el usuario define su
  contraseña (requiere Site URL/Redirect correctos).

Despliegue de la función: ver
[docs/edge-function-usuarios.md](docs/edge-function-usuarios.md). Sin la
función desplegada, usa la alternativa del Dashboard que aparece en la misma
página.

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

## Frontend

```sh
cd frontend
cp .env.example .env   # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Build de producción: `npm run build` (genera `frontend/dist`).

Pantallas: login, lista de productos, alta/edición, marcar vendido, visibilidad y
panel de usuarios/roles. HashRouter; base `/showroom/`.

## URLs

- Repo: https://github.com/Armando1424/showroom
- Pages: https://armando1424.github.io/showroom/
- Supabase: https://tojdcyzdeigiynvvvrwz.supabase.co

## Despliegue

La guía paso a paso está en [docs/puesta-en-marcha.md](docs/puesta-en-marcha.md).

1. Crear el repo `showroom` en GitHub (público, requerido por Pages gratis).
2. Settings → Pages → Source: **GitHub Actions**.
3. Secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`.
   Variable opcional: `SEED_ADMIN_NOMBRE`.
4. Ejecutar `0001_init.sql` y después `0002_imagen.sql` en Supabase.
5. Authentication → Email: **desactivar signups**.
6. Site URL y Redirect URLs: `https://armando1424.github.io/showroom/`.
7. Ejecutar `Deploy functions` para publicar `admin-users` (necesita
   `SUPABASE_ACCESS_TOKEN`).
8. Ejecutar `seed-admin` una vez (`workflow_dispatch`).
9. Crear usuarios desde **Usuarios → Agregar usuario** o desde el Dashboard,
   y activarlos/asignar roles en la app.

## Purga

- Día 7 tras la venta: borrado lógico.
- Día 37 (7 + 30): purga física.
- El cron diario mantiene Supabase despierto; GitHub desactiva crons tras 60
  días sin actividad (ver `docs/operacion.md`).

## Pendiente

- Probar la migración en un proyecto Supabase desechable.
- Configurar secretos y Pages.
- Probar el flujo de invitación del Dashboard con la app.
