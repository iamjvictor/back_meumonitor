import { prisma } from '../lib/prisma.js';
import { supabaseAdmin } from '../lib/supabase.js';

const BUCKET = 'profile-images';

export class ProfileImageRepository {
  async save(userId: string, image: Buffer) {
    const path = `${userId}/avatar.webp`;
    const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(path, image, {
      contentType: 'image/webp',
      cacheControl: '3600',
      upsert: true,
    });

    if (uploadError) throw new ProfileImageRepositoryError(uploadError.message);

    const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    const avatarUrl = data.publicUrl;

    const teacher = await prisma.teacher.findUnique({ where: { userId } });
    if (teacher) {
      await prisma.teacher.update({
        where: { userId },
        data: { avatarUrl },
      });
    }

    const student = await prisma.student.findUnique({ where: { userId } });
    if (student) {
      await prisma.student.update({
        where: { userId },
        data: { avatarUrl },
      });
    }

    return { avatarUrl };
  }
}

export class ProfileImageRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileImageRepositoryError';
  }
}
