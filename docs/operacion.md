# Operación

## Plan gratuito de Supabase

- Un proyecto gratuito se **pausa tras ~1 semana sin actividad**. El cron
  diario de purga hace una consulta y lo mantiene despierto.
- Si aun así se pausa: entrar al Dashboard, restaurarlo y ejecutar el workflow
  `purge` a mano (`workflow_dispatch`).
- No usar `FORCE ROW LEVEL SECURITY`: rompería las funciones
  `SECURITY DEFINER`.

## GitHub Actions

- GitHub **desactiva los workflows programados tras 60 días sin actividad en
  el repositorio**. Mitigación:
  - ejecutar `purge` manualmente al menos una vez al mes;
  - recordatorio mensual (calendario/issue);
  - cualquier push reciente también reinicia el contador.
- Los secretos (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`) viven en
  **Settings → Secrets and variables → Actions**, nunca en el repo ni en el
  frontend.
- El cron diario ejecuta dos etapas:
  1. borrado lógico de vendidos con `sold_at` anterior a `PURGE_LOGICAL_DAYS`
     (7 por defecto);
  2. purga física de borrados con `deleted_at` anterior a
     `PURGE_PHYSICAL_DAYS` (30 por defecto, es decir, día 37 desde la venta);
     además borra el objeto de la imagen del bucket `productos`.
  El script solo borra; el trigger `AFTER DELETE` audita la purga.

## GitHub Pages

- En cuenta gratuita, Pages requiere **repositorio público**. El frontend será
  público: la `anon key` es pública por diseño y RLS protege los datos.
- Nunca subir `.env`, `service_role` ni tokens. El build solo recibe
  `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
- URL esperada: `https://armando1424.github.io/showroom/` (pendiente confirmar
  el nombre del repo).

## Supabase Auth

- **Signups deshabilitados**: Dashboard → Authentication → Providers → Email →
  desactivar "Enable signups".
- Los usuarios se crean por **invitación desde el Dashboard** o con la Admin
  API (script de seed del primer admin).
- Configurar **Site URL** y **Redirect URLs** con la URL de Pages, incluido el
  nombre del repo.
- El trigger `on auth.users insert` crea el perfil con `activo = false` y sin
  roles. Un admin lo activa y le asigna roles desde la app.
- El flujo de invitación (plantilla con `token_hash` + `verifyOtp`, o procesar
  el hash antes de montar el router) se implementa en la fase del frontend y se
  valida contra la documentación vigente de Supabase.

## Imágenes

Bucket privado `productos` en Supabase Storage. La ruta es
`<producto_id>/<archivo>` y el acceso se resuelve con URLs firmadas + RLS.
La purga física elimina la imagen. La migración `0002_imagen.sql` crea el
bucket, las políticas y la RPC `actualizar_imagen_producto`.

## Primer admin

1. Crear el usuario desde el Dashboard (invitación) o con la Admin API.
2. Ejecutar el seed (`scripts/seed_admin.py` o workflow `seed-admin`):
   - `UPDATE profiles SET activo = true` (modo sistema, exento del trigger);
   - `INSERT user_roles (user_id, rol='admin')` (trigger pone `granted_by` en
     sentinela).
3. Verificar en `audit_log` la activación y el grant.

## Purga y auditoría

- La venta la hace la RPC `marcar_vendido` (`sold_by = auth.uid()`).
- El borrado lógico del día 7 lo hace el cron en modo sistema: la RPC
  `eliminar_producto` **rechaza vendidos**, así que no puede usarse para esta
  etapa.
- La purga física es un `DELETE` en modo sistema; el trigger `AFTER DELETE`
  registra `purga` con actor sentinela.
- `audit_log` es inmutable para `authenticated`: no tiene `INSERT`, `UPDATE` ni
  `DELETE`; solo `SELECT` para admin.
