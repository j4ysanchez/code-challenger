import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setSession } from '../../platform/session.js';
import { ProblemPage } from './ProblemPage.js';

vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="code editor" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const PROBLEM = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'two-sum',
  title: 'Two Sum',
  statementMd: '## Statement\n\nAdd two numbers.',
  difficulty: 'easy',
  tags: ['math'],
  limits: { cpuTimeLimitMs: 2000, wallTimeLimitMs: 10000, memoryLimitMb: 256 },
  starterCode: { python: 'a starter', javascript: '// js starter' },
  visibleTestCases: [{ input: '2 3', expectedOutput: '5' }],
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const renderProblemPage = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={['/problems/two-sum']}>
      <Routes>
        <Route path="/problems/:slug" element={<ProblemPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('ProblemPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setSession(null);
  });

  it('renders the statement, examples, and starter code for an anonymous visitor', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/problems/two-sum') {
        return Promise.resolve(jsonResponse(200, { problem: PROBLEM }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderProblemPage();

    expect(await screen.findByRole('heading', { name: 'Two Sum' })).toBeInTheDocument();
    expect(screen.getByText('Add two numbers.')).toBeInTheDocument();
    expect(screen.getByText(/Input:/)).toHaveTextContent('Input: 2 3');
    await waitFor(() => expect(screen.getByLabelText('code editor')).toHaveValue('a starter'));
  });

  it('shows "Problem not found." for a 404', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: { code: 'not_found', message: 'problem not found' } }));

    renderProblemPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Problem not found.');
  });

  it('restores a saved draft instead of starter code for a signed-in member', async () => {
    setSession({ id: 'u1', email: 'a@example.com', role: 'member' });
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/problems/two-sum') {
        return Promise.resolve(jsonResponse(200, { problem: PROBLEM }));
      }
      if (url === '/api/problems/two-sum/draft?language=python') {
        return Promise.resolve(jsonResponse(200, { draft: { code: 'saved draft', updatedAt: new Date().toISOString() } }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderProblemPage();

    await waitFor(() => expect(screen.getByLabelText('code editor')).toHaveValue('saved draft'));
  });

  it('falls back to starter code when the member has no saved draft', async () => {
    setSession({ id: 'u1', email: 'a@example.com', role: 'member' });
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/problems/two-sum') {
        return Promise.resolve(jsonResponse(200, { problem: PROBLEM }));
      }
      if (url === '/api/problems/two-sum/draft?language=python') {
        return Promise.resolve(jsonResponse(200, { draft: null }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderProblemPage();

    await waitFor(() => expect(screen.getByLabelText('code editor')).toHaveValue('a starter'));
  });

  it('debounces draft autosave after an edit', async () => {
    setSession({ id: 'u1', email: 'a@example.com', role: 'member' });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/problems/two-sum') {
        return Promise.resolve(jsonResponse(200, { problem: PROBLEM }));
      }
      if (url === '/api/problems/two-sum/draft?language=python') {
        return Promise.resolve(jsonResponse(200, { draft: null }));
      }
      if (url === '/api/problems/two-sum/draft' && init?.method === 'PUT') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    const user = userEvent.setup();

    renderProblemPage();
    await waitFor(() => expect(screen.getByLabelText('code editor')).toHaveValue('a starter'));

    await user.clear(screen.getByLabelText('code editor'));
    await user.type(screen.getByLabelText('code editor'), 'edited code');

    await waitFor(
      () => {
        const putCall = fetchMock.mock.calls.find(
          (call: unknown[]) =>
            call[0] === '/api/problems/two-sum/draft' && (call[1] as RequestInit | undefined)?.method === 'PUT',
        );
        expect(putCall).toBeDefined();
      },
      { timeout: 2000 },
    );
  });
});
