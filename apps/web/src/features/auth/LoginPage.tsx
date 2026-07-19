import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginResponseSchema } from '@code-challenger/contracts';
import { apiFetch, ApiError } from '../../platform/api-client.js';
import { setSession } from '../../platform/session.js';

export const LoginPage = (): React.JSX.Element => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiFetch('/auth/login', loginResponseSchema, {
        method: 'POST',
        body: { email, password },
      });
      setSession(response.user);
      navigate('/');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to log in.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form aria-label="Log in" onSubmit={(event) => void handleSubmit(event)}>
      <h1>Log in</h1>
      <label>
        Email
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
};
