import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getSession, setSession } from '../../platform/session.js';
import { RegisterPage } from './RegisterPage.js';
import { LoginPage } from './LoginPage.js';
import { ResetPage } from './ResetPage.js';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const renderAt = (path: string, routes: { readonly path: string; readonly element: React.JSX.Element }[]): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {routes.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        <Route path="/" element={<p>Catalog page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('RegisterPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    setSession(null);
  });

  it('registers, logs in, sets the session, and navigates home', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/auth/register') {
        return Promise.resolve(
          jsonResponse(201, { user: { id: '11111111-1111-1111-1111-111111111111', email: 'a@example.com', role: 'member' } }),
        );
      }
      if (url === '/api/auth/login') {
        return Promise.resolve(
          jsonResponse(200, { user: { id: '11111111-1111-1111-1111-111111111111', email: 'a@example.com', role: 'member' } }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`));
    });
    const user = userEvent.setup();

    renderAt('/register', [{ path: '/register', element: <RegisterPage /> }]);

    await user.type(screen.getByLabelText('Email'), 'a@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-fine-password');
    await user.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => expect(screen.getByText('Catalog page')).toBeInTheDocument());
    expect(getSession()).toEqual({ id: '11111111-1111-1111-1111-111111111111', email: 'a@example.com', role: 'member' });
  });

  it('shows an error when the email is already registered', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: { code: 'conflict', message: 'email already registered' } }));
    const user = userEvent.setup();

    renderAt('/register', [{ path: '/register', element: <RegisterPage /> }]);

    await user.type(screen.getByLabelText('Email'), 'a@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-fine-password');
    await user.click(screen.getByRole('button', { name: /register/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('email already registered');
  });
});

describe('LoginPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    setSession(null);
  });

  it('logs in, sets the session, and navigates home', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { user: { id: '11111111-1111-1111-1111-111111111111', email: 'a@example.com', role: 'member' } }));
    const user = userEvent.setup();

    renderAt('/login', [{ path: '/login', element: <LoginPage /> }]);

    await user.type(screen.getByLabelText('Email'), 'a@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-password');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(screen.getByText('Catalog page')).toBeInTheDocument());
    expect(getSession()).toEqual({ id: '11111111-1111-1111-1111-111111111111', email: 'a@example.com', role: 'member' });
  });

  it('shows an error message for invalid credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: { code: 'unauthorized', message: 'invalid email or password' } }));
    const user = userEvent.setup();

    renderAt('/login', [{ path: '/login', element: <LoginPage /> }]);

    await user.type(screen.getByLabelText('Email'), 'a@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('invalid email or password');
    expect(getSession()).toBeNull();
  });
});

describe('ResetPage (request)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('submits a reset request and shows a non-enumerating confirmation', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    const user = userEvent.setup();

    renderAt('/reset', [{ path: '/reset', element: <ResetPage /> }]);

    await user.type(screen.getByLabelText('Email'), 'a@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(/if an account exists/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset/request',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('ResetPage (confirm)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('submits a new password with the URL token and shows success', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const user = userEvent.setup();

    renderAt('/reset', [{ path: '/reset', element: <ResetPage /> }]);
    // Simulate arriving via the reset link.
    renderAt('/reset?token=raw-token-value', [{ path: '/reset', element: <ResetPage /> }]);

    await user.type(screen.getByLabelText('New password'), 'brand-new-password');
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    expect(await screen.findByText(/password has been reset/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset/confirm',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'raw-token-value', newPassword: 'brand-new-password' }),
      }),
    );
  });

  it('shows an error for an invalid or expired token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: { code: 'validation_failed', message: 'invalid token' } }));
    const user = userEvent.setup();

    renderAt('/reset?token=bad-token', [{ path: '/reset', element: <ResetPage /> }]);

    await user.type(screen.getByLabelText('New password'), 'brand-new-password');
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or has expired/i);
  });
});
