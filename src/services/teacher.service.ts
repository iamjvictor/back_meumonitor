import { TeacherRepository } from '../repositories/teacher.repository.js';
import type { PublicTeacherProfileCache } from '../cache/public-teacher-profile.cache.js';

export class TeacherService {
  constructor(private readonly repository: TeacherRepository, private readonly publicProfileCache?: PublicTeacherProfileCache) {}

  async findMyProfile(userId: string) {
    console.log('Buscando perfil do professor', {
      event: 'teacher.profile_lookup_started',
      userId,
    });

    const teacher = await this.repository.findByUserId(userId);

    console.log('Busca do perfil do professor concluida', {
      event: 'teacher.profile_lookup_completed',
      userId,
      found: Boolean(teacher),
      teacherId: teacher?.id,
    });

    return teacher;
  }

  async findMyStudents(userId: string) {
    return this.repository.findStudentsByUserId(userId);
  }

  async updateMyProfile(user: { id: string; email?: string; fullName?: string; whatsapp?: string }, input: any) {
    console.log('TeacherService.updateMyProfile iniciado', {
      event: 'teacher.profile_update_service_started',
      userId: user.id,
      inputKeys: Object.keys(input || {}),
    });

    const previous = this.publicProfileCache ? await this.repository.findByUserId(user.id) : null;
    const teacher = await this.repository.updateProfile(user, input);

    if (this.publicProfileCache) {
      await Promise.all([previous?.pageSlug, teacher.pageSlug]
        .filter((slug): slug is string => Boolean(slug))
        .filter((slug, index, slugs) => slugs.indexOf(slug) === index)
        .map((slug) => this.invalidatePublicProfile(slug)));
    }

    console.log('TeacherService.updateMyProfile concluido', {
      event: 'teacher.profile_update_service_completed',
      userId: user.id,
      teacherId: teacher.id,
    });

    return teacher;
  }

  async findPublicProfile(pageSlug: string) {
    const startedAt = Date.now();
    console.log('Buscando pagina publica do professor', {
      event: 'teacher.public_profile_lookup_started',
      pageSlug,
    });

    if (this.publicProfileCache) {
      const cacheReadStartedAt = Date.now();
      try {
        const cached = await this.publicProfileCache.get(pageSlug);
        const cacheReadMs = Date.now() - cacheReadStartedAt;
        if (cached) {
          console.log('Cache Redis do perfil público encontrado', {
            event: 'teacher.public_profile_cache_hit',
            pageSlug,
            cacheReadMs,
            totalDurationMs: Date.now() - startedAt,
          });
          return cached;
        }
        console.log('Cache Redis do perfil público ausente', {
          event: 'teacher.public_profile_cache_miss',
          pageSlug,
          cacheReadMs,
        });
      } catch (error) {
        console.warn('Falha ao ler cache Redis do perfil público', {
          event: 'teacher.public_profile_cache_read_failed',
          pageSlug,
          cacheReadMs: Date.now() - cacheReadStartedAt,
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const databaseReadStartedAt = Date.now();
    const teacher = await this.repository.findPublicBySlug(pageSlug);
    const databaseReadMs = Date.now() - databaseReadStartedAt;

    if (teacher && this.publicProfileCache) {
      const cacheWriteStartedAt = Date.now();
      try {
        await this.publicProfileCache.set(pageSlug, teacher);
        console.log('Perfil público salvo no cache Redis', {
          event: 'teacher.public_profile_cache_written',
          pageSlug,
          cacheWriteMs: Date.now() - cacheWriteStartedAt,
        });
      } catch (error) {
        console.warn('Falha ao salvar perfil público no cache Redis', {
          event: 'teacher.public_profile_cache_write_failed',
          pageSlug,
          cacheWriteMs: Date.now() - cacheWriteStartedAt,
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    console.log('Busca da pagina publica concluida', {
      event: 'teacher.public_profile_lookup_completed',
      pageSlug,
      found: Boolean(teacher),
      source: 'database',
      databaseReadMs,
      totalDurationMs: Date.now() - startedAt,
    });

    return teacher;
  }

  private async invalidatePublicProfile(pageSlug: string) {
    if (!this.publicProfileCache) return;
    try {
      await this.publicProfileCache.invalidate(pageSlug);
      console.log('Cache Redis do perfil público invalidado', { event: 'teacher.public_profile_cache_invalidated', pageSlug });
    } catch (error) {
      console.warn('Falha ao invalidar cache Redis do perfil público', {
        event: 'teacher.public_profile_cache_invalidation_failed',
        pageSlug,
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
