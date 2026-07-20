import { useEffect } from 'react';
import { BrowserRouter, Link, Route, Routes, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { meResponseSchema } from '@code-challenger/contracts';
import { apiFetch, ApiError } from './platform/api-client.js';
import { getSession, setSession, useSession } from './platform/session.js';
import { CatalogPage } from './features/catalog/CatalogPage.js';
import { ProblemPage } from './features/problem/ProblemPage.js';
import { RegisterPage } from './features/auth/RegisterPage.js';
import { LoginPage } from './features/auth/LoginPage.js';
import { ResetPage } from './features/auth/ResetPage.js';
import { HistoryPage } from './features/submissions/HistoryPage.js';
import { ProfilePage } from './features/profile/ProfilePage.js';
import { AdminProblemsPage } from './features/admin/AdminProblemsPage.js';
import { ProblemForm } from './features/admin/ProblemForm.js';

const Nav = (): React.JSX.Element => {
  const user = useSession();
  const navigate = useNavigate();

  const handleLogout = async (): Promise<void> => {
    await apiFetch('/auth/logout', z.void(), { method: 'POST' }).catch(() => undefined);
    setSession(null);
    navigate('/');
  };

  return (
    <nav>
      <Link to="/">Code Challenger</Link>
      {user ? (
        <>
          <Link to="/profile">{user.email}</Link>
          {user.role === 'admin' ? <Link to="/admin">Admin</Link> : null}
          <button type="button" onClick={() => void handleLogout()}>
            Log out
          </button>
        </>
      ) : (
        <>
          <Link to="/login">Log in</Link>
          <Link to="/register">Register</Link>
        </>
      )}
    </nav>
  );
};

/** Restores the session from the `sid` cookie on load, without blocking first paint. */
const useRestoreSession = (): void => {
  useEffect(() => {
    if (getSession()) {
      return;
    }
    apiFetch('/auth/me', meResponseSchema)
      .then((response) => setSession(response.user))
      .catch((error: unknown) => {
        if (!(error instanceof ApiError) || error.status !== 401) {
          console.error('failed to restore session', error);
        }
      });
  }, []);
};

const App = (): React.JSX.Element => {
  useRestoreSession();

  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/" element={<CatalogPage />} />
        <Route path="/problems/:slug" element={<ProblemPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset" element={<ResetPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/problems/:slug/history" element={<HistoryPage />} />
        <Route path="/admin" element={<AdminProblemsPage />} />
        <Route path="/admin/new" element={<ProblemForm />} />
        <Route path="/admin/:id" element={<ProblemForm />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
