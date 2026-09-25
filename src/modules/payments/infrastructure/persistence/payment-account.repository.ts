import { prisma } from '../../../../lib/prisma.js';
import { randomUUID } from 'node:crypto';
import type { CreatedSubaccount } from '../providers/asaas/asaas-account.provider.js';
import type { CreateSubaccountCommand } from '../providers/asaas/asaas-account.provider.js';
import { LocalPaymentAccountCredentialStore, type PaymentAccountCredentialStore } from '../credentials/payment-account-credential.store.js';

export type PaymentAccountInput = {
  name: string;
  email: string;
  cpfCnpj: string;
  birthDate?: string;
  companyType?: 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION';
  mobilePhone: string;
  incomeValue: number;
  address: string;
  addressNumber: string;
  complement?: string;
  province: string;
  postalCode: string;
  site?: string;
};

export class PaymentAccountRepository {
  constructor(private readonly credentialStore: PaymentAccountCredentialStore = new LocalPaymentAccountCredentialStore()) {}
  findCurrentByUserId(userId: string) {
    console.log('Buscando conta de recebimento atual', { event: 'payments.account_lookup_started', userId });
    return prisma.teacher.findUnique({
      where: { userId },
      select: {
        id: true,
        currentPaymentAccount: {
          select: {
            id: true,
            providerAccountId: true,
            providerWebhookId: true,
            walletId: true,
            revision: true,
            status: true,
            generalStatus: true,
            commercialInfoStatus: true,
            bankAccountStatus: true,
            documentationStatus: true,
            onboardingUrl: true,
            credentialRef: true,
            rejectionReason: true,
            verifiedAt: true,
            lastEventAt: true,
            paymentProfile: {
              select: {
                name: true,
                email: true,
                cpfCnpj: true,
                birthDate: true,
                companyType: true,
                mobilePhone: true,
                incomeValue: true,
                address: true,
                addressNumber: true,
                complement: true,
                province: true,
                postalCode: true,
                site: true,
              },
            },
          },
        },
      },
    });
  }

