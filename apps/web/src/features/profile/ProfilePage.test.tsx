import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setSession } from '../../platform/session.js';
import { ProfilePage } from './ProfilePage.js';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const renderProfile = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
  );

describe('ProfilePage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setSession({ id: '11111111-1111-1111-1111-111111111111', email: 'a@example.com', role: 'member' });
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    setSession(null);
  });

  it("shows the signed-in user's email and solved problem count", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/problems') {
        return Promise.resolve(
          jsonResponse(200, {
            problems: [
              { id: '11111111-1111-1111-1111-111111111111', slug: 'a', title: 'A', difficulty: 'easy', tags: [], solved: true },
              { id: '22222222-2222-2222-2222-222222222222', slug: 'b', title: 'B', difficulty: 'easy', tags: [], solved: false },
              { id: '33333333-3333-3333-3333-333333333333', slug: 'c', title: 'C', difficulty: 'medium', tags: [], solved: true },
            ],
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderProfile();

    expect(await screen.findByText('a@example.com')).toBeInTheDocument();
    expect(await screen.findByText(/2 \/ 3/)).toBeInTheDocument();
  });

  it('shows a prompt to sign in when there is no session', async () => {
    setSession(null);
    renderProfile();

    expect(await screen.findByText(/sign in to see your profile/i)).toBeInTheDocument();
  });
});
