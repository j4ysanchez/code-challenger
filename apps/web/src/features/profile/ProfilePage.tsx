import { useEffect, useState } from 'react';
import { problemsListResponseSchema } from '@code-challenger/contracts';
import { apiFetch } from '../../platform/api-client.js';
import { useSession } from '../../platform/session.js';

export const ProfilePage = (): React.JSX.Element => {
  const user = useSession();
  const [solvedCount, setSolvedCount] = useState<number | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }
    const controller = new AbortController();
    setError(null);

    apiFetch('/problems', problemsListResponseSchema, { signal: controller.signal })
      .then((response) => {
        setTotalCount(response.problems.length);
        setSolvedCount(response.problems.filter((problem) => problem.solved).length);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') {
          return;
        }
        setError('Failed to load your solved count.');
      });

    return () => controller.abort();
  }, [user]);

  if (!user) {
    return <p>Sign in to see your profile.</p>;
  }

  return (
    <div>
      <h1>Profile</h1>
      <p>{user.email}</p>
      {error ? (
        <p role="alert">{error}</p>
      ) : solvedCount === null || totalCount === null ? (
        <p>Loading…</p>
      ) : (
        <p>
          Solved: {solvedCount} / {totalCount}
        </p>
      )}
    </div>
  );
};
