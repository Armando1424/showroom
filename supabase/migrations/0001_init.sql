-- =====================================================================
-- Showroom — migración inicial (0001_init.sql)
--
-- Ejecutar como postgres en un proyecto Supabase DESECHABLE.
-- No usar FORCE ROW LEVEL SECURITY: las funciones SECURITY DEFINER deben
-- poder saltarse RLS.
--
-- Convención: las columnas "who" (created_by, updated_by, sold_by,
-- deleted_by, granted_by) no tienen FK a profiles. Son denormalizadas a
-- propósito: sobreviven al borrado de usuarios y admiten el sentinela
-- 00000000-0000-0000-0000-000000000000 para "sistema".
-- =====================================================================

-- ---------------------------------------------------------------------
-- RESET OPCIONAL (solo proyecto desechable; descomentar si se re-ejecuta)
-- ---------------------------------------------------------------------
-- drop schema if exists private cascade;
-- drop table if exists public.audit_log cascade;
-- drop table if exists public.product_visibility cascade;
-- drop table if exists public.productos cascade;
-- drop table if exists public.user_roles cascade;
-- drop table if exists public.profiles cascade;
-- drop trigger if exists on_auth_user_created on auth.users;

create schema if not exists private;
alter schema private owner to postgres;

-- =====================================================================
-- TABLAS + RLS (RLS inmediatamente después de cada CREATE TABLE)
-- =====================================================================

create table public.profiles (
    id          uuid primary key references auth.users(id) on delete cascade,
    nombre      text not null default '',
    email       text,
    activo      boolean not null default false,
    created_at  timestamptz not null default pg_catalog.now(),
    updated_at  timestamptz not null default pg_catalog.now(),
    constraint profiles_nombre_check check (pg_catalog.length(pg_catalog.btrim(nombre)) > 0),
    constraint profiles_email_check check (email is null or pg_catalog.length(pg_catalog.btrim(email)) > 0)
);
alter table public.profiles enable row level security;

create table public.user_roles (
    id          uuid primary key default pg_catalog.gen_random_uuid(),
    user_id     uuid not null references public.profiles(id) on delete cascade,
    rol         text not null,
    granted_by  uuid not null,
    granted_at  timestamptz not null default pg_catalog.now(),
    constraint user_roles_rol_check check (rol in ('admin', 'proveedor', 'vendedor')),
    constraint user_roles_user_rol_key unique (user_id, rol)
);
alter table public.user_roles enable row level security;
create index user_roles_rol_idx on public.user_roles (rol);

create table public.productos (
    id           uuid primary key default pg_catalog.gen_random_uuid(),
    nombre       text not null,
    descripcion  text,
    precio       numeric(12,2),
    estado       text not null default 'disponible',
    created_by   uuid not null,
    updated_by   uuid,
    sold_by      uuid,
    sold_at      timestamptz,
    deleted_at   timestamptz,
    deleted_by   uuid,
    created_at   timestamptz not null default pg_catalog.now(),
    updated_at   timestamptz not null default pg_catalog.now(),
    constraint productos_nombre_check check (pg_catalog.length(pg_catalog.btrim(nombre)) > 0),
    constraint productos_precio_check check (precio is null or precio >= 0),
    constraint productos_estado_check check (estado in ('disponible', 'vendido')),
    constraint productos_venta_check check (
        (estado = 'vendido' and sold_by is not null and sold_at is not null)
        or (estado = 'disponible' and sold_by is null and sold_at is null)
    ),
    constraint productos_borrado_check check (
        (deleted_at is null and deleted_by is null)
        or (deleted_at is not null and deleted_by is not null)
    )
);
alter table public.productos enable row level security;
create index productos_sold_at_idx on public.productos (sold_at) where deleted_at is null;
create index productos_deleted_at_idx on public.productos (deleted_at) where deleted_at is not null;
create index productos_created_by_idx on public.productos (created_by);

create table public.product_visibility (
    id          uuid primary key default pg_catalog.gen_random_uuid(),
    producto_id uuid not null references public.productos(id) on delete cascade,
    user_id     uuid references public.profiles(id) on delete cascade,
    rol         text,
    granted_by  uuid not null,
    granted_at  timestamptz not null default pg_catalog.now(),
    constraint product_visibility_target_check check (pg_catalog.num_nonnulls(user_id, rol) = 1),
    constraint product_visibility_rol_check check (rol is null or rol in ('admin', 'proveedor', 'vendedor'))
);
alter table public.product_visibility enable row level security;
create unique index product_visibility_user_uq
    on public.product_visibility (producto_id, user_id)
    where user_id is not null;
