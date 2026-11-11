import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import type { Producto } from '../types'

export function ProductoFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  const { isAdmin, isProveedor, session } = useAuth()
  const navigate = useNavigate()

  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [precio, setPrecio] = useState('')
  const [imagenFile, setImagenFile] = useState<File | null>(null)
  const [imagenActual, setImagenActual] = useState('')
  const [imagenActualUrl, setImagenActualUrl] = useState('')
  const [imagenPreview, setImagenPreview] = useState('')
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notAllowed, setNotAllowed] = useState(false)
  const blobUrl = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current)
    }
  }, [])

  useEffect(() => {
    if (!id) return

    let active = true
    setLoading(true)

    void (async () => {
      const { data, error: queryError } = await supabase
        .from('productos')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (!active) return

      if (queryError || !data) {
        setError(queryError?.message ?? 'Producto no encontrado')
        setLoading(false)
        return
      }

      const producto = data as Producto
      if (!(isAdmin || producto.created_by === session?.user.id)) {
        setNotAllowed(true)
        setLoading(false)
        return
      }

      setNombre(producto.nombre)
      setDescripcion(producto.descripcion ?? '')
      setPrecio(producto.precio == null ? '' : String(producto.precio))
      setImagenActual(producto.imagen_path)

      if (producto.imagen_path) {
        const { data: signed } = await supabase.storage
          .from('productos')
          .createSignedUrl(producto.imagen_path, 3600)

        if (active && signed?.signedUrl) {
          setImagenActualUrl(signed.signedUrl)
          setImagenPreview(signed.signedUrl)
        }
      }

      setLoading(false)
    })()

    return () => {
      active = false
    }
  }, [id, isAdmin, session?.user.id])

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null

    if (blobUrl.current) {
      URL.revokeObjectURL(blobUrl.current)
      blobUrl.current = null
    }

    setImagenFile(file)

    if (file) {
      const url = URL.createObjectURL(file)
      blobUrl.current = url
      setImagenPreview(url)
    } else {
      setImagenPreview(imagenActualUrl)
    }
  }

  async function uploadImage(file: File, productId: string): Promise<string> {
    const rawExtension = file.name.includes('.') ? file.name.split('.').pop() ?? '' : ''
    const extension = rawExtension.toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${productId}/${Date.now()}${extension ? `.${extension}` : ''}`

    const { error: uploadError } = await supabase.storage
      .from('productos')
      .upload(path, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })

    if (uploadError) throw new Error(`No se pudo subir la imagen: ${uploadError.message}`)
    return path
  }

  async function removeImage(path: string) {
    try {
      await supabase.storage.from('productos').remove([path])
    } catch {
      // Limpieza best-effort; no bloquea el flujo principal.
    }
  }

  if (!isEdit && !isAdmin && !isProveedor) {
    return <Navigate to="/" replace />
  }

  if (notAllowed) {
    return (
      <div className="card">
        <h2>No autorizado</h2>
        <p className="muted">Solo el creador del producto o un administrador puede editarlo.</p>
        <Link to="/">Volver</Link>
      </div>
    )
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    const name = nombre.trim()
    if (!name) {
      setError('El nombre es obligatorio.')
      return
    }

    const price = precio.trim() === '' ? null : Number(precio)
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      setError('El precio debe ser un número mayor o igual a 0.')
      return
    }

    if (!isEdit && !imagenFile) {
      setError('La imagen es obligatoria.')
      return
    }

    if (isEdit && !imagenFile && !imagenActual) {
      setError('La imagen es obligatoria.')
      return
    }

    setSaving(true)
    const description = descripcion.trim() || null

    if (!isEdit) {
      const file = imagenFile as File
      const productId = crypto.randomUUID()

      let imagePath: string
      try {
        imagePath = await uploadImage(file, productId)
      } catch (uploadError) {
        setError((uploadError as Error).message)
        setSaving(false)
        return
      }

      const { error: insertError } = await supabase.from('productos').insert({
        id: productId,
        nombre: name,
        descripcion: description,
        precio: price,
        imagen_path: imagePath,
      })

      if (insertError) {
        await removeImage(imagePath)
        setError(insertError.message)
        setSaving(false)
        return
      }

      navigate('/')
      return
    }

    const productId = id as string
    let newPath: string | null = null

    if (imagenFile) {
      try {
        newPath = await uploadImage(imagenFile, productId)
      } catch (uploadError) {
        setError((uploadError as Error).message)
        setSaving(false)
        return
      }
    }

    const { error: textError } = await supabase.rpc('actualizar_producto', {
      p_id: productId,
      p_nombre: name,
      p_descripcion: description,
      p_precio: price,
    })

    if (textError) {
      if (newPath) await removeImage(newPath)
      setError(textError.message)
      setSaving(false)
      return
    }

    if (newPath) {
      const { error: imageError } = await supabase.rpc('actualizar_imagen_producto', {
        p_id: productId,
        p_imagen_path: newPath,
      })

      if (imageError) {
        await removeImage(newPath)
        setError(imageError.message)
        setSaving(false)
        return
      }

      if (imagenActual) await removeImage(imagenActual)
    }

    navigate('/')
  }

  if (loading) return <p className="muted">Cargando…</p>

  return (
    <section>
      <div className="page-head">
        <h1>{isEdit ? 'Editar producto' : 'Nuevo producto'}</h1>
        <Link to="/">Volver</Link>
      </div>

      <form className="card form" onSubmit={onSubmit}>
        <label>
          Nombre
          <input
            value={nombre}
            onChange={(event) => setNombre(event.target.value)}
            maxLength={200}
            required
          />
        </label>

        <label>
          Descripción
          <textarea
            value={descripcion}
            onChange={(event) => setDescripcion(event.target.value)}
            rows={4}
            maxLength={2000}
          />
        </label>

        <label>
          Precio (opcional)
          <input
            type="number"
            min="0"
            step="0.01"
            value={precio}
            onChange={(event) => setPrecio(event.target.value)}
            placeholder="Sin precio"
          />
        </label>

        <label>
          Imagen {isEdit ? '(reemplazar, opcional)' : '(obligatoria)'}
          <input
            type="file"
            accept="image/*"
            onChange={onFileChange}
            required={!isEdit}
          />
        </label>

        {imagenPreview ? (
          <img className="preview" src={imagenPreview} alt="Vista previa del producto" />
        ) : (
          <p className="muted small">Sin imagen seleccionada.</p>
        )}

        {error && <p className="error">{error}</p>}

        <div className="row">
          <button type="submit" disabled={saving}>
            {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear producto'}
          </button>
          <Link className="button secondary" to="/">
            Cancelar
          </Link>
        </div>

        <p className="muted small">
          JPG, PNG o WebP. La imagen se guarda en un bucket privado y se muestra con una URL firmada.
        </p>

        {isEdit && (
          <p className="muted small">
            Solo se actualizan nombre, descripción, precio e imagen. Un producto vendido o borrado no se
            puede editar.
          </p>
        )}
      </form>
    </section>
  )
}
