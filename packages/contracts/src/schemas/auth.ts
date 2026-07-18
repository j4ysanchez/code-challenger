import { z } from 'zod';
import { emailSchema, passwordSchema, uuidSchema } from './shared.js';

export const userSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  role: z.enum(['member', 'admin']),
});

export type User = z.infer<typeof userSchema>;

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const registerResponseSchema = z.object({ user: userSchema });

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const loginResponseSchema = z.object({ user: userSchema });

export const meResponseSchema = z.object({ user: userSchema });

export const passwordResetRequestSchema = z.object({ email: emailSchema });

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});
