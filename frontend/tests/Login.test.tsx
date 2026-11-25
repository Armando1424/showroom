import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Login } from '../src/pages/Login'

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
}))

vi.mock('../src/auth/AuthProvider', () => ({
  useAuth: () => ({ session: null, signIn: mocks.signIn }),
}))

describe('Login', () => {
  beforeEach(() => {
    mocks.signIn.mockReset()
    mocks.signIn.mockResolvedValue({ error: null })
  })

  it('envía usuario y contraseña y permite ver la contraseña', async () => {
    const user = userEvent.setup()
    render(<Login />)

    await user.type(screen.getByLabelText('Correo o usuario'), 'will')
    const password = screen.getByLabelText('Contraseña')
    await user.type(password, 'Will123')

    expect(password).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }))
    expect(password).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Ocultar contraseña' }))
    expect(password).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(mocks.signIn).toHaveBeenCalledWith('will', 'Will123')
  })

  it('muestra el error de credenciales', async () => {
    mocks.signIn.mockResolvedValue({ error: 'Usuario o contraseña incorrectos.' })

    const user = userEvent.setup()
    render(<Login />)

    await user.type(screen.getByLabelText('Correo o usuario'), 'will')
    await user.type(screen.getByLabelText('Contraseña'), 'incorrecta')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByText('Usuario o contraseña incorrectos.')).toBeInTheDocument()
  })
})
