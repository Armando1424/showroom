# Roles, proveedores y ventas

Especificación recibida el 2026-11-14. Este documento es el contrato para la UI y
resume lo que ya está implementado en la base (`0004_proveedores_ventas.sql`).

## Jerarquía

```text
admin  >  proveedor  >  vendedor
```

Un usuario puede tener **varios roles**. Al crear un usuario normal se le asignan
por defecto **proveedor + vendedor**; si se elige solo `vendedor`, hay que indicar
a qué proveedor pertenece.

Un admin también es proveedor y vendedor: puede hacer todo lo de los otros roles,
pero **siempre dentro de un proveedor que elige antes** de entrar a Productos o
Dinero.

## Quién ve qué

| | Productos | Usuarios | Dinero |
|---|---|---|---|
| **admin** | todos, tras elegir proveedor | todos (crear, activar, asignar roles y proveedor) | totales del proveedor elegido + desglose por vendedor |
| **proveedor** | los suyos (puede crear, vender, devolver, borrar) | **no** (no crea ni ve usuarios) | totales de sus productos + desglose por sus vendedores |
| **vendedor** | los de su proveedor (vender y devolver) | no | **solo sus ventas** dentro de ese proveedor |

Reglas que se derivan:

- El rol `proveedor` **no** puede crear usuarios ni verlos.
- El admin, al entrar a Productos o Dinero, **selecciona un proveedor**; sin
  selección no hay datos.
- Un vendedor sin proveedor asignado no puede operar (la RPC falla con un mensaje
  claro).

## Productos

- Dos apartados: **Disponibles** y **Vendidos**.
- En la lista: **solo datos, sin imagen**. Al hacer clic se abre el detalle (o se
  navega a otra pantalla) con la imagen y el resto de la información. Igual en
  ambos apartados.
- El botón de agregar producto se mantiene, con icono **`+`** para ocupar menos
  espacio.
- Al vender se elige **tarjeta o efectivo** (obligatorio).

## Dinero

- Resumen por **día, semana o mes**.
- Siempre por proveedor, y con tres cifras: **total tarjeta**, **total efectivo**
  y **suma**.
- Proveedor y admin ven además **ventas por vendedor**.
- El vendedor ve el resumen limitado a lo que él vendió.

## Base de datos

Migración `0004`:

| Objeto | Para qué |
|---|---|
| `productos.proveedor_id` | dueño del producto (backfill desde `created_by`) |
| `profiles.proveedor_id` | proveedor al que pertenece un vendedor |
| `productos.metodo_pago`, `precio_venta` | datos de la venta (`efectivo`/`tarjeta`) |
| `private.mi_proveedor_id()` | proveedor del usuario actual |
| `private.proveedor_efectivo(uuid)` | valida el proveedor sobre el que se opera |
| `private.puede_operar_producto(uuid)` | vender/devolver dentro del alcance |
| `marcar_vendido(uuid, text, numeric)` | venta con método de pago (la firma vieja sigue) |
| `devolver_producto(uuid)` | ahora también para proveedor/vendedor del proveedor |
| `resumen_ventas(...)` | totales por día/semana/mes con tarjeta y efectivo |
| `ventas_por_vendedor(...)` | desglose por vendedor (admin/proveedor) |
| `asignar_proveedor(uuid, uuid)` | asignar vendedor → proveedor (solo admin) |

### Migraciones automáticas

`.github/workflows/migrate-auto.yml` aplica las migraciones pendientes al hacer
push a `main`, con registro en `private.applied_migrations`
(`scripts/apply_migrations.py`). La primera vez marca 0001-0003 como ya aplicadas
y empieza desde 0004. Ya no hay que tocar la base a mano.

## Decisiones tomadas (y por qué)

1. **El vendedor sí ve la sección de dinero**, limitada a sus ventas. El mensaje
   decía primero "que no la vea" y después "en dinero solo ve lo que él vendió";
   se aplicó la segunda, que es la más específica. Si debe ocultarse, es un
   `if` en el menú.
2. **La venta vive en la fila del producto** (`estado`, `sold_by`, `sold_at`,
   `metodo_pago`, `precio_venta`). Un producto se vende una vez; si algún día hace
   falta historial de varias ventas del mismo artículo, habrá que mover esto a una
   tabla `ventas`.
3. **`proveedor_id` se rellenó con `created_by`** para los productos existentes.

## UI (implementada 2026-11-14)

- [x] Menú por rol y selector de proveedor para el admin (barra superior).
- [x] Productos: pestañas Disponibles/Vendidos, lista **sin imagen**, detalle en
      modal al hacer clic, botón `+` para agregar.
- [x] Venta: modal con Efectivo / Tarjeta.
- [x] Dinero: Hoy / Esta semana / Este mes, totales de tarjeta, efectivo y suma,
      tabla de productos vendidos con vendedor y método, desglose por vendedor y
      **descarga CSV**.
- [x] Usuarios: roles por defecto proveedor+vendedor; si es solo vendedor, el
      proveedor es obligatorio; se puede reasignar el proveedor por usuario.
- [x] Imagen: botón "Tomar foto" (`capture="environment"`) además de la galería.

## Historial de ventas

`0005_ventas_historial.sql` añade `public.ventas`. Hoy hay un índice único que
impide dos ventas activas del mismo producto, pero el modelo ya guarda cada
operación: para vender varias veces el mismo artículo solo hay que quitar ese
índice y el resto del flujo sigue igual.

## Preguntas abiertas

1. ¿El vendedor debe ver la pestaña de dinero o se oculta por completo?
2. ¿Un producto puede venderse más de una vez (varias unidades)? Hoy es uno a uno.
3. ¿El admin necesita un proveedor "por defecto" al iniciar sesión, o siempre
   elegirlo a mano?
