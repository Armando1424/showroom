-- 0004: proveedores, ventas con método de pago y resumen
--
-- Modelo:
--   admin      → ve todo; para operar elige un proveedor
--   proveedor  → sus productos, sus ventas y las de sus vendedores
--   vendedor   → productos de su proveedor; en dinero solo sus propias ventas
--
-- Un usuario puede tener varios roles (por defecto proveedor + vendedor).
-- Si tiene rol vendedor debe estar asignado a un proveedor (profiles.proveedor_id).
--
-- Idempotente: se puede volver a ejecutar sin romper nada.

-- =====================================================================
-- 1. Esquema
-- =====================================================================

-- Proveedor dueño del producto (quien lo registró).
alter table public.productos
    add column if not exists proveedor_id uuid references public.profiles(id) on delete restrict;

-- Vendedor asignado a un proveedor.
alter table public.profiles
    add column if not exists proveedor_id uuid references public.profiles(id) on delete restrict;

-- Datos de la venta.
alter table public.productos
    add column if not exists metodo_pago text,
    add column if not exists precio_venta numeric(12,2);

alter table public.productos
    drop constraint if exists productos_metodo_pago_check,
    add constraint productos_metodo_pago_check
        check (metodo_pago is null or metodo_pago in ('efectivo', 'tarjeta'));

alter table public.productos
    drop constraint if exists productos_venta_pago_check,
    add constraint productos_venta_pago_check check (
        (estado = 'disponible' and metodo_pago is null and precio_venta is null)
        or (estado = 'vendido' and metodo_pago is not null and precio_venta is not null)
    );

alter table public.productos
    drop constraint if exists productos_precio_venta_check,
    add constraint productos_precio_venta_check
        check (precio_venta is null or precio_venta >= 0);

-- Backfill: el dueño actual de un producto es quien lo creó.
update public.productos
   set proveedor_id = created_by
 where proveedor_id is null;

create index if not exists productos_proveedor_idx
    on public.productos (proveedor_id) where deleted_at is null;
create index if not exists productos_proveedor_sold_idx
    on public.productos (proveedor_id, sold_at) where estado = 'vendido';
create index if not exists profiles_proveedor_idx
    on public.profiles (proveedor_id) where proveedor_id is not null;

-- =====================================================================
-- 2. Helpers de alcance
-- =====================================================================

-- Proveedor del usuario actual: su propio id si es proveedor; el asignado si
-- es vendedor. NULL si no tiene ninguno.
create or replace function private.mi_proveedor_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select case
        when not exists (
            select 1 from public.profiles me
            where me.id = auth.uid() and me.activo
        ) then null::uuid
        when private.has_role('proveedor') then auth.uid()
        else (
            select p.proveedor_id
            from public.profiles p
            where p.id = auth.uid()
        )
    end;
$$;

-- Proveedor sobre el que se quiere operar, ya validado contra el rol.
-- admin: debe indicarlo; proveedor: el suyo; vendedor: el de su asignación.
create or replace function private.proveedor_efectivo(p_solicitado uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_propio uuid;
begin
    if not exists (
        select 1 from public.profiles me
        where me.id = auth.uid() and me.activo
    ) then
        raise exception 'Usuario inactivo o inexistente' using errcode = '42501';
    end if;

    if private.is_admin() then
        if p_solicitado is null then
            raise exception 'El administrador debe indicar un proveedor'
                using errcode = '22023';
        end if;
        return p_solicitado;
    end if;

    v_propio := private.mi_proveedor_id();
    if v_propio is null then
        raise exception 'El usuario no está asignado a un proveedor'
            using errcode = '42501';
    end if;
    if p_solicitado is not null and p_solicitado <> v_propio then
        raise exception 'No autorizado para operar sobre otro proveedor'
            using errcode = '42501';
    end if;
    return v_propio;
end;
$$;

-- ¿El usuario actual puede operar (vender/devolver) este producto?
create or replace function private.puede_operar_producto(p_id uuid)
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
              and p.deleted_at is null
              and (
                  private.is_admin()
                  or p.proveedor_id = private.mi_proveedor_id()
                  or p.created_by = auth.uid()
              )
        )
    end;
$$;

-- =====================================================================
-- 3. RLS de productos: por proveedor
-- =====================================================================

drop policy if exists productos_select on public.productos;
create policy productos_select on public.productos
for select to authenticated
using (
    (select private.is_admin())
    or (
        deleted_at is null
        and (
            (select private.can_see_product(id))
            or proveedor_id = (select private.mi_proveedor_id())
        )
    )
);

