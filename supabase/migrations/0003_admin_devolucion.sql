-- =====================================================================
-- 0003_admin_devolucion.sql
--
-- - RPC devolver_producto: solo admin; vendido -> disponible.
-- - eliminar_producto: admin puede borrar disponible o vendido;
--   el dueño no-admin sigue limitado a disponible.
-- - Auditoría: nuevo evento 'devolucion'.
--
-- Ejecutar después de 0002_imagen.sql, como postgres.
-- =====================================================================

alter table public.audit_log drop constraint if exists audit_log_accion_check;
alter table public.audit_log add constraint audit_log_accion_check check (accion in (
    'insert', 'update', 'delete', 'venta', 'devolucion', 'borrado_logico',
    'purga', 'grant', 'revoke', 'activacion', 'desactivacion'
));

-- ---------------------------------------------------------------------
-- Clasificación de auditoría: venta / devolución / borrado lógico
-- ---------------------------------------------------------------------
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
        elsif new.estado = 'disponible' and old.estado is distinct from 'disponible' then
            v_accion := 'devolucion';
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

alter function private.productos_audit() owner to postgres;
revoke all on function private.productos_audit() from public, anon;

-- ---------------------------------------------------------------------
-- RPC: devolver un producto vendido a disponible (solo admin)
-- ---------------------------------------------------------------------
create or replace function public.devolver_producto(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not private.is_admin() then
        raise exception 'Solo un administrador puede devolver un producto vendido'
            using errcode = '42501';
    end if;

    update public.productos
       set estado  = 'disponible',
           sold_by = null,
           sold_at = null
     where id = p_id
       and estado = 'vendido'
       and deleted_at is null;

    if not found then
        raise exception 'El producto no está vendido o está borrado'
            using errcode = '23514';
    end if;
end;
$$;

alter function public.devolver_producto(uuid) owner to postgres;
revoke all on function public.devolver_producto(uuid) from public, anon;
grant execute on function public.devolver_producto(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- eliminar_producto: admin puede borrar vendidos; dueño solo disponible
-- ---------------------------------------------------------------------
create or replace function public.eliminar_producto(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if private.is_admin() then
        update public.productos
           set deleted_at = pg_catalog.now(),
               deleted_by = auth.uid()
         where id = p_id
           and deleted_at is null;

        if not found then
            raise exception 'El producto ya fue borrado'
                using errcode = '23514';
        end if;

        return;
    end if;

    if not private.owns_product(p_id) then
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

alter function public.eliminar_producto(uuid) owner to postgres;
revoke all on function public.eliminar_producto(uuid) from public, anon;
grant execute on function public.eliminar_producto(uuid) to authenticated;
