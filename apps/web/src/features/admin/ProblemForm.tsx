import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { adminProblemResponseSchema, adminProblemsListResponseSchema, type AdminProblem } from '@code-challenger/contracts';
import { apiFetch, ApiError } from '../../platform/api-client.js';
import { useSession } from '../../platform/session.js';
import { TestCaseEditor } from './TestCaseEditor.js';

interface FormState {
  readonly slug: string;
  readonly title: string;
  readonly statementMd: string;
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly tags: string;
  readonly cpuTimeLimitMs: string;
  readonly wallTimeLimitMs: string;
  readonly memoryLimitMb: string;
  readonly starterPython: string;
  readonly starterJavascript: string;
}

const EMPTY_FORM: FormState = {
  slug: '',
  title: '',
  statementMd: '',
  difficulty: 'easy',
  tags: '',
  cpuTimeLimitMs: '2000',
  wallTimeLimitMs: '10000',
  memoryLimitMb: '256',
  starterPython: '',
  starterJavascript: '',
};

const toFormState = (problem: AdminProblem): FormState => ({
  slug: problem.slug,
  title: problem.title,
  statementMd: problem.statementMd,
  difficulty: problem.difficulty,
  tags: problem.tags.join(', '),
  cpuTimeLimitMs: String(problem.limits.cpuTimeLimitMs),
  wallTimeLimitMs: String(problem.limits.wallTimeLimitMs),
  memoryLimitMb: String(problem.limits.memoryLimitMb),
  starterPython: problem.starterCode.python ?? '',
  starterJavascript: problem.starterCode.javascript ?? '',
});

const toPayload = (form: FormState) => ({
  slug: form.slug,
  title: form.title,
  statementMd: form.statementMd,
  difficulty: form.difficulty,
  tags: form.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0),
  limits: {
    cpuTimeLimitMs: Number(form.cpuTimeLimitMs),
    wallTimeLimitMs: Number(form.wallTimeLimitMs),
    memoryLimitMb: Number(form.memoryLimitMb),
  },
  starterCode: { python: form.starterPython, javascript: form.starterJavascript },
});

export const ProblemForm = (): React.JSX.Element => {
  const user = useSession();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [problem, setProblem] = useState<AdminProblem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing || !id || user?.role !== 'admin') {
      return;
    }
    const controller = new AbortController();
    apiFetch('/admin/problems', adminProblemsListResponseSchema, { signal: controller.signal })
      .then((response) => {
        const found = response.problems.find((candidate) => candidate.id === id);
        if (!found) {
          setLoadError('Problem not found.');
          return;
        }
        setProblem(found);
        setForm(toFormState(found));
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') {
          return;
        }
        setLoadError('Failed to load problem.');
      });
    return () => controller.abort();
  }, [id, isEditing, user]);

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSavedMessage(null);
    try {
      if (isEditing && id) {
        const response = await apiFetch(`/admin/problems/${id}`, adminProblemResponseSchema, {
          method: 'PATCH',
          body: toPayload(form),
        });
        setProblem(response.problem);
        setSavedMessage('Saved.');
      } else {
        const response = await apiFetch('/admin/problems', adminProblemResponseSchema, {
          method: 'POST',
          body: toPayload(form),
        });
        navigate(`/admin/${response.problem.id}`);
      }
    } catch (caught) {
      setSaveError(caught instanceof ApiError ? caught.message : 'Failed to save problem.');
    } finally {
      setSaving(false);
    }
  };

  if (!user || user.role !== 'admin') {
    return <p>Admins only.</p>;
  }
  if (loadError) {
    return <p role="alert">{loadError}</p>;
  }

  const formLabel = isEditing ? 'Edit problem' : 'New problem';

  return (
    <div>
      <h1>{formLabel}</h1>
      <form aria-label={formLabel} onSubmit={(event) => void handleSubmit(event)}>
        <label>
          Slug
          <input type="text" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} required />
        </label>
        <label>
          Title
          <input type="text" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
        </label>
        <label>
          Statement (Markdown)
          <textarea
            value={form.statementMd}
            onChange={(event) => setForm({ ...form, statementMd: event.target.value })}
            required
          />
        </label>
        <label>
          Difficulty
          <select
            value={form.difficulty}
            onChange={(event) => setForm({ ...form, difficulty: event.target.value as FormState['difficulty'] })}
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </label>
        <label>
          Tags (comma-separated)
          <input type="text" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} />
        </label>
        <label>
          CPU time limit (ms)
          <input
            type="number"
            value={form.cpuTimeLimitMs}
            onChange={(event) => setForm({ ...form, cpuTimeLimitMs: event.target.value })}
          />
        </label>
        <label>
          Wall time limit (ms)
          <input
            type="number"
            value={form.wallTimeLimitMs}
            onChange={(event) => setForm({ ...form, wallTimeLimitMs: event.target.value })}
          />
        </label>
        <label>
          Memory limit (MB)
          <input
            type="number"
            value={form.memoryLimitMb}
            onChange={(event) => setForm({ ...form, memoryLimitMb: event.target.value })}
          />
        </label>
        <label>
          Python starter code
          <textarea
            value={form.starterPython}
            onChange={(event) => setForm({ ...form, starterPython: event.target.value })}
          />
        </label>
        <label>
          JavaScript starter code
          <textarea
            value={form.starterJavascript}
            onChange={(event) => setForm({ ...form, starterJavascript: event.target.value })}
          />
        </label>
        {saveError ? <p role="alert">{saveError}</p> : null}
        {savedMessage ? <p>{savedMessage}</p> : null}
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
      {isEditing && problem ? <TestCaseEditor problemId={problem.id} /> : null}
    </div>
  );
};
