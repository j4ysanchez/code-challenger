import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CatalogPage } from './CatalogPage.js';

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const renderCatalog = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <CatalogPage />
    </MemoryRouter>,
  );

describe('CatalogPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('renders the fetched problem list', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        problems: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            slug: 'two-sum',
            title: 'Two Sum',
            difficulty: 'easy',
            tags: ['arrays'],
          },
          {
            id: '22222222-2222-2222-2222-222222222222',
            slug: 'reverse-string',
            title: 'Reverse a String',
            difficulty: 'easy',
            tags: [],
          },
        ],
      }),
    );

    renderCatalog();

    expect(await screen.findByText('Two Sum')).toBeInTheDocument();
    expect(screen.getByText('Reverse a String')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Two Sum' })).toHaveAttribute('href', '/problems/two-sum');
  });

  it('shows a checkmark for solved problems', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        problems: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            slug: 'two-sum',
            title: 'Two Sum',
            difficulty: 'easy',
            tags: [],
            solved: true,
          },
        ],
      }),
    );

    renderCatalog();

    const item = await screen.findByText(/Two Sum/);
    expect(item.closest('li')).toHaveTextContent('✓');
  });

  it('re-fetches with a difficulty query param when the filter changes', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ problems: [] }));
    const user = userEvent.setup();
    renderCatalog();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/problems', expect.anything()));

    await user.selectOptions(screen.getByLabelText('Difficulty'), 'hard');

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/problems?difficulty=hard', expect.anything()),
    );
  });

  it('re-fetches with a tag query param when the filter changes', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ problems: [] }));
    const user = userEvent.setup();
    renderCatalog();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/problems', expect.anything()));

    await user.type(screen.getByLabelText('Tag'), 'graphs');

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/problems?tag=graphs', expect.anything()),
    );
  });

  it('shows an error message when the fetch fails', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));

    renderCatalog();

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load problems.');
  });
});
