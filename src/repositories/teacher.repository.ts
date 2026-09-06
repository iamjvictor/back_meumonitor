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
        bannerUrl: input.bannerUrl ?? null,
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
        bannerUrl: data.bannerUrl,
        instagram: data.instagram,
        tiktok: data.tiktok,
        youtube: data.youtube,
        termsAcceptedAt: data.termsAcceptedAt,
      },
    });
  }

  async updateProfile(user: { id: string; email?: string; fullName?: string; whatsapp?: string }, input: any) {
    console.log('TeacherRepository.updateProfile iniciado', {
      userId: user.id,
      receivedFields: Object.keys(input || {}),
    });

    const dataToUpdate: Record<string, any> = {};
    if (input.fullName !== undefined) dataToUpdate.fullName = input.fullName;
    if (input.email !== undefined) dataToUpdate.email = input.email;
    if (input.phone !== undefined) dataToUpdate.phone = input.phone;
    if (input.username !== undefined) dataToUpdate.username = input.username;
    if (input.area !== undefined) dataToUpdate.area = input.area;
    if (input.customArea !== undefined) dataToUpdate.customArea = input.customArea;
    if (input.bio !== undefined) dataToUpdate.bio = input.bio;
    if (input.pageSlug !== undefined) dataToUpdate.pageSlug = input.pageSlug;
    if (input.avatarUrl !== undefined) dataToUpdate.avatarUrl = input.avatarUrl;
    if (input.bannerUrl !== undefined) dataToUpdate.bannerUrl = input.bannerUrl;
    if (input.instagram !== undefined) dataToUpdate.instagram = input.instagram;
    if (input.tiktok !== undefined) dataToUpdate.tiktok = input.tiktok;
    if (input.youtube !== undefined) dataToUpdate.youtube = input.youtube;

    const existing = await prisma.teacher.findUnique({ where: { userId: user.id } });
    if (existing) {
      console.log('Professor existente encontrado. Atualizando no Prisma...', {
        teacherId: existing.id,
        fieldsToUpdate: Object.keys(dataToUpdate),
      });

      const updated = await prisma.teacher.update({
        where: { userId: user.id },
        data: dataToUpdate,
      });

      console.log('Registro do professor atualizado com sucesso no Prisma', { teacherId: updated.id });
      return updated;
    }

    console.log('Professor nao encontrado para userId. Criando novo perfil...', { userId: user.id });

    const created = await this.createProfile(user, {
      username: input.username || 'professor',
      area: input.area || 'Outros',
      customArea: input.customArea,
      bio: input.bio,
      pageSlug: input.pageSlug || input.username || 'professor',
      avatarUrl: input.avatarUrl,
      bannerUrl: input.bannerUrl,
      instagram: input.instagram,
      tiktok: input.tiktok,
      youtube: input.youtube,
      agreedTerms: true,
    });

    console.log('Novo perfil de professor criado no Prisma', { teacherId: created.id });
    return created;
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
        bannerUrl: true,
        instagram: true,
        tiktok: true,
        youtube: true,
        status: true,
        monitors: {
          where: {
            status: 'PUBLISHED',
          },
          select: {
            id: true,
            name: true,
            description: true,
            avatarUrl: true,
            detailedDescription: true,
            subjects: {
              orderBy: { position: 'asc' },
              select: {
                id: true,
                name: true,
                topics: {
                  orderBy: { position: 'asc' },
                  select: {
                    id: true,
                    name: true,
                  }
                }
              }
            },
            _count: {
              select: {
                questions: {
                  where: { status: 'APPROVED' }
                },
                flashcards: {
                  where: { status: 'APPROVED' }
                }
              }
            }
          },
        },
      },
    });
  }
}
