import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { problemsListResponseSchema, type ProblemSummary } from '@code-challenger/contracts';
import { apiFetch } from '../../platform/api-client.js';

interface Filters {
  readonly difficulty: string;
  readonly tag: string;
}

const EMPTY_FILTERS: Filters = { difficulty: '', tag: '' };

const buildQuery = (filters: Filters): string => {
  const params = new URLSearchParams();
  if (filters.difficulty) {
    params.set('difficulty', filters.difficulty);
  }
  if (filters.tag) {
    params.set('tag', filters.tag);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
};

export const CatalogPage = (): React.JSX.Element => {
  const [problems, setProblems] = useState<readonly ProblemSummary[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);

    apiFetch(`/problems${buildQuery(filters)}`, problemsListResponseSchema, { signal: controller.signal })
      .then((response) => setProblems(response.problems))
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') {
          return;
        }
        setError('Failed to load problems.');
      });

    return () => controller.abort();
  }, [filters]);

  return (
    <div>
      <h1>Problems</h1>
      <form aria-label="Filter problems">
        <label>
          Difficulty
          <select
            value={filters.difficulty}
            onChange={(event) => setFilters({ ...filters, difficulty: event.target.value })}
          >
            <option value="">All</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </label>
        <label>
          Tag
          <input
            type="text"
            value={filters.tag}
            onChange={(event) => setFilters({ ...filters, tag: event.target.value })}
            placeholder="tag"
          />
        </label>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      <ul>
        {problems.map((problem) => (
          <li key={problem.id}>
            <Link to={`/problems/${problem.slug}`}>{problem.title}</Link>
            {' — '}
            {problem.difficulty}
            {problem.tags.length > 0 ? ` (${problem.tags.join(', ')})` : ''}
            {problem.solved ? ' ✓' : ''}
          </li>
        ))}
      </ul>
    </div>
  );
};
