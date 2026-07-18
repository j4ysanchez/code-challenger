import type { ErrorCodeValue, ErrorEnvelope } from '@code-challenger/contracts';

export const errorEnvelope = (code: ErrorCodeValue, message: string): ErrorEnvelope => ({
  error: { code, message },
});
