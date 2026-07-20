import { useState } from 'react';
import { z } from 'zod';
import type { TestCaseInput } from '@code-challenger/contracts';
import { apiFetch, ApiError } from '../../platform/api-client.js';

export interface TestCaseEditorProps {
  readonly problemId: string;
}

const emptyCase = (): TestCaseInput => ({ input: '', expectedOutput: '', visible: true });

export const TestCaseEditor = ({ problemId }: TestCaseEditorProps): React.JSX.Element => {
  const [testCases, setTestCases] = useState<readonly TestCaseInput[]>([emptyCase()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const updateCase = (index: number, patch: Partial<TestCaseInput>): void => {
    setTestCases(testCases.map((testCase, i) => (i === index ? { ...testCase, ...patch } : testCase)));
    setSaved(false);
  };

  const addCase = (): void => {
    setTestCases([...testCases, emptyCase()]);
    setSaved(false);
  };

  const removeCase = (index: number): void => {
    setTestCases(testCases.filter((_, i) => i !== index));
    setSaved(false);
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch(`/admin/problems/${problemId}/test-cases`, z.void(), {
        method: 'PUT',
        body: { testCases },
      });
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to save test cases.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Test cases">
      <h2>Test cases</h2>
      {testCases.map((testCase, index) => (
        <fieldset key={index}>
          <legend>Case {index + 1}</legend>
          <label>
            Input
            <textarea
              value={testCase.input}
              onChange={(event) => updateCase(index, { input: event.target.value })}
            />
          </label>
          <label>
            Expected output
            <textarea
              value={testCase.expectedOutput}
              onChange={(event) => updateCase(index, { expectedOutput: event.target.value })}
            />
          </label>
          <label>
            Visible
            <input
              type="checkbox"
              checked={testCase.visible}
              onChange={(event) => updateCase(index, { visible: event.target.checked })}
            />
          </label>
          <button type="button" onClick={() => removeCase(index)} disabled={testCases.length <= 1}>
            Remove
          </button>
        </fieldset>
      ))}
      <button type="button" onClick={addCase}>
        Add test case
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {saved ? <p>Test cases saved.</p> : null}
      <button type="button" disabled={saving} onClick={() => void handleSave()}>
        {saving ? 'Saving…' : 'Save test cases'}
      </button>
    </section>
  );
};
