import { prisma } from '../lib/prisma.js';
import type { RegisterTeacherProfileInput } from '../models/teacher-registration.model.js';

export class TeacherRepository {
  async createProfile(user: { id: string; email?: string; fullName?: string; whatsapp?: string }, input: RegisterTeacherProfileInput) {
    const data = {
        userId: user.id,
        fullName: user.fullName ?? 'Professor',
        email: user.email ?? '',
        phone: user.whatsapp ?? null,
        username: input.username,
        area: input.area,
        customArea: input.customArea ?? null,
        bio: input.bio ?? null,
        pageSlug: input.pageSlug,
        avatarUrl: input.avatarUrl ?? null,
        instagram: input.instagram ?? null,
        tiktok: input.tiktok ?? null,
        youtube: input.youtube ?? null,
        termsAcceptedAt: new Date(),
        role: 'teacher',
        status: 'pending',
    } as const;

    return prisma.teacher.upsert({
      where: { userId: user.id },
      create: data,
      update: {
        email: data.email,
        phone: data.phone,
        username: data.username,
        area: data.area,
        customArea: data.customArea,
        bio: data.bio,
        pageSlug: data.pageSlug,
        avatarUrl: data.avatarUrl,
        instagram: data.instagram,
        tiktok: data.tiktok,
        youtube: data.youtube,
        termsAcceptedAt: data.termsAcceptedAt,
      },
    });
  }

  async findByUserId(userId: string) {
    return prisma.teacher.findUnique({ where: { userId } });
  }

  async findPublicBySlug(pageSlug: string) {
    return prisma.teacher.findUnique({
      where: { pageSlug },
      select: {
        fullName: true,
        username: true,
        area: true,
        customArea: true,
        bio: true,
        pageSlug: true,
        avatarUrl: true,
        instagram: true,
        tiktok: true,
        youtube: true,
        status: true,
      },
    });
  }
}
