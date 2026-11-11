import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages sirve el repo en /showroom/. Si el repo cambia de nombre,
// actualizar este base.
export default defineConfig({
  plugins: [react()],
  base: '/showroom/',
})
