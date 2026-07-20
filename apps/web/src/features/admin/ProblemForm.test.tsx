import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setSession } from '../../platform/session.js';
import { ProblemForm } from './ProblemForm.js';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ADMIN_USER = { id: 'admin-1', email: 'admin@example.com', role: 'admin' as const };
const MEMBER_USER = { id: 'member-1', email: 'member@example.com', role: 'member' as const };

const renderAt = (path: string): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/new" element={<ProblemForm />} />
        <Route path="/admin/:id" element={<ProblemForm />} />
      </Routes>
    </MemoryRouter>,
  );

const existingProblem = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'two-sum',
  title: 'Two Sum',
  statementMd: '# Two Sum',
  difficulty: 'easy' as const,
  tags: ['arrays', 'math'],
  status: 'draft' as const,
  limits: { cpuTimeLimitMs: 2000, wallTimeLimitMs: 10000, memoryLimitMb: 256 },
  starterCode: { python: 'pass', javascript: '// starter' },
};

describe('ProblemForm', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    setSession(null);
  });

  it('shows "Admins only" for a non-admin session', () => {
    setSession(MEMBER_USER);
    renderAt('/admin/new');
    expect(screen.getByText('Admins only.')).toBeInTheDocument();
  });

  it('creates a new draft problem and navigates to its edit page', async () => {
    setSession(ADMIN_USER);
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/admin/problems' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(201, { problem: existingProblem }));
      }
      if (url === '/api/admin/problems' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(jsonResponse(200, { problems: [existingProblem] }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`));
    });
    const user = userEvent.setup();

    renderAt('/admin/new');

    await user.type(screen.getByLabelText('Slug'), 'two-sum');
    await user.type(screen.getByLabelText('Title'), 'Two Sum');
    await user.type(screen.getByLabelText('Statement (Markdown)'), '# Two Sum');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Edit problem' })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/problems', expect.objectContaining({ method: 'POST' }));
  });

  it('loads an existing draft problem and saves edits via PATCH', async () => {
    setSession(ADMIN_USER);
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/admin/problems' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(jsonResponse(200, { problems: [existingProblem] }));
      }
      if (url === '/api/admin/problems/11111111-1111-1111-1111-111111111111' && init?.method === 'PATCH') {
        return Promise.resolve(
          jsonResponse(200, { problem: { ...existingProblem, title: 'Two Sum (Updated)' } }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`));
    });
    const user = userEvent.setup();

    renderAt('/admin/11111111-1111-1111-1111-111111111111');

    expect(await screen.findByDisplayValue('Two Sum')).toBeInTheDocument();
    expect(screen.getByDisplayValue('two-sum')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Two Sum (Updated)');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/problems/11111111-1111-1111-1111-111111111111',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('shows the test-case editor once editing an existing problem, and saves cases via a full PUT replace', async () => {
    setSession(ADMIN_USER);
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/admin/problems' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(jsonResponse(200, { problems: [existingProblem] }));
      }
      if (url === '/api/admin/problems/11111111-1111-1111-1111-111111111111/test-cases' && init?.method === 'PUT') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`));
    });
    const user = userEvent.setup();

    renderAt('/admin/11111111-1111-1111-1111-111111111111');

    expect(await screen.findByText('Test cases')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Input'), '2 3');
    await user.type(screen.getByLabelText('Expected output'), '5');
    await user.click(screen.getByRole('button', { name: /save test cases/i }));

    expect(await screen.findByText('Test cases saved.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/problems/11111111-1111-1111-1111-111111111111/test-cases',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ testCases: [{ input: '2 3', expectedOutput: '5', visible: true }] }),
      }),
    );
  });

  it('shows a load error when the problem id is not found', async () => {
    setSession(ADMIN_USER);
    fetchMock.mockResolvedValue(jsonResponse(200, { problems: [] }));

    renderAt('/admin/does-not-exist');

    expect(await screen.findByRole('alert')).toHaveTextContent('Problem not found.');
  });
});
