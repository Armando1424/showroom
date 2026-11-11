# Puesta en marcha

## URLs

| Recurso | URL |
|---|---|
| Repositorio | https://github.com/Armando1424/showroom |
| GitHub Pages | https://armando1424.github.io/showroom/ |
| Supabase | https://tojdcyzdeigiynvvvrwz.supabase.co |
| Dashboard Supabase | https://supabase.com/dashboard/project/tojdcyzdeigiynvvvrwz |

## 1. Migración

En el **SQL Editor** del proyecto Supabase, ejecutar como `postgres` el
contenido de:

```text
supabase/migrations/0001_init.sql
supabase/migrations/0002_imagen.sql
supabase/migrations/0003_admin_devolucion.sql
```

`0002_imagen.sql` añade `imagen_path` (NOT NULL), el bucket privado
`productos` y sus políticas. Si tienes productos de prueba sin imagen, la
migración lo dirá; bórralos y vuelve a ejecutarla.

El bloque de reset del inicio está comentado; no lo uses en producción.
Comprobar que no hay errores y que existe el trigger `on_auth_user_created` en
`auth.users`. Después ejecutar `supabase/verify.sql`,
`supabase/verify_imagen.sql` y `supabase/verify_admin.sql`.

## 2. Auth

Dashboard → Authentication:

- Providers → Email → **desactivar "Enable signups"**.
- URL Configuration:
  - Site URL: `https://armando1424.github.io/showroom/`
  - Redirect URLs: `https://armando1424.github.io/showroom/`

## 3. Secretos de GitHub

Los dos secretos de URL ya están configurados. Faltan las claves. Ejecuta
localmente (el valor se pide de forma interactiva y no queda en el historial):

```bash
gh secret set VITE_SUPABASE_ANON_KEY --repo Armando1424/showroom
gh secret set SUPABASE_SERVICE_ROLE_KEY --repo Armando1424/showroom
gh secret set SEED_ADMIN_EMAIL --repo Armando1424/showroom
gh secret set SEED_ADMIN_PASSWORD --repo Armando1424/showroom
```

Opcional (variable, no secreto):

```bash
gh variable set SEED_ADMIN_NOMBRE --repo Armando1424/showroom --body "Armando"
```

La `service_role` solo la usan los workflows `purge` y `seed-admin`; nunca el
frontend.

## 4. Primer admin

Con la migración aplicada y los secretos configurados:

```bash
gh workflow run seed-admin.yml --repo Armando1424/showroom
gh run watch --repo Armando1424/showroom
```

El script crea el usuario en Auth (email confirmado), activa el perfil y le
asigna el rol `admin`. El `granted_by` y el actor de auditoría quedan con el
sentinela de sistema.

## 5. Desplegar el frontend

```bash
gh workflow run deploy.yml --repo Armando1424/showroom
```

Cuando termine, abrir https://armando1424.github.io/showroom/ e iniciar sesión
con el admin del paso 4.

## 6. Invitar usuarios

1. Dashboard → Authentication → Users → **Invite user**.
2. El trigger crea el perfil con `activo = false` y sin roles.
3. Entrar como admin → **Usuarios** → activar la cuenta y asignar rol
   (`proveedor` o `vendedor`).
4. El usuario ya puede iniciar sesión y verá solo lo que RLS le permita.

Las invitaciones usan la plantilla de correo de Supabase. Si el enlace no
vuelve a la app, revisar Site URL/Redirect URLs. El flujo fino de invitación
(`token_hash` + `verifyOtp` o procesar el hash antes del router) queda para una
iteración posterior.

## 7. Purga

El workflow `purge` corre a diario a las 03:00 UTC:

- etapa 1: vendidos con `sold_at` > 7 días → borrado lógico;
- etapa 2: borrados con `deleted_at` > 30 días → purga física (día 37).

Para probarlo sin esperar:

```bash
gh workflow run purge.yml --repo Armando1424/showroom
```

GitHub desactiva los crons tras 60 días sin actividad; ejecutar `purge` a mano
una vez al mes o hacer un push. Ver `docs/operacion.md`.

## 8. Verificación rápida

- [ ] Migración sin errores.
- [ ] Signups desactivados.
- [ ] Seed admin ejecutado con éxito.
- [ ] Deploy en verde y login funciona.
- [ ] Un usuario invitado no ve nada hasta ser activado y tener rol/visibilidad.
- [ ] Un vendedor sin visibilidad no ve el producto y `marcar_vendido` falla.
- [ ] Un vendedor con visibilidad marca vendido y `sold_by` es su UUID.
- [ ] `audit_log` registra la venta, el grant y la activación.
