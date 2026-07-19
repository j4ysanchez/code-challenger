import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { apiFetch, ApiError } from '../../platform/api-client.js';

const RequestForm = (): React.JSX.Element => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    try {
      // Always succeeds regardless of whether the email is registered (no enumeration).
      await apiFetch('/auth/password-reset/request', z.void(), { method: 'POST', body: { email } });
    } finally {
      setSubmitting(false);
      setSubmitted(true);
    }
  };

  if (submitted) {
    return <p>If an account exists for that email, an operator will relay a reset link to you shortly.</p>;
  }

  return (
    <form aria-label="Request password reset" onSubmit={(event) => void handleSubmit(event)}>
      <h1>Reset your password</h1>
      <label>
        Email
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? 'Submitting…' : 'Send reset link'}
      </button>
    </form>
  );
};

const ConfirmForm = ({ token }: { readonly token: string }): React.JSX.Element => {
  const [newPassword, setNewPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/auth/password-reset/confirm', z.void(), {
        method: 'POST',
        body: { token, newPassword },
      });
      setDone(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? 'This reset link is invalid or has expired.' : 'Failed to reset password.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <p>
        Your password has been reset. <Link to="/login">Log in</Link>.
      </p>
    );
  }

  return (
    <form aria-label="Set a new password" onSubmit={(event) => void handleSubmit(event)}>
      <h1>Choose a new password</h1>
      <label>
        New password
        <input
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Submitting…' : 'Set new password'}
      </button>
    </form>
  );
};

export const ResetPage = (): React.JSX.Element => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  return token ? <ConfirmForm token={token} /> : <RequestForm />;
};