create unique index product_visibility_rol_uq
    on public.product_visibility (producto_id, rol)
    where rol is not null;
create index product_visibility_producto_idx on public.product_visibility (producto_id);
create index product_visibility_user_idx on public.product_visibility (user_id);
create index product_visibility_rol_idx on public.product_visibility (rol);

create table public.audit_log (
    id          bigint generated always as identity primary key,
    actor_id    uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
    entidad     text not null,
    entidad_id  uuid,
    accion      text not null,
    payload     jsonb,
    created_at  timestamptz not null default pg_catalog.now(),
    constraint audit_log_accion_check check (accion in (
        'insert', 'update', 'delete', 'venta', 'borrado_logico',
        'purga', 'grant', 'revoke', 'activacion', 'desactivacion'
    ))
);
alter table public.audit_log enable row level security;
create index audit_log_created_at_idx on public.audit_log (created_at desc);
create index audit_log_entidad_idx on public.audit_log (entidad, created_at desc);
create index audit_log_entidad_id_idx on public.audit_log (entidad_id);

comment on column public.productos.created_by is
    'Actor que creó el producto. Sin FK a profiles: denormalizado, admite el sentinela de sistema.';
comment on column public.productos.updated_by is
    'Último actor que modificó el producto. Sin FK a profiles: denormalizado, admite el sentinela de sistema.';
comment on column public.productos.sold_by is
    'Actor que vendió. Sin FK a profiles: denormalizado, admite el sentinela de sistema.';
comment on column public.productos.deleted_by is
    'Actor del borrado lógico. Sin FK a profiles: denormalizado, admite el sentinela de sistema.';
comment on column public.user_roles.granted_by is
    'Actor que otorgó el rol. Sin FK a profiles: denormalizado, admite el sentinela de sistema.';
comment on column public.product_visibility.granted_by is
    'Actor que otorgó la visibilidad. Sin FK a profiles: denormalizado, admite el sentinela de sistema.';
comment on column public.audit_log.accion is
    'Acción auditada (equivale a "acción" en el diseño).';

-- =====================================================================
-- FUNCIONES AUXILIARES (private)
-- =====================================================================

create or replace function private.es_modo_sistema()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    -- PostgREST fija el GUC "role" con SET LOCAL ROLE.
    -- current_user no sirve: dentro de SECURITY DEFINER siempre es postgres.
    select coalesce(pg_catalog.current_setting('role', true), 'none')
           not in ('authenticated', 'anon');
$$;

create or replace function private.actor_actual()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select case
        when private.es_modo_sistema()
            then '00000000-0000-0000-0000-000000000000'::uuid
        else auth.uid()
    end;
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select case
        when private.es_modo_sistema() then true
        else exists (
            select 1
            from public.user_roles ur
            join public.profiles p on p.id = ur.user_id
            where ur.user_id = auth.uid()
              and ur.rol = 'admin'
              and p.activo
        )
    end;
$$;

