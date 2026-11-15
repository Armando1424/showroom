-- 0008: corregir el tipo de `fecha` en reporte_ventas
--
-- `(v.vendido_at at time zone p_zona)` devuelve `timestamp without time zone`,
-- pero la función declara `fecha timestamptz`. Postgres lo rechaza en ejecución
-- con "structure of query does not match function result type".
--
-- Se devuelve el instante tal cual (UTC) y el navegador lo muestra en la hora
-- local con toLocaleString.

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
        v.vendido_at,
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

alter function public.reporte_ventas(timestamptz, timestamptz, uuid, text) owner to postgres;
revoke all on function public.reporte_ventas(timestamptz, timestamptz, uuid, text) from public, anon;
grant execute on function public.reporte_ventas(timestamptz, timestamptz, uuid, text) to authenticated;
