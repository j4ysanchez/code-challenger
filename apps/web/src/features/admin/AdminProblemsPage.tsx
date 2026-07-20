import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { adminProblemsListResponseSchema, type AdminProblem } from '@code-challenger/contracts';
import { apiFetch, ApiError } from '../../platform/api-client.js';
import { useSession } from '../../platform/session.js';

export const AdminProblemsPage = (): React.JSX.Element => {
  const user = useSession();
  const [problems, setProblems] = useState<readonly AdminProblem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = (): (() => void) => {
    const controller = new AbortController();
    setError(null);
    apiFetch('/admin/problems', adminProblemsListResponseSchema, { signal: controller.signal })
      .then((response) => setProblems(response.problems))
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') {
          return;
        }
        setError(caught instanceof ApiError ? caught.message : 'Failed to load problems.');
      });
    return () => controller.abort();
  };

  useEffect(() => {
    if (user?.role !== 'admin') {
      return;
    }
    return load();
  }, [user]);

  const togglePublish = async (problem: AdminProblem): Promise<void> => {
    setBusyId(problem.id);
    setError(null);
    try {
      const action = problem.status === 'published' ? 'unpublish' : 'publish';
      await apiFetch(`/admin/problems/${problem.id}/${action}`, z.void(), { method: 'POST' });
      load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to update problem status.');
    } finally {
      setBusyId(null);
    }
  };

  if (!user || user.role !== 'admin') {
    return <p>Admins only.</p>;
  }

  return (
    <div>
      <h1>Admin: Problems</h1>
      <p>
        <Link to="/admin/new">New problem</Link>
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {!problems ? (
        <p>Loading…</p>
      ) : (
        <ul>
          {problems.map((problem) => (
            <li key={problem.id}>
              <Link to={`/admin/${problem.id}`}>{problem.title}</Link>
              {' — '}
              {problem.slug}
              {' — '}
              {problem.status}
              {' '}
              <button type="button" disabled={busyId === problem.id} onClick={() => void togglePublish(problem)}>
                {problem.status === 'published' ? 'Unpublish' : 'Publish'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