create or replace function private.has_role(p_rol text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select case
        when private.es_modo_sistema() then true
        else exists (
            select 1
            from public.user_roles ur
            join public.profiles p on p.id = ur.user_id
            where ur.user_id = auth.uid()
              and ur.rol = p_rol
              and p.activo
        )
    end;
$$;

create or replace function private.owns_product(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select case
        when private.es_modo_sistema() then true
        else exists (
            select 1
            from public.productos p
            join public.profiles me on me.id = auth.uid() and me.activo
            where p.id = p_id
              and p.created_by = auth.uid()
        )
    end;
$$;

create or replace function private.can_see_product(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select case
        when private.es_modo_sistema() then true
        when not exists (
            select 1 from public.profiles me
            where me.id = auth.uid() and me.activo
        ) then false
        when private.is_admin() then true
        else exists (
            select 1
            from public.productos p
            where p.id = p_id
              and (
                  p.created_by = auth.uid()
                  or exists (
                      select 1
                      from public.product_visibility pv
                      where pv.producto_id = p.id
                        and pv.user_id = auth.uid()
                  )
                  or exists (
                      select 1
                      from public.product_visibility pv
                      join public.user_roles ur
                        on ur.rol = pv.rol
                       and ur.user_id = auth.uid()
                      where pv.producto_id = p.id
                  )
              )
        )
    end;
$$;

-- Elimina overloads antiguos de intentos previos: CREATE OR REPLACE no
-- reemplaza una función si cambia el tipo de un parámetro.
drop function if exists private.log_audit(text, text, text, jsonb) cascade;
drop function if exists private.log_audit(text, text, uuid, jsonb) cascade;

create or replace function private.log_audit(
    p_entidad    text,
    p_accion     text,
    p_entidad_id uuid,
    p_payload    jsonb default null
)
returns void
language sql
security definer
set search_path = ''
as $$
    insert into public.audit_log (actor_id, entidad, entidad_id, accion, payload)
    values (private.actor_actual(), p_entidad, p_entidad_id::uuid, p_accion, p_payload);
$$;

-- =====================================================================
-- FUNCIONES DE TRIGGER
-- =====================================================================

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    new.updated_at := pg_catalog.now();
    return new;
end;
$$;

create or replace function private.profiles_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if private.es_modo_sistema() then
        return new;
    end if;

    if not private.is_admin() then
        if new.id is distinct from old.id
           or new.email is distinct from old.email
           or new.activo is distinct from old.activo then
            raise exception 'Solo un administrador puede cambiar id, email o activo'
                using errcode = '42501';
        end if;
    end if;

    return new;
end;
$$;

create or replace function private.profiles_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if private.es_modo_sistema() then
        return new;
    end if;

    if not (old.activo and not new.activo) then
        return new;
    end if;

    if not exists (
        select 1 from public.user_roles ur
        where ur.user_id = new.id and ur.rol = 'admin'
    ) then
        return new;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(825271::bigint);

    if not exists (
        select 1
        from public.user_roles ur
        join public.profiles p on p.id = ur.user_id
        where ur.rol = 'admin'
          and p.activo
          and p.id <> new.id
    ) then
        raise exception 'No se puede desactivar al último administrador activo'
            using errcode = '23514';
    end if;

    return new;
end;
$$;

create or replace function private.profiles_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if old.activo is distinct from new.activo then
        perform private.log_audit(
            'profiles',
            case when new.activo then 'activacion' else 'desactivacion' end,
            new.id,
            pg_catalog.jsonb_build_object(
                'old', pg_catalog.jsonb_build_object('activo', old.activo),
                'new', pg_catalog.jsonb_build_object('activo', new.activo)
            )
        );
    end if;

    return new;
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, nombre, email, activo)
    values (
        new.id,
        coalesce(
            nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'nombre'), ''),
            nullif(pg_catalog.split_part(coalesce(new.email, ''), '@', 1), ''),
            'usuario'
        ),
        nullif(new.email, ''),
        false
    )
    on conflict (id) do nothing;

    return new;
end;
$$;

create or replace function private.user_roles_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    new.granted_by := private.actor_actual();
    return new;
end;
$$;

create or replace function private.user_roles_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if private.es_modo_sistema() then
        if tg_op = 'DELETE' then return old; else return new; end if;
    end if;

    if tg_op = 'DELETE' then
        if old.rol <> 'admin' then return old; end if;
    else
        if old.rol <> 'admin' then return new; end if;
        if new.rol = 'admin' and new.user_id = old.user_id then return new; end if;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(825271::bigint);

    if not exists (
        select 1
        from public.user_roles ur
        join public.profiles p on p.id = ur.user_id
        where ur.rol = 'admin'
          and p.activo
          and not (ur.id = old.id)
    ) then
        if tg_op = 'UPDATE'
           and new.rol = 'admin'
           and exists (
               select 1 from public.profiles p
               where p.id = new.user_id and p.activo
           ) then
            return new;
        end if;

        raise exception 'No se puede dejar el sistema sin administradores activos'
            using errcode = '23514';
    end if;

    if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create or replace function private.user_roles_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_accion text;
    v_id     uuid;
