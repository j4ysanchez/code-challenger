import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HistoryPage } from './HistoryPage.js';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const renderHistory = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={['/problems/two-sum/history']}>
      <Routes>
        <Route path="/problems/:slug/history" element={<HistoryPage />} />
      </Routes>
    </MemoryRouter>,
  );

const SUMMARIES = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    language: 'python',
    status: 'complete',
    verdict: 'wrong_answer',
    testsPassed: 1,
    testsTotal: 2,
    createdAt: '2026-07-18T10:00:00.000Z',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    language: 'python',
    status: 'complete',
    verdict: 'accepted',
    testsPassed: 2,
    testsTotal: 2,
    createdAt: '2026-07-18T11:00:00.000Z',
  },
];

describe('HistoryPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('renders each submission\'s verdict, language, and time, newest first as returned by the API', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/problems/two-sum/submissions') {
        return Promise.resolve(jsonResponse(200, { submissions: SUMMARIES }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderHistory();

    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('wrong_answer');
    expect(rows[0]).toHaveTextContent('python');
    expect(rows[0]).toHaveTextContent('1 / 2');
    expect(rows[1]).toHaveTextContent('accepted');
  });

  it('shows submitted code as inert text when a row is expanded', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/problems/two-sum/submissions') {
        return Promise.resolve(jsonResponse(200, { submissions: [SUMMARIES[0]] }));
      }
      if (url === '/api/submissions/11111111-1111-1111-1111-111111111111') {
        return Promise.resolve(
          jsonResponse(200, {
            submission: {
              id: '11111111-1111-1111-1111-111111111111',
              problemSlug: 'two-sum',
              language: 'python',
              status: 'complete',
              verdict: 'wrong_answer',
              testsPassed: 1,
              testsTotal: 2,
              maxRuntimeMs: 10,
              maxMemoryKb: 1000,
              createdAt: '2026-07-18T10:00:00.000Z',
              completedAt: '2026-07-18T10:00:01.000Z',
              sourceCode: '<script>alert(1)</script>',
            },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    const user = userEvent.setup();

    renderHistory();
    await screen.findAllByRole('listitem');

    await user.click(screen.getByRole('button', { name: /view code/i }));

    const code = await screen.findByText('<script>alert(1)</script>');
    expect(code.tagName.toLowerCase()).not.toBe('script');
  });

  it('shows an empty state when there are no submissions yet', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { submissions: [] }));

    renderHistory();

    expect(await screen.findByText(/no submissions yet/i)).toBeInTheDocument();
  });

  it('shows an error message when the fetch fails', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));

    renderHistory();

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to load/i);
  });
});
