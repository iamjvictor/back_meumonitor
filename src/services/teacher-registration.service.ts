import type { RegisterTeacherProfileInput } from '../models/teacher-registration.model.js';
import { TeacherRepository } from '../repositories/teacher.repository.js';

export class TeacherRegistrationService {
  constructor(private readonly repository: TeacherRepository) {}

  async execute(user: { id: string; email?: string; fullName?: string; whatsapp?: string }, input: RegisterTeacherProfileInput) {
    console.log('Perfil do professor iniciado', { event: 'teacher_profile.service_started', userId: user.id, username: input.username, pageSlug: input.pageSlug });
    const result = await this.repository.createProfile(user, input);
    console.log('Perfil do professor concluido', { event: 'teacher_profile.service_finished', userId: user.id, teacherId: result.id });
    return result;
  }
}
