import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// vitest.config.ts doesn't set `test.globals`, so @testing-library/react's own
// auto-cleanup detection (which looks for a global `afterEach`) never fires —
// without this, unmounted components from previous tests pile up in the DOM.
afterEach(cleanup);
