import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SubmissionResult } from './SubmissionResult.js';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const BASE_SUBMISSION = {
  id: '11111111-1111-1111-1111-111111111111',
  problemSlug: 'two-sum',
  language: 'python' as const,
  createdAt: new Date().toISOString(),
  completedAt: null,
  sourceCode: 'print(1)',
  testsPassed: null,
  testsTotal: null,
  maxRuntimeMs: null,
  maxMemoryKb: null,
  verdict: null,
};

describe('SubmissionResult', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('shows a loading state before the first response arrives', () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    render(<SubmissionResult submissionId="11111111-1111-1111-1111-111111111111" />);
    expect(screen.getByText('Loading submission…')).toBeInTheDocument();
  });

  it('shows the in-progress status while queued/running', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { submission: { ...BASE_SUBMISSION, status: 'running' } }),
    );
    render(<SubmissionResult submissionId="11111111-1111-1111-1111-111111111111" />);
    expect(await screen.findByText(/Status: running/)).toBeInTheDocument();
  });

  it('renders the verdict, test counts, and runtime once complete', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        submission: {
          ...BASE_SUBMISSION,
          status: 'complete',
          verdict: 'accepted',
          testsPassed: 2,
          testsTotal: 2,
          maxRuntimeMs: 41,
          completedAt: new Date().toISOString(),
        },
      }),
    );

    render(<SubmissionResult submissionId="11111111-1111-1111-1111-111111111111" />);

    expect(await screen.findByText('accepted')).toBeInTheDocument();
    expect(screen.getByText('Tests passed: 2 / 2')).toBeInTheDocument();
    expect(screen.getByText('Runtime: 41 ms')).toBeInTheDocument();
  });

  it('renders full input/expected/actual for a visible first failure', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        submission: {
          ...BASE_SUBMISSION,
          status: 'complete',
          verdict: 'wrong_answer',
          testsPassed: 0,
          testsTotal: 1,
          firstFailure: { caseIndex: 0, visible: true, input: '2 3', expectedOutput: '5', actualOutput: '6' },
        },
      }),
    );

    render(<SubmissionResult submissionId="11111111-1111-1111-1111-111111111111" />);

    expect(await screen.findByText('2 3')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('redacts a hidden first failure to just the case index', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        submission: {
          ...BASE_SUBMISSION,
          status: 'complete',
          verdict: 'wrong_answer',
          testsPassed: 1,
          testsTotal: 2,
          firstFailure: { caseIndex: 1, visible: false },
        },
      }),
    );

    render(<SubmissionResult submissionId="11111111-1111-1111-1111-111111111111" />);

    expect(await screen.findByText('Hidden test case — details are not shown.')).toBeInTheDocument();
    expect(screen.queryByText(/Input:/)).not.toBeInTheDocument();
  });

  it('renders script-injection output as inert text, never as executed markup (FR-010)', async () => {
    const hostile = '<script>alert(1)</script>';
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        submission: {
          ...BASE_SUBMISSION,
          status: 'complete',
          verdict: 'wrong_answer',
          testsPassed: 0,
          testsTotal: 1,
          firstFailure: { caseIndex: 0, visible: true, input: 'x', expectedOutput: 'safe', actualOutput: hostile },
        },
      }),
    );

    render(<SubmissionResult submissionId="11111111-1111-1111-1111-111111111111" />);

    const rendered = await screen.findByText(hostile);
    expect(rendered.tagName).toBe('PRE');
    expect(document.querySelectorAll('script')).toHaveLength(0);
  });

  it('shows an error message when the request fails', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    render(<SubmissionResult submissionId="11111111-1111-1111-1111-111111111111" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load submission status.');
  });

  it('polls again after 2 seconds while still running', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { submission: { ...BASE_SUBMISSION, status: 'queued' } }))
      .mockResolvedValueOnce(jsonResponse(200, { submission: { ...BASE_SUBMISSION, status: 'running' } }))
      .mockResolvedValue(
        jsonResponse(200, {
          submission: { ...BASE_SUBMISSION, status: 'complete', verdict: 'accepted', testsPassed: 1, testsTotal: 1 },
        }),
      );

    render(<SubmissionResult submissionId="11111111-1111-1111-1111-111111111111" />);

    expect(await screen.findByText(/Status: queued/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Status: running/)).toBeInTheDocument(), { timeout: 3000 });
    await waitFor(() => expect(screen.getByText('accepted')).toBeInTheDocument(), { timeout: 3000 });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
