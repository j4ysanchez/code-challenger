import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  submissionDetailResponseSchema,
  submissionsHistoryResponseSchema,
  type SubmissionDetail,
  type SubmissionSummary,
} from '@code-challenger/contracts';
import { apiFetch } from '../../platform/api-client.js';

const SubmissionRow = ({ submission }: { readonly submission: SubmissionSummary }): React.JSX.Element => {
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleToggle = async (): Promise<void> => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (detail) {
      return;
    }
    try {
      const response = await apiFetch(`/submissions/${submission.id}`, submissionDetailResponseSchema);
      setDetail(response.submission);
    } catch {
      setLoadError('Failed to load submitted code.');
    }
  };

  return (
    <li>
      <span>{submission.verdict ?? submission.status}</span>
      {' — '}
      <span>{submission.language}</span>
      {' — '}
      <span>
        {submission.testsPassed} / {submission.testsTotal}
      </span>
      {' — '}
      <time dateTime={submission.createdAt}>{submission.createdAt}</time>
      {' '}
      <button type="button" onClick={() => void handleToggle()}>
        {expanded ? 'Hide code' : 'View code'}
      </button>
      {expanded ? (
        loadError ? (
          <p role="alert">{loadError}</p>
        ) : detail ? (
          <pre>{detail.sourceCode}</pre>
        ) : (
          <p>Loading…</p>
        )
      ) : null}
    </li>
  );
};

export const HistoryPage = (): React.JSX.Element => {
  const { slug } = useParams<{ slug: string }>();
  const [submissions, setSubmissions] = useState<readonly SubmissionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      return;
    }
    const controller = new AbortController();
    setError(null);

    apiFetch(`/problems/${slug}/submissions`, submissionsHistoryResponseSchema, { signal: controller.signal })
      .then((response) => setSubmissions(response.submissions))
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') {
          return;
        }
        setError('Failed to load submission history.');
      });

    return () => controller.abort();
  }, [slug]);

  if (error) {
    return <p role="alert">{error}</p>;
  }
  if (!submissions) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <h1>Submission history</h1>
      {submissions.length === 0 ? (
        <p>No submissions yet for this problem.</p>
      ) : (
        <ul>
          {submissions.map((submission) => (
            <SubmissionRow key={submission.id} submission={submission} />
          ))}
        </ul>
      )}
    </div>
  );
};
