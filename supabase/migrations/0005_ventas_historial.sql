-- 0005: historial de ventas
--
-- Aunque hoy cada producto se vende una vez, el dinero deja de leerse de la
-- fila del producto: se registra en `public.ventas`. Así el mismo producto podrá
-- venderse varias veces en el futuro sin migrar datos ni reescribir la UI.
--
-- `productos.estado/metodo_pago/precio_venta` se conservan como espejo de la
-- venta activa (para las pantallas que ya los usan), pero la fuente de verdad
-- para importes y reportes es `ventas`.

-- =====================================================================
-- 1. Tabla de ventas
-- =====================================================================

create table if not exists public.ventas (
    id           uuid primary key default pg_catalog.gen_random_uuid(),
    producto_id  uuid not null references public.productos(id) on delete cascade,
    proveedor_id uuid not null references public.profiles(id) on delete restrict,
    vendedor_id  uuid not null references public.profiles(id) on delete restrict,
    metodo_pago  text not null,
    monto        numeric(12,2) not null,
    vendido_at   timestamptz not null default pg_catalog.now(),
    devuelta_at  timestamptz,
    devuelta_por uuid,
    created_at   timestamptz not null default pg_catalog.now(),
    constraint ventas_metodo_pago_check check (metodo_pago in ('efectivo', 'tarjeta')),
    constraint ventas_monto_check check (monto >= 0),
    constraint ventas_devuelta_check check (
        (devuelta_at is null and devuelta_por is null)
        or (devuelta_at is not null and devuelta_por is not null)
    )
);
alter table public.ventas enable row level security;

create index if not exists ventas_proveedor_fecha_idx
    on public.ventas (proveedor_id, vendido_at desc);
create index if not exists ventas_vendedor_fecha_idx
    on public.ventas (vendedor_id, vendido_at desc);
create index if not exists ventas_producto_idx
    on public.ventas (producto_id);
create unique index if not exists ventas_activa_por_producto_uq
    on public.ventas (producto_id) where devuelta_at is null;

comment on table public.ventas is
    'Historial de ventas. Una fila por operación; devuelta_at marca la devolución.';
comment on column public.ventas.monto is
    'Importe cobrado en esta venta (precio_venta del producto en el momento de vender).';

-- =====================================================================
-- 2. Alcance de lectura
-- =====================================================================

create or replace function private.puede_ver_venta(p_proveedor uuid, p_vendedor uuid)
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
        when private.has_role('proveedor') then p_proveedor = auth.uid()
        else (
            p_proveedor = private.mi_proveedor_id()
            and p_vendedor = auth.uid()
        )
    end;
$$;

drop policy if exists ventas_select on public.ventas;
create policy ventas_select on public.ventas
for select to authenticated
using ((select private.puede_ver_venta(proveedor_id, vendedor_id)));

-- La escritura pasa siempre por las RPC; no hay policy de insert/update/delete.

-- =====================================================================
-- 3. Backfill desde las ventas que ya estaban en productos
-- =====================================================================

insert into public.ventas (producto_id, proveedor_id, vendedor_id, metodo_pago, monto, vendido_at)
select p.id,
       coalesce(p.proveedor_id, p.created_by),
       coalesce(p.sold_by, p.created_by),
       coalesce(p.metodo_pago, 'efectivo'),
       coalesce(p.precio_venta, p.precio, 0),
       coalesce(p.sold_at, p.updated_at, p.created_at)
  from public.productos p
 where p.estado = 'vendido'
   and p.deleted_at is null
   and p.sold_by is not null
   and not exists (
       select 1 from public.ventas v
       where v.producto_id = p.id and v.devuelta_at is null
   );

-- =====================================================================
-- 4. Vender y devolver escribiendo en ventas
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
    v_precio    numeric(12,2);
    v_proveedor uuid;
begin
    if p_metodo_pago not in ('efectivo', 'tarjeta') then
        raise exception 'Método de pago inválido: %', p_metodo_pago
            using errcode = '22023';
    end if;

    if not private.puede_operar_producto(p_id) then
        raise exception 'No autorizado para vender este producto'
            using errcode = '42501';
    end if;

    select coalesce(p.proveedor_id, p.created_by), p.precio
      into v_proveedor, v_precio
      from public.productos p
     where p.id = p_id;

    v_precio := coalesce(p_precio, v_precio, 0);

    update public.productos
       set estado       = 'vendido',
           sold_by      = auth.uid(),
           sold_at      = pg_catalog.now(),
           metodo_pago  = p_metodo_pago,
           precio_venta = v_precio
     where id = p_id
       and estado = 'disponible'
       and deleted_at is null;

    if not found then
        raise exception 'El producto ya fue vendido o no está disponible'
            using errcode = '23514';
    end if;

    insert into public.ventas (producto_id, proveedor_id, vendedor_id, metodo_pago, monto)
    values (p_id, v_proveedor, auth.uid(), p_metodo_pago, v_precio);
