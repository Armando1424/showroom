# Edge Function: admin-users

Crea usuarios en Supabase Auth desde la página de administración **sin poner
la `service_role` en el frontend**.

## Por qué hace falta

Crear usuarios requiere la Admin API de Supabase, que solo acepta la
`service_role`. Esa clave no puede viajar al navegador. La Edge Function corre
en Supabase, recibe el JWT del administrador, comprueba que es admin y recién
entonces usa la `service_role` del lado servidor.

## Qué valida

1. `Authorization: Bearer <jwt>` presente.
2. `auth.getUser()` válido.
3. El llamador tiene `profiles.activo = true` y una fila `user_roles` con
   `rol = 'admin'`.
4. El correo tiene formato válido y la contraseña (si se usa) tiene 8+
   caracteres.

Las variables `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
`SUPABASE_SERVICE_ROLE_KEY` las inyecta Supabase automáticamente en la
función. `SITE_URL` es opcional (para el redirect de la invitación).

## Desplegar

### Opción A — GitHub Actions (recomendada)

1. Crear un token de acceso en Supabase: Account → Access Tokens.
2. Guardarlo en GitHub:

```bash
gh secret set SUPABASE_ACCESS_TOKEN --repo Armando1424/showroom
```

3. Ejecutar el workflow **Deploy functions** (`workflow_dispatch`).

El workflow despliega `admin-users` y configura `SITE_URL`.

### Opción B — CLI local

```bash
npm install -g supabase
supabase login
supabase functions deploy admin-users --project-ref tojdcyzdeigiynvvvrwz
supabase secrets set SITE_URL=https://armando1424.github.io/showroom/ \
  --project-ref tojdcyzdeigiynvvvrwz
```

## Usarlo

En la app: **Usuarios → Agregar usuario**.

- **Crear con contraseña**: crea el usuario confirmado; comparte la
  contraseña. Es el modo recomendado para probar.
- **Invitar por correo**: envía la invitación de Supabase; el usuario define
  su contraseña. Requiere Site URL/Redirect URLs correctos y la plantilla de
  invitación.

En ambos casos el trigger crea el perfil con `activo = false`; después el
admin lo activa y le asigna un rol en la misma página.

## Plan gratuito

Edge Functions está incluido en el plan gratuito dentro de sus límites. El
envío de correos de invitación usa el SMTP integrado de Supabase, que tiene
límites de frecuencia; para pruebas usa el modo contraseña.
