# Edge Functions: admin-users y login

Dos funciones cubren la gestión de acceso sin poner la `service_role` en el
frontend:

- **`admin-users`**: crea usuarios, activa/desactiva, confirma el correo al
  activar y permite al admin fijar una contraseña.
- **`login`**: acepta correo **o** nombre de usuario, resuelve el correo del
  lado servidor y valida la contraseña contra Supabase Auth.

## Por qué hacen falta

Crear usuarios y confirmar correos requiere la Admin API de Supabase, que solo
acepta la `service_role`. Esa clave no puede viajar al navegador. Las funciones
corren en Supabase, reciben el JWT del administrador (o el intento de login),
comprueban lo necesario y usan la `service_role` solo del lado servidor.

## Qué valida `admin-users`

1. `Authorization: Bearer <jwt>` presente.
2. `auth.getUser()` válido.
3. El llamador tiene `profiles.activo = true` y una fila `user_roles` con
   `rol = 'admin'`.
4. El correo tiene formato válido, la contraseña (si se usa) tiene 6+
   caracteres y el username, si se envía, cumple `[a-z0-9._-]{2,30}`.

Acciones (`action` en el cuerpo):

| Acción | Cuerpo | Efecto |
|---|---|---|
| `create` (por defecto) | `email`, `nombre`, `username?`, `password?` | Crea el usuario (contraseña o invitación) y devuelve `user_id` y `username`. |
| `set-active` | `user_id`, `activo` | Activa/desactiva el perfil. Al activar confirma el correo en Auth. |
| `set-password` | `user_id`, `password` | Fija una contraseña nueva y confirma el correo. |

El `username` se guarda en minúsculas y es único sin distinguir mayúsculas.
Si no se envía, se genera del nombre o de la parte local del correo.

## Qué valida `login`

Recibe `identifier` (correo o username) y `password`.

- Si el identificador no tiene `@`, busca `profiles.username` en minúsculas.
- La contraseña se pasa **tal cual**: Supabase Auth distingue mayúsculas.
- Devuelve `access_token` y `refresh_token`; el frontend los guarda con
  `supabase.auth.setSession`.
- Usuario inexistente y contraseña incorrecta devuelven el mismo 401 para no
  filtrar qué usuarios existen. Un correo sin confirmar devuelve un 403 claro.

## Desplegar

### Opción A — GitHub Actions (recomendada)

1. Crear un token de acceso en Supabase: Account → Access Tokens.
2. Guardarlo en GitHub:

```bash
gh secret set SUPABASE_ACCESS_TOKEN --repo Armando1424/showroom
```

3. Ejecutar el workflow **Deploy functions** (`workflow_dispatch`).

El workflow despliega `admin-users` y `login`, y configura `SITE_URL`.

### Opción B — CLI local

```bash
npm install -g supabase
supabase login
supabase functions deploy admin-users --project-ref tojdcyzdeigiynvvvrwz
supabase functions deploy login --project-ref tojdcyzdeigiynvvvrwz
supabase secrets set SITE_URL=https://armando1424.github.io/showroom/ \
  --project-ref tojdcyzdeigiynvvvrwz
```

## Usarlo

En la app: **Usuarios → Agregar usuario**.

- **Crear con contraseña**: crea el usuario confirmado; comparte el correo o
  el usuario y la contraseña.
- **Invitar por correo**: envía la invitación de Supabase; el usuario define
  su contraseña. Requiere Site URL/Redirect URLs correctos y la plantilla de
  invitación.

En ambos casos el trigger crea el perfil con `activo = false`; después el
admin lo activa y le asigna un rol en la misma página. **Activar confirma el
correo en Auth**, así que el usuario puede entrar aunque se haya creado desde
el Dashboard sin “Auto Confirm User”.

El botón **Contraseña** de cada usuario permite fijar una nueva contraseña
(mínimo 6 caracteres) sin salir de la app.

## Plan gratuito

Edge Functions está incluido en el plan gratuito dentro de sus límites. El
envío de correos de invitación usa el SMTP integrado de Supabase, que tiene
límites de frecuencia; para pruebas usa el modo contraseña.