begin
    if tg_op = 'INSERT' then
        v_accion := 'insert'; v_id := new.id;
    elsif tg_op = 'UPDATE' then
        v_accion := 'update'; v_id := new.id;
    else
        v_accion := 'delete'; v_id := old.id;
    end if;

    perform private.log_audit(
        'user_roles', v_accion, v_id,
        case
            when tg_op = 'INSERT' then pg_catalog.jsonb_build_object('new', pg_catalog.to_jsonb(new))
            when tg_op = 'DELETE' then pg_catalog.jsonb_build_object('old', pg_catalog.to_jsonb(old))
            else pg_catalog.jsonb_build_object(
                'old', pg_catalog.to_jsonb(old),
                'new', pg_catalog.to_jsonb(new)
            )
        end
    );

    if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create or replace function private.productos_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    new.created_by := private.actor_actual();
    new.updated_by := null;

    if not private.es_modo_sistema() then
        new.estado     := 'disponible';
        new.sold_by    := null;
        new.sold_at    := null;
        new.deleted_at := null;
        new.deleted_by := null;
    end if;

    return new;
end;
$$;

create or replace function private.productos_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- created_by es inmutable, incluso en modo sistema.
    new.created_by := old.created_by;
    new.updated_by := private.actor_actual();
    new.updated_at := pg_catalog.now();

    if new.estado = 'vendido' and old.estado is distinct from 'vendido' then
        new.sold_by := coalesce(new.sold_by, private.actor_actual());
        new.sold_at := coalesce(new.sold_at, pg_catalog.now());
    end if;

    if new.deleted_at is not null and old.deleted_at is null then
        new.deleted_by := coalesce(new.deleted_by, private.actor_actual());
        new.deleted_at := coalesce(new.deleted_at, pg_catalog.now());
    end if;

    return new;
end;
$$;

create or replace function private.productos_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_accion text;
begin
    if tg_op = 'INSERT' then
        perform private.log_audit(
            'productos', 'insert', new.id,
            pg_catalog.jsonb_build_object('new', pg_catalog.to_jsonb(new))
        );
        return new;

    elsif tg_op = 'UPDATE' then
        if new.estado = 'vendido' and old.estado is distinct from 'vendido' then
            v_accion := 'venta';
        elsif new.deleted_at is not null and old.deleted_at is null then
            v_accion := 'borrado_logico';
        else
            v_accion := 'update';
        end if;

        perform private.log_audit(
            'productos', v_accion, new.id,
            pg_catalog.jsonb_build_object(
                'old', pg_catalog.to_jsonb(old),
                'new', pg_catalog.to_jsonb(new)
            )
        );
        return new;

    else
        perform private.log_audit(
            'productos', 'purga', old.id,
            pg_catalog.jsonb_build_object('old', pg_catalog.to_jsonb(old))
        );
        return old;
    end if;
end;
$$;

create or replace function private.product_visibility_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    new.granted_by := private.actor_actual();
    return new;
end;
$$;

create or replace function private.product_visibility_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_accion   text;
    v_id       uuid;
    v_producto uuid;
begin
    if tg_op = 'INSERT' then
        v_accion := 'grant'; v_id := new.id; v_producto := new.producto_id;
    else
        v_accion := 'revoke'; v_id := old.id; v_producto := old.producto_id;
    end if;

    -- No auditar la cascada del borrado físico del producto.
    if tg_op = 'DELETE' and not exists (
        select 1 from public.productos p where p.id = v_producto
    ) then
        return old;
    end if;

    perform private.log_audit(
        'product_visibility', v_accion, v_id,
        pg_catalog.jsonb_build_object(
            'producto_id', v_producto,
            'user_id', case when tg_op = 'INSERT' then new.user_id else old.user_id end,
            'rol', case when tg_op = 'INSERT' then new.rol else old.rol end
        )
    );

    if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

-- =====================================================================
-- PROPIETARIOS Y PERMISOS DE FUNCIONES
-- =====================================================================

alter function private.es_modo_sistema() owner to postgres;
alter function private.actor_actual() owner to postgres;
alter function private.is_admin() owner to postgres;
alter function private.has_role(text) owner to postgres;
alter function private.owns_product(uuid) owner to postgres;
alter function private.can_see_product(uuid) owner to postgres;
alter function private.log_audit(text, text, uuid, jsonb) owner to postgres;
alter function private.set_updated_at() owner to postgres;
alter function private.profiles_before_update() owner to postgres;
alter function private.profiles_last_admin() owner to postgres;
alter function private.profiles_audit() owner to postgres;
alter function private.handle_new_user() owner to postgres;
alter function private.user_roles_before_insert() owner to postgres;
alter function private.user_roles_last_admin() owner to postgres;
alter function private.user_roles_audit() owner to postgres;
alter function private.productos_before_insert() owner to postgres;
alter function private.productos_before_update() owner to postgres;
alter function private.productos_audit() owner to postgres;
alter function private.product_visibility_before_insert() owner to postgres;
alter function private.product_visibility_audit() owner to postgres;

