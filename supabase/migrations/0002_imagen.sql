-- =====================================================================
-- 0002_imagen.sql — imagen obligatoria por producto
--
-- Ejecutar DESPUÉS de 0001_init.sql, como postgres.
-- Bucket privado "productos"; acceso por URLs firmadas y RLS.
-- Ruta del objeto: <producto_id>/<timestamp>.<ext>
-- =====================================================================

alter table public.productos add column if not exists imagen_path text;

-- Si ya hay productos de prueba sin imagen, el NOT NULL falla con un mensaje
-- claro. Bórralos (o asígnales una imagen) y vuelve a ejecutar este archivo.
do $$
begin
    if exists (select 1 from public.productos where imagen_path is null) then
        raise exception 'Hay productos sin imagen. Elimínalos o asígnales una antes de aplicar NOT NULL.';
    end if;
end;
$$;

alter table public.productos alter column imagen_path set not null;

alter table public.productos drop constraint if exists productos_imagen_path_check;
alter table public.productos add constraint productos_imagen_path_check
    check (pg_catalog.split_part(imagen_path, '/', 1) = id::text);

-- ---------------------------------------------------------------------
-- UUID seguro para políticas de Storage (devuelve null si el path es basura)
-- ---------------------------------------------------------------------
create or replace function private.try_uuid(p_text text)
returns uuid
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
    return p_text::uuid;
exception
    when invalid_text_representation then
        return null;
end;
$$;

alter function private.try_uuid(text) owner to postgres;
revoke all on function private.try_uuid(text) from public, anon;
grant execute on function private.try_uuid(text) to authenticated;

-- Existencia sin RLS: la política de Storage no debe depender de si el
-- proveedor puede ver el producto (si no lo ve, el exists daría falso).
create or replace function private.product_exists(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.productos p where p.id = p_id
    );
$$;

alter function private.product_exists(uuid) owner to postgres;
revoke all on function private.product_exists(uuid) from public, anon;
grant execute on function private.product_exists(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Bucket privado
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('productos', 'productos', false)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------
-- Políticas de Storage (storage.objects)
-- ---------------------------------------------------------------------
drop policy if exists productos_storage_select on storage.objects;
create policy productos_storage_select on storage.objects
for select to authenticated
using (
    bucket_id = 'productos'
    and (
        private.is_admin()
        or private.can_see_product(private.try_uuid((storage.foldername(name))[1]))
    )
);

drop policy if exists productos_storage_insert on storage.objects;
create policy productos_storage_insert on storage.objects
for insert to authenticated
with check (
    bucket_id = 'productos'
    and (
        private.is_admin()
        or (
            private.has_role('proveedor')
            and (
                not private.product_exists(private.try_uuid((storage.foldername(name))[1]))
                or private.owns_product(private.try_uuid((storage.foldername(name))[1]))
            )
        )
    )
);

drop policy if exists productos_storage_update on storage.objects;
create policy productos_storage_update on storage.objects
for update to authenticated
using (
    bucket_id = 'productos'
    and (
        private.is_admin()
        or private.owns_product(private.try_uuid((storage.foldername(name))[1]))
    )
)
with check (
    bucket_id = 'productos'
    and (
        private.is_admin()
        or private.owns_product(private.try_uuid((storage.foldername(name))[1]))
    )
);

drop policy if exists productos_storage_delete on storage.objects;
create policy productos_storage_delete on storage.objects
for delete to authenticated
using (
    bucket_id = 'productos'
    and (
        private.is_admin()
        or private.owns_product(private.try_uuid((storage.foldername(name))[1]))
    )
);

-- ---------------------------------------------------------------------
-- RPC para cambiar la imagen (dueño/admin, no vendido ni borrado)
-- ---------------------------------------------------------------------
create or replace function public.actualizar_imagen_producto(
    p_id          uuid,
    p_imagen_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not (private.owns_product(p_id) or private.is_admin()) then
        raise exception 'No autorizado para cambiar la imagen de este producto'
            using errcode = '42501';
    end if;

    update public.productos
       set imagen_path = p_imagen_path
     where id = p_id
       and deleted_at is null
       and estado = 'disponible';

    if not found then
        raise exception 'El producto está vendido o borrado y no se puede editar'
            using errcode = '23514';
    end if;
end;
$$;

alter function public.actualizar_imagen_producto(uuid, text) owner to postgres;
revoke all on function public.actualizar_imagen_producto(uuid, text) from public, anon;
grant execute on function public.actualizar_imagen_producto(uuid, text) to authenticated;
