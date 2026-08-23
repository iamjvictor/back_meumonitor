import { z } from 'zod';

const monitorTopicSchema = z.object({
  name: z.string().trim().min(2).max(120),
  definition: z.string().trim().max(4000).optional(),
});

const monitorSubjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  topics: z.array(monitorTopicSchema).min(1).max(30),
});

export const createMonitorSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).optional(),
  subjects: z.array(monitorSubjectSchema).min(1).max(3),
});

export const monitorIdParamsSchema = z.object({
  monitorId: z.string().uuid(),
});

export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;
