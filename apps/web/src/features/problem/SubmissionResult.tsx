import { useEffect, useState } from 'react';
import { submissionDetailResponseSchema, type SubmissionDetail } from '@code-challenger/contracts';
import { apiFetch } from '../../platform/api-client.js';

/** Poll cadence while a submission is still queued/running (contracts/api.md). */
const POLL_INTERVAL_MS = 2000;

const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

export interface SubmissionResultProps {
  readonly submissionId: string;
}

/**
 * Polls a submission until it completes and renders its verdict. All user
 * source code and program output are interpolated as plain JSX text (React
 * escapes it) — never via dangerouslySetInnerHTML — so hostile output such as
 * `<script>` tags is always shown as inert text (FR-010).
 */
export const SubmissionResult = ({ submissionId }: SubmissionResultProps): React.JSX.Element => {
  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setSubmission(null);
    setError(null);

    const tick = async (): Promise<void> => {
      try {
        const response = await apiFetch(`/submissions/${submissionId}`, submissionDetailResponseSchema, {
          signal: controller.signal,
        });
        setSubmission(response.submission);
        if (response.submission.status === 'complete') {
          clearInterval(intervalId);
        }
      } catch (caught) {
        if (isAbortError(caught)) {
          return;
        }
        setError('Failed to load submission status.');
        clearInterval(intervalId);
      }
    };

    const intervalId = setInterval(() => void tick(), POLL_INTERVAL_MS);
    void tick();

    return () => {
      clearInterval(intervalId);
      controller.abort();
    };
  }, [submissionId]);

  if (error) {
    return <p role="alert">{error}</p>;
  }
  if (!submission) {
    return <p>Loading submission…</p>;
  }
  if (submission.status !== 'complete') {
    return <p>Status: {submission.status}…</p>;
  }

  return (
    <div aria-label="Submission result">
      <p>
        Verdict: <strong>{submission.verdict}</strong>
      </p>
      <p>
        Tests passed: {submission.testsPassed} / {submission.testsTotal}
      </p>
      {submission.maxRuntimeMs !== null ? <p>Runtime: {submission.maxRuntimeMs} ms</p> : null}

      {submission.firstFailure ? (
        <section aria-label="First failing case">
          <h3>First failing case</h3>
          <p>Case {submission.firstFailure.caseIndex}</p>
          {submission.firstFailure.visible ? (
            <>
              <p>Input:</p>
              <pre>{submission.firstFailure.input}</pre>
              <p>Expected output:</p>
              <pre>{submission.firstFailure.expectedOutput}</pre>
              <p>Actual output:</p>
              <pre>{submission.firstFailure.actualOutput}</pre>
            </>
          ) : (
            <p>Hidden test case — details are not shown.</p>
          )}
        </section>
      ) : null}

      <details>
        <summary>Submitted code</summary>
        <pre>{submission.sourceCode}</pre>
      </details>
    </div>
  );
};