revoke all on function private.es_modo_sistema() from public, anon;
revoke all on function private.actor_actual() from public, anon;
revoke all on function private.is_admin() from public, anon;
revoke all on function private.has_role(text) from public, anon;
revoke all on function private.owns_product(uuid) from public, anon;
revoke all on function private.can_see_product(uuid) from public, anon;
revoke all on function private.log_audit(text, text, uuid, jsonb) from public, anon;
revoke all on function private.set_updated_at() from public, anon;
revoke all on function private.profiles_before_update() from public, anon;
revoke all on function private.profiles_last_admin() from public, anon;
revoke all on function private.profiles_audit() from public, anon;
revoke all on function private.handle_new_user() from public, anon;
revoke all on function private.user_roles_before_insert() from public, anon;
revoke all on function private.user_roles_last_admin() from public, anon;
revoke all on function private.user_roles_audit() from public, anon;
revoke all on function private.productos_before_insert() from public, anon;
revoke all on function private.productos_before_update() from public, anon;
revoke all on function private.productos_audit() from public, anon;
revoke all on function private.product_visibility_before_insert() from public, anon;
revoke all on function private.product_visibility_audit() from public, anon;

grant execute on function private.es_modo_sistema() to authenticated;
grant execute on function private.actor_actual() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.has_role(text) to authenticated;
grant execute on function private.owns_product(uuid) to authenticated;
grant execute on function private.can_see_product(uuid) to authenticated;

-- =====================================================================
-- TRIGGERS
-- =====================================================================

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

drop trigger if exists profiles_before_update on public.profiles;
create trigger profiles_before_update
before update on public.profiles
for each row execute function private.profiles_before_update();

drop trigger if exists profiles_last_admin on public.profiles;
create trigger profiles_last_admin
before update of activo on public.profiles
for each row execute function private.profiles_last_admin();

drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit
after update on public.profiles
for each row execute function private.profiles_audit();

drop trigger if exists user_roles_before_insert on public.user_roles;
create trigger user_roles_before_insert
before insert on public.user_roles
for each row execute function private.user_roles_before_insert();

drop trigger if exists user_roles_last_admin on public.user_roles;
create trigger user_roles_last_admin
before delete or update on public.user_roles
for each row execute function private.user_roles_last_admin();

drop trigger if exists user_roles_audit on public.user_roles;
create trigger user_roles_audit
after insert or update or delete on public.user_roles
for each row execute function private.user_roles_audit();

drop trigger if exists productos_before_insert on public.productos;
create trigger productos_before_insert
before insert on public.productos
for each row execute function private.productos_before_insert();

drop trigger if exists productos_before_update on public.productos;
create trigger productos_before_update
before update on public.productos
for each row execute function private.productos_before_update();

drop trigger if exists productos_audit on public.productos;
create trigger productos_audit
after insert or update or delete on public.productos
for each row execute function private.productos_audit();

drop trigger if exists product_visibility_before_insert on public.product_visibility;
create trigger product_visibility_before_insert
before insert on public.product_visibility
for each row execute function private.product_visibility_before_insert();

drop trigger if exists product_visibility_audit on public.product_visibility;
create trigger product_visibility_audit
after insert or delete on public.product_visibility
for each row execute function private.product_visibility_audit();

-- =====================================================================
-- RPCs DE NEGOCIO (public)
-- =====================================================================