end;
$$;

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

    update public.ventas
       set devuelta_at  = pg_catalog.now(),
           devuelta_por = auth.uid()
     where producto_id = p_id
       and devuelta_at is null;

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

alter function public.marcar_vendido(uuid) owner to postgres;
alter function public.marcar_vendido(uuid, text, numeric) owner to postgres;
alter function public.devolver_producto(uuid) owner to postgres;
revoke all on function public.marcar_vendido(uuid) from public, anon;
revoke all on function public.marcar_vendido(uuid, text, numeric) from public, anon;
revoke all on function public.devolver_producto(uuid) from public, anon;
grant execute on function public.marcar_vendido(uuid) to authenticated;
grant execute on function public.marcar_vendido(uuid, text, numeric) to authenticated;
grant execute on function public.devolver_producto(uuid) to authenticated;

-- =====================================================================
-- 5. Resúmenes desde ventas
-- =====================================================================

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
        (pg_catalog.date_trunc(p_granularidad, v.vendido_at at time zone p_zona))::date as periodo,
        pg_catalog.count(*)::bigint as num_ventas,
        coalesce(pg_catalog.sum(v.monto) filter (where v.metodo_pago = 'efectivo'), 0)::numeric as total_efectivo,
        coalesce(pg_catalog.sum(v.monto) filter (where v.metodo_pago = 'tarjeta'), 0)::numeric as total_tarjeta,
        coalesce(pg_catalog.sum(v.monto), 0)::numeric as total_general
    from public.ventas v
    where v.devuelta_at is null
      and v.proveedor_id = v_proveedor
      and v.vendido_at >= p_desde
      and v.vendido_at <= p_hasta
      and (v_vendedor is null or v.vendedor_id = v_vendedor)
    group by 1
    order by 1;
end;
$$;

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
        v.vendedor_id,
        coalesce(pr.nombre, '—') as nombre,
        pg_catalog.count(*)::bigint as num_ventas,
        coalesce(pg_catalog.sum(v.monto) filter (where v.metodo_pago = 'efectivo'), 0)::numeric as total_efectivo,
        coalesce(pg_catalog.sum(v.monto) filter (where v.metodo_pago = 'tarjeta'), 0)::numeric as total_tarjeta,
        coalesce(pg_catalog.sum(v.monto), 0)::numeric as total_general
    from public.ventas v
    left join public.profiles pr on pr.id = v.vendedor_id
    where v.devuelta_at is null
      and v.proveedor_id = v_proveedor
      and v.vendido_at >= p_desde
      and v.vendido_at <= p_hasta
    group by v.vendedor_id, pr.nombre
    order by 6 desc;
end;
$$;

-- Detalle para reportes: una fila por venta, con producto y vendedor.
create or replace function public.reporte_ventas(
    p_desde timestamptz default (pg_catalog.now() - interval '30 days'),
    p_hasta timestamptz default pg_catalog.now(),
    p_proveedor uuid default null,
    p_zona text default 'America/Mexico_City'
)
returns table (
    venta_id uuid,
    fecha timestamptz,
    producto text,
    vendedor text,
    metodo_pago text,
    monto numeric,
    devuelta boolean
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

    return query
    select
        v.id,
        (v.vendido_at at time zone p_zona) as fecha,
        coalesce(p.nombre, '(producto eliminado)') as producto,
        coalesce(pr.nombre, '—') as vendedor,
        v.metodo_pago,
        v.monto,
        (v.devuelta_at is not null) as devuelta
    from public.ventas v
    left join public.productos p on p.id = v.producto_id
    left join public.profiles pr on pr.id = v.vendedor_id
    where v.proveedor_id = v_proveedor
      and v.vendido_at >= p_desde
      and v.vendido_at <= p_hasta
      and (select private.puede_ver_venta(v.proveedor_id, v.vendedor_id))
    order by v.vendido_at desc;
end;
$$;

alter function public.resumen_ventas(timestamptz, timestamptz, text, uuid, text) owner to postgres;
alter function public.ventas_por_vendedor(timestamptz, timestamptz, uuid) owner to postgres;
alter function public.reporte_ventas(timestamptz, timestamptz, uuid, text) owner to postgres;
revoke all on function public.resumen_ventas(timestamptz, timestamptz, text, uuid, text) from public, anon;
revoke all on function public.ventas_por_vendedor(timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.reporte_ventas(timestamptz, timestamptz, uuid, text) from public, anon;
grant execute on function public.resumen_ventas(timestamptz, timestamptz, text, uuid, text) to authenticated;
grant execute on function public.ventas_por_vendedor(timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.reporte_ventas(timestamptz, timestamptz, uuid, text) to authenticated;
