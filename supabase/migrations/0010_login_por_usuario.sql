-- 0010: login por usuario y activación que confirma el correo
--
-- - Agrega public.profiles.username (único, case-insensitive).
-- - Rellena los usuarios existentes: primer token del nombre o parte local
--   del correo, saneado a [a-z0-9._-]; resuelve colisiones con -2, -3...
-- - Genera un username único al crear usuarios nuevos (trigger de auth.users).
-- - La confirmación del correo al activar la hace la Edge Function
--   admin-users (acción set-active); no requiere cambios de esquema.
--
-- Es idempotente: se puede reaplicar sin duplicar columnas, índices ni datos.

alter table public.profiles add column if not exists username text;

-- Sanea una base y devuelve un username único.
create or replace function private.username_unico(p_base text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    base text;
    candidato text;
    sufijo integer := 1;
begin
    base := pg_catalog.lower(pg_catalog.btrim(coalesce(p_base, 'usuario')));
    base := pg_catalog.regexp_replace(base, '[^a-z0-9._-]+', '', 'g');
    base := pg_catalog.left(base, 24);
    if base = '' then
        base := 'usuario';
    end if;

    candidato := base;
    while exists (
        select 1
          from public.profiles
         where pg_catalog.lower(username) = candidato
    ) loop
        sufijo := sufijo + 1;
        candidato := base || '-' || sufijo;
    end loop;

    return candidato;
end;
$$;

-- Rellena los usuarios existentes (solo los que aún no tienen username).
do $$
declare
    fila record;
    base text;
    candidato text;
    sufijo integer;
begin
    for fila in
        select id, nombre, email
          from public.profiles
         where username is null
         order by created_at, id
    loop
        base := pg_catalog.lower(pg_catalog.btrim(
            coalesce(
                nullif(pg_catalog.split_part(coalesce(fila.nombre, ''), ' ', 1), ''),
                nullif(pg_catalog.split_part(coalesce(fila.email, ''), '@', 1), ''),
                'usuario'
            )
        ));
        base := pg_catalog.regexp_replace(base, '[^a-z0-9._-]+', '', 'g');
        base := pg_catalog.left(base, 24);
        if base = '' then
            base := 'usuario';
        end if;

        candidato := base;
        sufijo := 1;
        while exists (
            select 1
              from public.profiles
             where pg_catalog.lower(username) = candidato
               and id <> fila.id
        ) loop
            sufijo := sufijo + 1;
            candidato := base || '-' || sufijo;
        end loop;

        update public.profiles
           set username = candidato
         where id = fila.id;
    end loop;
end $$;

-- Unicidad case-insensitive. Debe crearse después del backfill.
create unique index if not exists profiles_username_unique
    on public.profiles (pg_catalog.lower(username))
    where username is not null;

-- Normaliza el username en cada escritura. La generación del valor único la
-- hacen handle_new_user y la Edge Function admin-users.
create or replace function private.profiles_normalizar_username()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.username is not null then
        new.username := pg_catalog.lower(pg_catalog.btrim(new.username));
    end if;
    return new;
end;
$$;

drop trigger if exists profiles_normalizar_username on public.profiles;
create trigger profiles_normalizar_username
before insert or update of username on public.profiles
for each row execute function private.profiles_normalizar_username();

-- handle_new_user: username desde metadata o correo, siempre único.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, nombre, email, username, activo)
    values (
        new.id,
        coalesce(
            nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'nombre'), ''),
            nullif(pg_catalog.split_part(coalesce(new.email, ''), '@', 1), ''),
            'usuario'
        ),
        nullif(new.email, ''),
        private.username_unico(coalesce(
            nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'username'), ''),
            nullif(pg_catalog.split_part(coalesce(new.email, ''), '@', 1), ''),
            'usuario'
        )),
        false
    )
    on conflict (id) do nothing;

    return new;
end;
$$;

-- Funciones internas: no deben ser ejecutables por clientes.
revoke all on function private.username_unico(text) from public, anon, authenticated;
revoke all on function private.profiles_normalizar_username() from public, anon, authenticated;
revoke all on function private.handle_new_user() from public, anon;
