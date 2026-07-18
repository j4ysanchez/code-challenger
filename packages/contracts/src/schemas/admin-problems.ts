import { z } from 'zod';
import { problemStatusSchema } from '../primitives.js';
import {
  difficultySchema,
  resourceLimitsSchema,
  slugSchema,
  tagsSchema,
  testCaseTextSchema,
  titleSchema,
  uuidSchema,
} from './shared.js';
import { starterCodeSchema } from './problems.js';

export const createProblemRequestSchema = z.object({
  slug: slugSchema,
  title: titleSchema,
  statementMd: z.string().min(1),
  difficulty: difficultySchema,
  tags: tagsSchema,
  limits: resourceLimitsSchema,
  starterCode: starterCodeSchema,
});

export const patchProblemRequestSchema = createProblemRequestSchema.partial();

export const adminProblemSchema = z.object({
  id: uuidSchema,
  slug: slugSchema,
  title: titleSchema,
  statementMd: z.string(),
  difficulty: difficultySchema,
  tags: tagsSchema,
  status: problemStatusSchema,
  limits: resourceLimitsSchema,
  starterCode: starterCodeSchema,
});

export const adminProblemResponseSchema = z.object({
  problem: adminProblemSchema,
});

export const adminProblemsListResponseSchema = z.object({
  problems: z.array(adminProblemSchema),
});

export const testCaseInputSchema = z.object({
  input: testCaseTextSchema,
  expectedOutput: testCaseTextSchema,
  visible: z.boolean(),
});

export const replaceTestCasesRequestSchema = z.object({
  testCases: z.array(testCaseInputSchema).min(1),
});
