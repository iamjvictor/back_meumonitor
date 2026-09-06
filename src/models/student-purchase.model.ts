import { z } from 'zod';

export const createPurchaseSchema = z.object({
  monitorIds: z.array(z.string().uuid()).min(1).max(20),
  paymentMethod: z.enum(['PIX', 'CREDIT_CARD', 'BOLETO', 'OTHER']),
}).strict();

export const purchaseIdSchema = z.object({ purchaseId: z.string().uuid() });
export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
