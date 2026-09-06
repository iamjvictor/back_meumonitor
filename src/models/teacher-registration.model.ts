import { z } from 'zod';

export const registerTeacherSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(72).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/),
  phone: z.string().trim().min(8).max(30).optional(),
  username: z.string().trim().min(3).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  area: z.string().trim().min(2).max(120),
  customArea: z.string().trim().max(120).optional(),
  bio: z.string().trim().max(2000).optional(),
  pageSlug: z.string().trim().min(3).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  avatarUrl: z.string().optional().nullable(),
  bannerUrl: z.string().optional().nullable(),
  instagram: z.string().trim().max(120).optional(),
  tiktok: z.string().trim().max(120).optional(),
  youtube: z.string().trim().max(120).optional(),
  agreedTerms: z.literal(true),
});

export const registerTeacherProfileSchema = z.object({
  username: z.string().trim().min(3).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  area: z.string().trim().min(2).max(120),
  customArea: z.string().trim().max(120).optional(),
  bio: z.string().trim().max(2000).optional(),
  pageSlug: z.string().trim().min(3).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  avatarUrl: z.string().optional().nullable(),
  bannerUrl: z.string().optional().nullable(),
  instagram: z.string().trim().max(120).optional(),
  tiktok: z.string().trim().max(120).optional(),
  youtube: z.string().trim().max(120).optional(),
  agreedTerms: z.boolean().optional().default(true),
});

export const updateTeacherProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().max(30).optional().nullable(),
  username: z.string().trim().min(3).max(60).optional(),
  area: z.string().trim().min(2).max(120).optional(),
  customArea: z.string().trim().max(120).optional().nullable(),
  bio: z.string().trim().max(2000).optional().nullable(),
  pageSlug: z.string().trim().min(3).max(60).optional(),
  avatarUrl: z.string().optional().nullable(),
  bannerUrl: z.string().optional().nullable(),
  instagram: z.string().trim().max(120).optional().nullable(),
  tiktok: z.string().trim().max(120).optional().nullable(),
  youtube: z.string().trim().max(120).optional().nullable(),
});

export type RegisterTeacherInput = z.infer<typeof registerTeacherSchema>;
export type RegisterTeacherProfileInput = z.infer<typeof registerTeacherProfileSchema>;
export type UpdateTeacherProfileInput = z.infer<typeof updateTeacherProfileSchema>;

export interface RegisteredTeacher {
  id: string;
  userId: string;
  status: 'pending';
  emailConfirmationRequired: boolean;
  session?: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
}

export function getRegistrationRequestLogData(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { bodyType: Array.isArray(input) ? 'array' : typeof input, receivedFields: [] };
  }

  return {
    bodyType: 'object',
    receivedFields: Object.keys(input),
  };
}

export function getRegistrationLogData(input: RegisterTeacherInput) {
  const password = input.password;

  return {
    email: maskEmail(input.email),
    username: input.username,
    pageSlug: input.pageSlug,
    area: input.area,
    fullNameLength: input.fullName.length,
    password: {
      length: password.length,
      hasUppercase: /[A-Z]/.test(password),
      hasLowercase: /[a-z]/.test(password),
      hasNumber: /[0-9]/.test(password),
      hasSpecialCharacter: /[^A-Za-z0-9]/.test(password),
    },
    optionalFields: {
      phone: Boolean(input.phone),
      customArea: Boolean(input.customArea),
      bio: Boolean(input.bio),
      avatarUrl: Boolean(input.avatarUrl),
      instagram: Boolean(input.instagram),
      tiktok: Boolean(input.tiktok),
      youtube: Boolean(input.youtube),
    },
    agreedTerms: input.agreedTerms,
  };
}

function maskEmail(email: string) {
  const [localPart, domain] = email.toLowerCase().split('@');
  if (!localPart || !domain) return '[email-invalido]';
  return `${localPart.slice(0, 2)}***@${domain}`;
}
