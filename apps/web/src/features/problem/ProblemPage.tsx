import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import ReactMarkdown from 'react-markdown';
import { z } from 'zod';
import {
  LANGUAGE_VERSIONS,
  createSubmissionResponseSchema,
  draftResponseSchema,
  problemDetailResponseSchema,
  type Language,
  type ProblemDetail,
} from '@code-challenger/contracts';
import { apiFetch, ApiError } from '../../platform/api-client.js';
import { useSession } from '../../platform/session.js';
import { SubmissionResult } from './SubmissionResult.js';

/** Debounce window before a code change is persisted as a draft (member-only). */
const DRAFT_SAVE_DEBOUNCE_MS = 800;

const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

const editorExtensions = (language: Language) => (language === 'python' ? [python()] : [javascript()]);

export const ProblemPage = (): React.JSX.Element => {
  const { slug } = useParams<{ slug: string }>();
  const user = useSession();
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>('python');
  const [code, setCode] = useState('');
  const [codeReady, setCodeReady] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      return;
    }
    const controller = new AbortController();
    setLoadError(null);
    setSubmissionId(null);

    apiFetch(`/problems/${slug}`, problemDetailResponseSchema, { signal: controller.signal })
      .then((response) => setProblem(response.problem))
      .catch((caught: unknown) => {
        if (isAbortError(caught)) {
          return;
        }
        setLoadError(caught instanceof ApiError && caught.status === 404 ? 'Problem not found.' : 'Failed to load problem.');
      });

    return () => controller.abort();
  }, [slug]);

  // Starter-code load, preferring a saved draft when the caller is signed in.
  useEffect(() => {
    if (!problem || !slug) {
      return;
    }
    const controller = new AbortController();
    setCodeReady(false);

    const loadInitialCode = async (): Promise<void> => {
      if (user) {
        try {
          const response = await apiFetch(`/problems/${slug}/draft?language=${language}`, draftResponseSchema, {
            signal: controller.signal,
          });
          if (response.draft) {
            setCode(response.draft.code);
            setCodeReady(true);
            return;
          }
        } catch (caught) {
          if (isAbortError(caught)) {
            return;
          }
          // fall through to starter code if the draft can't be loaded
        }
      }
      setCode(problem.starterCode[language] ?? '');
      setCodeReady(true);
    };

    void loadInitialCode();
    return () => controller.abort();
  }, [problem, language, user, slug]);

  // Debounced draft autosave — only once the initial load has settled, so we never
  // clobber a real draft with an empty editor before it finishes restoring.
  useEffect(() => {
    if (!user || !problem || !codeReady || !slug) {
      return;
    }
    const timer = setTimeout(() => {
      void apiFetch(`/problems/${slug}/draft`, z.void(), { method: 'PUT', body: { language, code } }).catch(
        () => undefined,
      );
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [code, language, user, problem, codeReady, slug]);

  const handleSubmit = async (): Promise<void> => {
    if (!slug) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await apiFetch(`/problems/${slug}/submissions`, createSubmissionResponseSchema, {
        method: 'POST',
        body: { language, source: code },
      });
      setSubmissionId(response.submission.id);
    } catch (caught) {
      setSubmitError(caught instanceof ApiError ? caught.message : 'Failed to submit.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return <p role="alert">{loadError}</p>;
  }
  if (!problem) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <h1>{problem.title}</h1>
      <p>
        {problem.difficulty} · {problem.tags.join(', ')}
      </p>
      <ReactMarkdown>{problem.statementMd}</ReactMarkdown>

      <section aria-label="Examples">
        <h2>Examples</h2>
        {problem.visibleTestCases.map((testCase, index) => (
          <pre key={index}>
            {'Input: '}
            {testCase.input}
            {'\nOutput: '}
            {testCase.expectedOutput}
          </pre>
        ))}
      </section>

      <label>
        Language
        <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
          <option value="python">Python {LANGUAGE_VERSIONS.python}</option>
          <option value="javascript">JavaScript {LANGUAGE_VERSIONS.javascript}</option>
        </select>
      </label>

      <CodeMirror value={code} extensions={editorExtensions(language)} onChange={setCode} />

      {user ? (
        <>
          <button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
          <Link to={`/problems/${slug}/history`}>View my submission history</Link>
        </>
      ) : (
        <p>Sign in to submit a solution.</p>
      )}
      {submitError ? <p role="alert">{submitError}</p> : null}
      {submissionId ? <SubmissionResult submissionId={submissionId} /> : null}
    </div>
  );
};