  async persistCreatedAccount(userId: string, input: CreateSubaccountCommand, created: CreatedSubaccount) {
    return prisma.$transaction(async (transaction) => {
      const teacher = await transaction.teacher.findUniqueOrThrow({ where: { userId }, select: { id: true } });
      const previous = await transaction.paymentAccount.findFirst({ where: { teacherId: teacher.id, environment: process.env.ASAAS_ENV?.toUpperCase() ?? 'SANDBOX' }, orderBy: { revision: 'desc' }, select: { revision: true } });
      console.log('Salvando conta de recebimento', {
        event: 'payments.persistence_write_started',
        tableName: 'payment_accounts',
        userId,
        teacherId: teacher.id,
        providerAccountId: created.providerAccountId,
        status: created.status,
      });
      const account = await transaction.paymentAccount.create({
        data: {
          teacherId: teacher.id,
          environment: process.env.ASAAS_ENV?.toUpperCase() ?? 'SANDBOX',
          providerAccountId: created.providerAccountId,
          providerWebhookId: created.webhookId,
          walletId: created.walletId,
          revision: (previous?.revision ?? 0) + 1,
          status: created.status,
          onboardingUrl: created.onboardingUrl,
          activationChannel: created.onboardingUrl ? 'ONBOARDING_URL' : 'EMAIL_ACTIVATION',
        },
      });
      if (!created.apiKey) throw new Error('ASAAS_ACCOUNT_CREDENTIAL_MISSING');
      const environment = (process.env.ASAAS_ENV?.toUpperCase() ?? 'SANDBOX') as 'SANDBOX' | 'PRODUCTION';
      const encryptedCredential = this.credentialStore.encrypt(account.id, environment, created.apiKey);
      const credentialId = randomUUID();
      await transaction.paymentAccountCredential.create({
        data: {
          id: credentialId,
          paymentAccountId: account.id,
          environment,
          ciphertext: encryptedCredential.ciphertext,
          nonce: encryptedCredential.nonce,
          authTag: encryptedCredential.authTag,
          keyVersion: encryptedCredential.keyVersion,
        },
      });
      await transaction.paymentAccount.update({
        where: { id: account.id },
        data: { credentialRef: credentialId },
      });
      console.log('Conta de recebimento salva', {
        event: 'payments.persistence_write_completed',
        tableName: 'payment_accounts',
        accountId: account.id,
        providerAccountId: account.providerAccountId,
      });
      console.log('Salvando dados cadastrais do professor', {
        event: 'payments.persistence_write_started',
        tableName: 'teacher_payment_profiles',
        userId,
        teacherId: teacher.id,
        paymentAccountId: account.id,
        fields: ['name', 'email', 'cpfCnpj', 'birthDate', 'companyType', 'mobilePhone', 'incomeValue', 'address', 'addressNumber', 'complement', 'province', 'postalCode', 'site'],
      });
      await transaction.teacherPaymentProfile.create({
        data: {
          teacherId: teacher.id,
          paymentAccountId: account.id,
          name: input.name,
          email: input.email,
          cpfCnpj: input.cpfCnpj,
          birthDate: input.birthDate ?? null,
          companyType: input.companyType ?? null,
          mobilePhone: input.mobilePhone,
          incomeValue: input.incomeValue,
          address: input.address,
          addressNumber: input.addressNumber,
          complement: input.complement ?? null,
          province: input.province,
          postalCode: input.postalCode,
          site: input.site ?? null,
        },
      });
      console.log('Dados cadastrais do professor salvos', {
        event: 'payments.persistence_write_completed',
        tableName: 'teacher_payment_profiles',
        paymentAccountId: account.id,
      });
      console.log('Vinculando conta atual ao professor', {
        event: 'payments.persistence_write_started',
        tableName: 'teachers',
        column: 'current_payment_account_id',
        teacherId: teacher.id,
        paymentAccountId: account.id,
      });
      await transaction.teacher.update({ where: { id: teacher.id }, data: { currentPaymentAccountId: account.id } });
      console.log('Conta atual vinculada ao professor', {
        event: 'payments.persistence_write_completed',
        tableName: 'teachers',
        column: 'current_payment_account_id',
        teacherId: teacher.id,
      });
      console.log('Conta de recebimento persistida e vinculada ao professor', {
        event: 'payments.account_persistence_completed',
        userId,
        teacherId: teacher.id,
        accountId: account.id,
        providerAccountId: account.providerAccountId,
        walletId: account.walletId,
        revision: account.revision,
        status: account.status,
        environment: account.environment,
        profilePersisted: true,
      });
      return account;
    });
  }

  async applyAccountStatusEvent(providerAccountId: string, eventType: string, occurredAt = new Date()) {
    const normalized = eventType.toUpperCase();
    const status = normalized.includes('SUSPEND') ? 'SUSPENDED' : normalized.includes('REJECT') ? 'REJECTED' : normalized.endsWith('APPROVED') ? 'APPROVED' : null;
    console.log('Atualizando status da conta Asaas', { event: 'payments.account_status_update_started', tableName: 'payment_accounts', providerAccountId, eventType: normalized, derivedStatus: status });
    if (!status) return null;
    const result = await prisma.paymentAccount.updateMany({
      where: { providerAccountId },
      data: {
        status,
        generalStatus: normalized.includes('GENERAL_APPROVAL') ? status : undefined,
        verifiedAt: status === 'APPROVED' ? occurredAt : undefined,
        lastEventAt: occurredAt,
      },
    });
    console.log('Status da conta Asaas atualizado', { event: 'payments.account_status_update_persisted', tableName: 'payment_accounts', providerAccountId, eventType: normalized, status, updatedRows: result.count });
    return result;
  }

}