drop policy if exists productos_insert on public.productos;
create policy productos_insert on public.productos
for insert to authenticated
with check (
    (select private.is_admin())
    or (
        (select private.has_role('proveedor'))
        and proveedor_id = auth.uid()
    )
);

drop policy if exists productos_update on public.productos;
create policy productos_update on public.productos
for update to authenticated
using (
    (select private.is_admin())
    or (
        deleted_at is null
        and proveedor_id = (select private.mi_proveedor_id())
    )
)
with check (
    (select private.is_admin())
    or proveedor_id = (select private.mi_proveedor_id())
);

-- =====================================================================
-- 4. Vender con método de pago
-- =====================================================================

create or replace function public.marcar_vendido(
    p_id uuid,
    p_metodo_pago text,
    p_precio numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_precio numeric(12,2);
begin
    if p_metodo_pago not in ('efectivo', 'tarjeta') then
        raise exception 'Método de pago inválido: %', p_metodo_pago
            using errcode = '22023';
    end if;

    if not private.puede_operar_producto(p_id) then
        raise exception 'No autorizado para vender este producto'
            using errcode = '42501';
    end if;

    select p.precio into v_precio
    from public.productos p
    where p.id = p_id;

    update public.productos
       set estado       = 'vendido',
           sold_by      = auth.uid(),
           sold_at      = pg_catalog.now(),
           metodo_pago  = p_metodo_pago,
           precio_venta = coalesce(p_precio, v_precio, 0)
     where id = p_id
       and estado = 'disponible'
       and deleted_at is null;

    if not found then
        raise exception 'El producto ya fue vendido o no está disponible'
            using errcode = '23514';
    end if;
end;
$$;

-- Se mantiene la firma antigua para no romper clientes viejos.
create or replace function public.marcar_vendido(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.marcar_vendido(p_id, 'efectivo', null);
end;
$$;

alter function public.marcar_vendido(uuid) owner to postgres;
alter function public.marcar_vendido(uuid, text, numeric) owner to postgres;
revoke all on function public.marcar_vendido(uuid) from public, anon;
revoke all on function public.marcar_vendido(uuid, text, numeric) from public, anon;
grant execute on function public.marcar_vendido(uuid) to authenticated;
grant execute on function public.marcar_vendido(uuid, text, numeric) to authenticated;

-- Devolver: admin, proveedor dueño o vendedor de ese proveedor.
create or replace function public.devolver_producto(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not private.puede_operar_producto(p_id) then
        raise exception 'No autorizado para devolver este producto'
            using errcode = '42501';
    end if;

    update public.productos
       set estado       = 'disponible',
           sold_by      = null,
           sold_at      = null,
           metodo_pago  = null,
           precio_venta = null
     where id = p_id
       and estado = 'vendido'
       and deleted_at is null;

    if not found then
        raise exception 'El producto no está vendido'
            using errcode = '23514';
    end if;
end;
$$;

alter function public.devolver_producto(uuid) owner to postgres;
revoke all on function public.devolver_producto(uuid) from public, anon;
grant execute on function public.devolver_producto(uuid) to authenticated;

-- =====================================================================
-- 5. Resumen de dinero
-- =====================================================================

-- Totales por día, semana o mes, separados por método de pago.
-- El vendedor ve solo sus ventas; el proveedor, las de su proveedor.
create or replace function public.resumen_ventas(
    p_desde timestamptz default (pg_catalog.now() - interval '30 days'),
    p_hasta timestamptz default pg_catalog.now(),
    p_granularidad text default 'day',
    p_proveedor uuid default null,
    p_zona text default 'America/Mexico_City'
)
returns table (
    periodo date,
    num_ventas bigint,
    total_efectivo numeric,
    total_tarjeta numeric,
    total_general numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_proveedor uuid;
    v_vendedor uuid;
begin
    if p_granularidad not in ('day', 'week', 'month') then
        raise exception 'Granularidad inválida: %', p_granularidad
            using errcode = '22023';
    end if;

    v_proveedor := private.proveedor_efectivo(p_proveedor);
    v_vendedor := case
        when private.is_admin() or private.has_role('proveedor') then null
        else auth.uid()
    end;

    return query
    select
        (pg_catalog.date_trunc(p_granularidad, p.sold_at at time zone p_zona))::date as periodo,
        pg_catalog.count(*)::bigint as num_ventas,
        coalesce(pg_catalog.sum(p.precio_venta) filter (where p.metodo_pago = 'efectivo'), 0)::numeric as total_efectivo,
        coalesce(pg_catalog.sum(p.precio_venta) filter (where p.metodo_pago = 'tarjeta'), 0)::numeric as total_tarjeta,
        coalesce(pg_catalog.sum(p.precio_venta), 0)::numeric as total_general
    from public.productos p
    where p.estado = 'vendido'
      and p.deleted_at is null
      and p.proveedor_id = v_proveedor
      and p.sold_at >= p_desde
      and p.sold_at <= p_hasta
      and (v_vendedor is null or p.sold_by = v_vendedor)
    group by 1
    order by 1;
end;
$$;

alter function public.resumen_ventas(timestamptz, timestamptz, text, uuid, text) owner to postgres;
revoke all on function public.resumen_ventas(timestamptz, timestamptz, text, uuid, text) from public, anon;
grant execute on function public.resumen_ventas(timestamptz, timestamptz, text, uuid, text) to authenticated;

-- Totales por vendedor. Solo admin y el proveedor dueño.
create or replace function public.ventas_por_vendedor(
    p_desde timestamptz default (pg_catalog.now() - interval '30 days'),
    p_hasta timestamptz default pg_catalog.now(),
    p_proveedor uuid default null
)
returns table (
    vendedor_id uuid,
    nombre text,
    num_ventas bigint,
    total_efectivo numeric,
    total_tarjeta numeric,
    total_general numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_proveedor uuid;
begin
    v_proveedor := private.proveedor_efectivo(p_proveedor);

    if not (private.is_admin() or private.has_role('proveedor')) then
        raise exception 'Solo un proveedor o un administrador puede ver el desglose por vendedor'
            using errcode = '42501';
    end if;
    if not private.is_admin() and v_proveedor <> auth.uid() then
        raise exception 'No autorizado para ver ventas de otro proveedor'
            using errcode = '42501';
    end if;

    return query
    select
        p.sold_by as vendedor_id,
        coalesce(pr.nombre, '—') as nombre,
        pg_catalog.count(*)::bigint as num_ventas,
        coalesce(pg_catalog.sum(p.precio_venta) filter (where p.metodo_pago = 'efectivo'), 0)::numeric,
        coalesce(pg_catalog.sum(p.precio_venta) filter (where p.metodo_pago = 'tarjeta'), 0)::numeric,
        coalesce(pg_catalog.sum(p.precio_venta), 0)::numeric
    from public.productos p
    left join public.profiles pr on pr.id = p.sold_by
    where p.estado = 'vendido'
      and p.deleted_at is null
      and p.proveedor_id = v_proveedor
      and p.sold_at >= p_desde
      and p.sold_at <= p_hasta
      and p.sold_by is not null
    group by p.sold_by, pr.nombre
    order by 6 desc;
end;
$$;

alter function public.ventas_por_vendedor(timestamptz, timestamptz, uuid) owner to postgres;
revoke all on function public.ventas_por_vendedor(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.ventas_por_vendedor(timestamptz, timestamptz, uuid) to authenticated;

-- =====================================================================
-- 6. Asignación de proveedor a vendedores (solo admin)
-- =====================================================================

create or replace function public.asignar_proveedor(p_user uuid, p_proveedor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not private.is_admin() then
        raise exception 'Solo un administrador puede asignar proveedores'
            using errcode = '42501';
    end if;

    if p_proveedor is not null and not exists (
        select 1
        from public.user_roles ur
        join public.profiles pr on pr.id = ur.user_id
        where ur.user_id = p_proveedor
          and ur.rol = 'proveedor'
          and pr.activo
    ) then
        raise exception 'El usuario indicado no es un proveedor activo'
            using errcode = '22023';
    end if;

    update public.profiles set proveedor_id = p_proveedor where id = p_user;

    if not found then
        raise exception 'Usuario inexistente' using errcode = '22023';
    end if;
end;
$$;

alter function public.asignar_proveedor(uuid, uuid) owner to postgres;
revoke all on function public.asignar_proveedor(uuid, uuid) from public, anon;
grant execute on function public.asignar_proveedor(uuid, uuid) to authenticated;

-- Un vendedor sin proveedor no puede operar: se valida al usar las RPC, pero
-- además se impide dejar la fila incoherente.
create or replace function private.profiles_valida_vendedor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.proveedor_id is not null and new.proveedor_id = new.id then
        raise exception 'Un usuario no puede ser su propio proveedor'
            using errcode = '23514';
    end if;
    return new;
end;
$$;

drop trigger if exists profiles_valida_vendedor on public.profiles;
create trigger profiles_valida_vendedor
    before insert or update of proveedor_id on public.profiles
    for each row execute function private.profiles_valida_vendedor();
