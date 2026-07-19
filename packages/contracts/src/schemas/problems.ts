import { z } from 'zod';
import { languageSchema } from '../primitives.js';
import {
  difficultySchema,
  resourceLimitsSchema,
  slugSchema,
  tagsSchema,
  testCaseTextSchema,
  titleSchema,
  uuidSchema,
} from './shared.js';

export const problemSummarySchema = z.object({
  id: uuidSchema,
  slug: slugSchema,
  title: titleSchema,
  difficulty: difficultySchema,
  tags: tagsSchema,
  solved: z.boolean().optional(),
});

export type ProblemSummary = z.infer<typeof problemSummarySchema>;

export const problemsListQuerySchema = z.object({
  difficulty: difficultySchema.optional(),
  tag: z.string().max(32).optional(),
});

export const problemsListResponseSchema = z.object({
  problems: z.array(problemSummarySchema),
});

export const visibleTestCaseSchema = z.object({
  input: testCaseTextSchema,
  expectedOutput: testCaseTextSchema,
});

export const starterCodeSchema = z.record(languageSchema, z.string());

export const problemDetailSchema = z.object({
  id: uuidSchema,
  slug: slugSchema,
  title: titleSchema,
  statementMd: z.string().min(1),
  difficulty: difficultySchema,
  tags: tagsSchema,
  limits: resourceLimitsSchema,
  starterCode: starterCodeSchema,
  visibleTestCases: z.array(visibleTestCaseSchema),
  solved: z.boolean().optional(),
});

export type ProblemDetail = z.infer<typeof problemDetailSchema>;
export type VisibleTestCase = z.infer<typeof visibleTestCaseSchema>;

export const problemDetailResponseSchema = z.object({
  problem: problemDetailSchema,
});
