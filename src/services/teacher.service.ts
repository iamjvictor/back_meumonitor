import { TeacherRepository } from '../repositories/teacher.repository.js';

export class TeacherService {
  constructor(private readonly repository: TeacherRepository) {}

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

  async updateMyProfile(user: { id: string; email?: string; fullName?: string; whatsapp?: string }, input: any) {
    console.log('TeacherService.updateMyProfile iniciado', {
      event: 'teacher.profile_update_service_started',
      userId: user.id,
      inputKeys: Object.keys(input || {}),
    });

    const teacher = await this.repository.updateProfile(user, input);

    console.log('TeacherService.updateMyProfile concluido', {
      event: 'teacher.profile_update_service_completed',
      userId: user.id,
      teacherId: teacher.id,
    });

    return teacher;
  }

  async findPublicProfile(pageSlug: string) {
    console.log('Buscando pagina publica do professor', {
      event: 'teacher.public_profile_lookup_started',
      pageSlug,
    });

    const teacher = await this.repository.findPublicBySlug(pageSlug);

    console.log('Busca da pagina publica concluida', {
      event: 'teacher.public_profile_lookup_completed',
      pageSlug,
      found: Boolean(teacher),
    });

    return teacher;
  }
}
