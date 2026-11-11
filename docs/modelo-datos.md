# Modelo de datos

## Relaciones

```text
auth.users
   │ 1:1  profiles.id → auth.users.id ON DELETE CASCADE
   ▼
profiles
   ├── 1:N  user_roles.user_id        ON DELETE CASCADE
   ├── 1:N  productos.created_by      (sin FK, "who")
   ├── 1:N  productos.updated_by      (sin FK, "who")
   ├── 1:N  productos.sold_by         (sin FK, "who")
   ├── 1:N  productos.deleted_by      (sin FK, "who")
   └── 1:N  product_visibility.user_id ON DELETE CASCADE

productos
   └── 1:N  product_visibility.producto_id ON DELETE CASCADE

audit_log: sin FKs; actor_id sin FK.
```

## Tablas

### `profiles`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | FK `auth.users(id)` ON DELETE CASCADE |
| `nombre` | `text` | no vacío |
| `email` | `text` | nullable |
| `activo` | `bool` | **default false**; lo activa un admin |
| `created_at`, `updated_at` | `timestamptz` | |

### `user_roles`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `user_id` | `uuid` | FK `profiles(id)` ON DELETE CASCADE |
| `rol` | `text` | CHECK `admin`, `proveedor`, `vendedor` |
| `granted_by` | `uuid` | "who", sin FK |
| `granted_at` | `timestamptz` | |

UNIQUE `(user_id, rol)` para evitar duplicados. Un usuario puede tener varios
roles.

### `productos`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `nombre` | `text` | no vacío |
| `descripcion` | `text` | nullable |
| `precio` | `numeric(12,2)` | **nullable**, `>= 0` |
| `estado` | `text` | `disponible` / `vendido` |
| `imagen_path` | `text` | **NOT NULL**; `<producto_id>/<archivo>` |
| `created_by`, `updated_by` | `uuid` | "who", sin FK |
| `sold_by`, `sold_at` | `uuid`, `timestamptz` | consistentes con `estado` |
| `deleted_at`, `deleted_by` | `timestamptz`, `uuid` | borrado lógico |
| `created_at`, `updated_at` | `timestamptz` | |

Índices parciales: `(sold_at) WHERE deleted_at IS NULL` y
`(deleted_at) WHERE deleted_at IS NOT NULL`.

### Imágenes (Storage)

- Bucket `productos` **privado**.
- Ruta: `<producto_id>/<timestamp>.<ext>`; el primer segmento debe ser el id
  del producto (CHECK).
- Políticas en `storage.objects`:
  - `SELECT`: admin o `can_see_product(<id>)`.
  - `INSERT`: admin o proveedor activo sobre un id nuevo o propio.
  - `UPDATE`/`DELETE`: admin o dueño.
- El frontend usa `createSignedUrl` (1 h); nunca hay URLs públicas.
- La purga física borra el objeto del bucket.

### `product_visibility`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `producto_id` | `uuid` | FK `productos(id)` ON DELETE CASCADE |
| `user_id` | `uuid` | FK `profiles(id)` ON DELETE CASCADE, nullable |
| `rol` | `text` | nullable; CHECK `admin`, `proveedor`, `vendedor` |
| `granted_by` | `uuid` | "who", sin FK |
| `granted_at` | `timestamptz` | |

CHECK `num_nonnulls(user_id, rol) = 1`: exactamente uno de los dos.
Índices únicos parciales:

```sql
UNIQUE (producto_id, user_id) WHERE user_id IS NOT NULL
UNIQUE (producto_id, rol)     WHERE rol IS NOT NULL
```

### `audit_log`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `bigint` identity PK | |
| `actor_id` | `uuid` | NOT NULL; sentinela para sistema; sin FK |
| `entidad` | `text` | `profiles`, `user_roles`, `productos`, `product_visibility` |
| `entidad_id` | `uuid` | sin FK |
| `accion` | `text` | `insert`, `update`, `delete`, `venta`, `borrado_logico`, `purga`, `grant`, `revoke`, `activacion`, `desactivacion` |
| `payload` | `jsonb` | old/new |
| `created_at` | `timestamptz` | |

## Reglas de visibilidad

- `admin` ve todo, incluidos borrados.
- El creador ve sus productos (no borrados).
- Un usuario activo ve un producto si existe una fila de `product_visibility`
  para él (`user_id`) o para cualquiera de sus roles (`rol`).
- `activo = false` bloquea `is_admin`, `has_role`, `owns_product` y
  `can_see_product`.
- Un producto vendido sigue visible; al borrarse lógicamente desaparece para
  todos menos para el admin.

## RPCs

```text
actualizar_producto(p_id, p_nombre, p_descripcion, p_precio)  -- dueño/admin, no vendido/borrado
marcar_vendido(p_id)                                          -- visible, atómico, sold_by = auth.uid()
eliminar_producto(p_id)                                       -- admin: disponible o vendido; dueño: solo disponible
actualizar_imagen_producto(p_id, p_imagen_path)               -- dueño/admin, no vendido/borrado
devolver_producto(p_id)                                       -- solo admin; vendido -> disponible
```

`productos` no tiene privilegios `UPDATE`/`DELETE` para `authenticated`; las
RPCs son `SECURITY DEFINER` y validan el actor.

## Purga

1. **Día 0**: venta (`estado = 'vendido'`, `sold_by`, `sold_at`).
2. **Día 7**: borrado lógico (`deleted_at`, `deleted_by`) — lo ejecuta el cron
   en modo sistema, no la RPC (la RPC rechaza vendidos).
3. **Día 7 + 30 = día 37**: purga física (`DELETE`), auditada como `purga`.

`X = 30` se configura con `PURGE_PHYSICAL_DAYS`.
