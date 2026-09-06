import { z } from 'zod';

const signupPayloadSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(6).max(72),
  name: z.string().trim().min(2).max(120).optional(),
  fullName: z.string().trim().min(2).max(120).optional(),
  cpf: z.string().trim().min(11).max(14).optional(),
  documentNumber: z.string().trim().min(11).max(18).optional(),
  whatsapp: z.string().trim().min(8).max(30).optional(),
  phone: z.string().trim().min(8).max(30).optional(),
  docType: z.enum(['CPF', 'CNPJ']).default('CPF'),
  role: z.enum(['teacher', 'student']).default('teacher'),
}).superRefine((input, context) => {
  if (!input.name && !input.fullName) {
    context.addIssue({ code: 'custom', path: ['name'], message: 'Nome e obrigatorio.' });
  }
  if (input.role === 'teacher') {
    if (!input.cpf && !input.documentNumber) {
      context.addIssue({ code: 'custom', path: ['documentNumber'], message: 'Documento e obrigatorio para professores.' });
    }
    if (!input.whatsapp && !input.phone) {
      context.addIssue({ code: 'custom', path: ['phone'], message: 'WhatsApp/telefone e obrigatorio para professores.' });
    }
  }
});

export const signupSchema = signupPayloadSchema.transform((input) => ({
  email: input.email,
  password: input.password,
  name: input.name ?? input.fullName!,
  cpf: input.cpf ?? input.documentNumber ?? '',
  whatsapp: input.whatsapp ?? input.phone ?? '',
  docType: input.docType,
  role: input.role,
}));

export type SignupInput = z.infer<typeof signupSchema>;

export interface SignupResult {
  userId: string;
  email: string;
  role: 'teacher' | 'student';
  emailConfirmationRequired: boolean;
  session?: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
}

export function getSignupRequestLogData(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { bodyType: Array.isArray(input) ? 'array' : typeof input, receivedFields: [] };
  }

  return { bodyType: 'object', receivedFields: Object.keys(input) };
}

export function getSignupLogData(input: SignupInput) {
  return {
    email: maskEmail(input.email),
    role: input.role,
    nameLength: input.name.length,
    password: {
      length: input.password.length,
      hasUppercase: /[A-Z]/.test(input.password),
      hasLowercase: /[a-z]/.test(input.password),
      hasNumber: /[0-9]/.test(input.password),
      hasSpecialCharacter: /[^A-Za-z0-9]/.test(input.password),
    },
    cpf: { received: Boolean(input.cpf), length: input.cpf.length },
    whatsapp: { received: Boolean(input.whatsapp), length: input.whatsapp.length },
    documentType: input.docType,
  };
}

function maskEmail(email: string) {
  const [localPart, domain] = email.toLowerCase().split('@');
  if (!localPart || !domain) return '[email-invalido]';
  return `${localPart.slice(0, 2)}***@${domain}`;
}
