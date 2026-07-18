import { useEffect } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { meResponseSchema } from '@code-challenger/contracts';
import { apiFetch, ApiError } from './platform/api-client.js';
import { getSession, setSession, useSession } from './platform/session.js';

const CatalogPlaceholder = (): React.JSX.Element => <p>Problem catalog coming soon.</p>;

const Nav = (): React.JSX.Element => {
  const user = useSession();
  return (
    <nav>
      <Link to="/">Code Challenger</Link>
      {user ? <span>{user.email}</span> : <span>Signed out</span>}
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
        <Route path="/" element={<CatalogPlaceholder />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
