import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { StudentRepository } from '../repositories/student.repository.js';
import { TeacherRepository } from '../repositories/teacher.repository.js';

const studentRepo = new StudentRepository();
const teacherRepo = new TeacherRepository();

/** Rotas autenticadas ainda transversais; domínios de aluno vivem em módulos próprios. */
export async function protectedRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware);

  app.get('/session', async (request) => {
    if (!request.user) throw new Error('Authenticated user was not attached to request');

    let fullName = request.user.fullName;
    let whatsapp = request.user.whatsapp;
    let cpf: string | undefined;
    let avatarUrl: string | undefined;
    let role = request.user.role;

    const teacher = await teacherRepo.findByUserId(request.user.id);
    if (teacher) {
      role = 'teacher';
      if (!fullName) fullName = teacher.fullName;
      if (!whatsapp) whatsapp = teacher.phone ?? undefined;
      if (!avatarUrl) avatarUrl = teacher.avatarUrl ?? undefined;
    }

    const student = await studentRepo.findByUserId(request.user.id);
    if (student) {
      if (!fullName) fullName = student.fullName;
      if (!whatsapp) whatsapp = student.phone ?? undefined;
      cpf = student.cpf ?? undefined;
      if (!avatarUrl) avatarUrl = student.avatarUrl ?? undefined;
    }

    return {
      data: {
        userId: request.user.id,
        email: request.user.email,
        fullName: fullName || null,
        whatsapp: whatsapp || null,
        cpf: cpf || null,
        avatarUrl: avatarUrl || null,
        role: role || 'student',
      },
    };
  });
}
