import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../core/errors/app-error.js';
import { PaymentAccountAlreadyExistsError, StartPaymentAccountUseCase } from '../application/commands/start-payment-account.use-case.js';
import type { GetPaymentAccountUseCase } from '../application/queries/get-payment-account.use-case.js';
import { AsaasApiError } from '../infrastructure/providers/asaas/asaas-http.client.js';

export const paymentAccountBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email(),
  cpfCnpj: z.string().trim().min(11).max(18),
  birthDate: z.string().date().optional(),
  companyType: z.enum(['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION']).optional(),
  mobilePhone: z.string().trim().min(10).max(20),
  incomeValue: z.number().positive(),
  address: z.string().trim().min(2).max(160),
  addressNumber: z.string().trim().min(1).max(30),
  complement: z.string().trim().max(80).optional(),
  province: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().min(8).max(12),
  site: z.string().url().optional(),
}).strict();

export class PaymentAccountController {
  constructor(private readonly getAccount: GetPaymentAccountUseCase, private readonly startAccount: StartPaymentAccountUseCase) {}

  async get(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) throw new AppError({ code: 'UNAUTHENTICATED', statusCode: 401, publicMessage: 'Sessão obrigatória.' });
    console.log('Consulta da conta de recebimento iniciada', {
      event: 'payments.account_status_requested',
      requestId: request.id,
      userId: request.user.id,
    });
    const result = await this.getAccount.execute(request.user.id);
    console.log('Consulta da conta de recebimento concluída', {
      event: 'payments.account_status_completed',
      requestId: request.id,
      userId: request.user.id,
      hasAccount: Boolean(result?.currentPaymentAccount),
      accountId: result?.currentPaymentAccount?.id,
      status: result?.currentPaymentAccount?.status,
    });
    return reply.send({ data: result?.currentPaymentAccount ?? null });
  }

  async start(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) throw new AppError({ code: 'UNAUTHENTICATED', statusCode: 401, publicMessage: 'Sessão obrigatória.' });
    const parsed = paymentAccountBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const details = parsed.error.flatten();
      console.warn('Validação da conta de recebimento falhou', {
        event: 'payments.account_start_validation_failed',
        requestId: request.id,
        userId: request.user.id,
        invalidFields: Object.keys(details.fieldErrors),
        issues: parsed.error.issues.map((issue) => ({ path: issue.path, code: issue.code, message: issue.message })),
      });
      const invalidFields = Object.keys(details.fieldErrors);
      throw new AppError({
        code: 'VALIDATION_ERROR',
        statusCode: 422,
        publicMessage: invalidFields.length > 0
          ? `Revise os campos: ${invalidFields.join(', ')}.`
          : 'Dados da conta de recebimento inválidos.',
        internalDetails: details,
      });
    }

    console.log('Solicitação de configuração de conta recebida', {
      event: 'payments.account_start_requested',
      requestId: request.id,
      userId: request.user.id,
      fieldsReceived: Object.keys(parsed.data),
      companyType: parsed.data.companyType ?? null,
      hasBirthDate: Boolean(parsed.data.birthDate),
      hasComplement: Boolean(parsed.data.complement),
      hasSite: Boolean(parsed.data.site),
    });

    try {
      const account = await this.startAccount.execute(request.user.id, parsed.data);
      console.log('Configuração de conta concluída', {
        event: 'payments.account_start_completed',
        requestId: request.id,
        userId: request.user.id,
        accountId: account.id,
        providerAccountId: account.providerAccountId,
        walletId: account.walletId,
        status: account.status,
        revision: account.revision,
      });
      return reply.code(201).send({ data: account });
    } catch (error) {
      console.warn('Configuração de conta falhou', {
        event: 'payments.account_start_failed',
        requestId: request.id,
        userId: request.user.id,
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : String(error),
        providerResponse: error && typeof error === 'object' && 'responseBody' in error ? error.responseBody : undefined,
      });
      if (error instanceof PaymentAccountAlreadyExistsError) throw new AppError({ code: 'PAYMENT_ACCOUNT_ALREADY_EXISTS', statusCode: 409, publicMessage: 'O professor já possui uma conta de recebimento configurada.' });
      if (error instanceof Error && error.message === 'TEACHER_PROFILE_NOT_FOUND') throw new AppError({ code: 'TEACHER_PROFILE_NOT_FOUND', statusCode: 404, publicMessage: 'Conclua o perfil de professor antes de configurar o recebimento.' });
      if (error instanceof AsaasApiError && error.status === 400) {
        throw new AppError({
          code: 'ASAAS_ACCOUNT_VALIDATION_ERROR',
          statusCode: 422,
          publicMessage: error.message.replace(/^Asaas request failed \(400\):\s*/, ''),
          internalDetails: error.responseBody,
        });
      }
      throw error;
    }
  }
}