create or replace function public.actualizar_producto(
    p_id          uuid,
    p_nombre      text,
    p_descripcion text,
    p_precio      numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not (private.owns_product(p_id) or private.is_admin()) then
        raise exception 'No autorizado para actualizar este producto'
            using errcode = '42501';
    end if;

    update public.productos
       set nombre      = p_nombre,
           descripcion = p_descripcion,
           precio      = p_precio
     where id = p_id
       and deleted_at is null
       and estado = 'disponible';

    if not found then
        raise exception 'El producto está vendido o borrado y no se puede editar'
            using errcode = '23514';
    end if;
end;
$$;

create or replace function public.marcar_vendido(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not private.can_see_product(p_id) then
        raise exception 'No autorizado para vender este producto'
            using errcode = '42501';
    end if;

    update public.productos
       set estado  = 'vendido',
           sold_by = auth.uid(),
           sold_at = pg_catalog.now()
     where id = p_id
       and estado = 'disponible'
       and deleted_at is null;

    if not found then
        raise exception 'El producto ya fue vendido o no está disponible'
            using errcode = '23514';
    end if;
end;
$$;

create or replace function public.eliminar_producto(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not (private.owns_product(p_id) or private.is_admin()) then
        raise exception 'No autorizado para borrar este producto'
            using errcode = '42501';
    end if;

    update public.productos
       set deleted_at = pg_catalog.now(),
           deleted_by = auth.uid()
     where id = p_id
       and deleted_at is null
       and estado = 'disponible';

    if not found then
        raise exception 'El producto ya fue borrado o vendido'
            using errcode = '23514';
    end if;
end;
$$;

alter function public.actualizar_producto(uuid, text, text, numeric) owner to postgres;
alter function public.marcar_vendido(uuid) owner to postgres;
alter function public.eliminar_producto(uuid) owner to postgres;

revoke all on function public.actualizar_producto(uuid, text, text, numeric) from public, anon;
revoke all on function public.marcar_vendido(uuid) from public, anon;
revoke all on function public.eliminar_producto(uuid) from public, anon;

grant execute on function public.actualizar_producto(uuid, text, text, numeric) to authenticated;
grant execute on function public.marcar_vendido(uuid) to authenticated;
grant execute on function public.eliminar_producto(uuid) to authenticated;

-- =====================================================================
-- RLS: POLÍTICAS
-- =====================================================================

-- profiles
create policy profiles_select on public.profiles
for select to authenticated
using (
    (select private.is_admin())
    or id = (select auth.uid())
    or ((select private.has_role('proveedor')) and activo)
);

create policy profiles_update on public.profiles
for update to authenticated
using (
    (select private.is_admin())
    or id = (select auth.uid())
)
with check (
    (select private.is_admin())
    or id = (select auth.uid())
);

-- user_roles
create policy user_roles_select on public.user_roles
for select to authenticated
using (
    (select private.is_admin())
    or user_id = (select auth.uid())
);

create policy user_roles_insert on public.user_roles
for insert to authenticated
with check ((select private.is_admin()));

create policy user_roles_update on public.user_roles
for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy user_roles_delete on public.user_roles
for delete to authenticated
using ((select private.is_admin()));

-- productos: sin políticas UPDATE ni DELETE (privilegios revocados; solo RPCs).
create policy productos_select on public.productos
for select to authenticated
using (
    (select private.is_admin())
    or (
        deleted_at is null
        and (select private.can_see_product(id))
    )
);

create policy productos_insert on public.productos
for insert to authenticated
with check (
    (select private.is_admin())
    or (select private.has_role('proveedor'))
);

-- product_visibility
create policy product_visibility_select on public.product_visibility
for select to authenticated
using (
    (select private.is_admin())
    or (select private.owns_product(producto_id))
);

create policy product_visibility_insert on public.product_visibility
for insert to authenticated
with check (
    (select private.is_admin())
    or (select private.owns_product(producto_id))
);

create policy product_visibility_delete on public.product_visibility
for delete to authenticated
using (
    (select private.is_admin())
    or (select private.owns_product(producto_id))
);

-- audit_log: solo lectura para admin; escritura exclusiva de triggers.
create policy audit_log_select on public.audit_log
for select to authenticated
using ((select private.is_admin()));

-- =====================================================================
-- PRIVILEGIOS DE TABLAS Y SCHEMAS
-- =====================================================================

revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_roles to authenticated;
grant select, insert on public.productos to authenticated;
revoke update, delete on public.productos from authenticated;
grant select, insert, delete on public.product_visibility to authenticated;
grant select on public.audit_log to authenticated;
revoke insert, update, delete on public.audit_log from authenticated;

-- Scripts de sistema (seed/purga) con service_role. No se concede escritura
-- en audit_log: esa tabla solo la escriben los triggers SECURITY DEFINER.
grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.user_roles to service_role;
grant select, insert, update, delete on public.productos to service_role;
grant select, insert, update, delete on public.product_visibility to service_role;
grant select on public.audit_log to service_role;

-- Funciones futuras: sin EXECUTE por defecto para PUBLIC/anon.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from anon;
