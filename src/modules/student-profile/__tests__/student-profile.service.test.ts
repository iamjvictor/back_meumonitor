import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudentProfileService } from '../student-profile.service.js';

test('atualiza o perfil do aluno usando a identidade autenticada', async () => {
  const calls: unknown[] = [];
  const service = createStudentProfileService({
    async upsertStudent(input) {
      calls.push(input);
      return {
        userId: input.userId,
        email: input.email,
        fullName: input.fullName,
        phone: input.phone ?? null,
        cpf: input.cpf ?? null,
        avatarUrl: input.avatarUrl ?? null,
        role: 'student',
      };
    },
  });

  const result = await service.updateProfile({
    user: { id: 'user-1', email: 'ALUNO@EXAMPLE.COM', fullName: 'Nome da sessão' },
    profile: { fullName: '  Nome atualizado  ', phone: ' 11999999999 ', cpf: ' 123 ', avatarUrl: ' https://avatar ' },
  });

  assert.deepEqual(calls, [{
    userId: 'user-1',
    email: 'ALUNO@EXAMPLE.COM',
    fullName: 'Nome atualizado',
    phone: '11999999999',
    cpf: '123',
    avatarUrl: 'https://avatar',
  }]);
  assert.deepEqual(result, {
    userId: 'user-1',
    email: 'ALUNO@EXAMPLE.COM',
    fullName: 'Nome atualizado',
    whatsapp: '11999999999',
    cpf: '123',
    avatarUrl: 'https://avatar',
    role: 'student',
  });
});

test('usa defaults quando o perfil enviado está vazio', async () => {
  const service = createStudentProfileService({
    async upsertStudent(input) {
      return {
        userId: input.userId,
        email: input.email,
        fullName: input.fullName,
        phone: null,
        cpf: null,
        avatarUrl: null,
        role: 'student',
      };
    },
  });

  const result = await service.updateProfile({
    user: { id: 'user-2', email: '', fullName: 'Nome autenticado' },
    profile: {},
  });

  assert.equal(result.fullName, 'Nome autenticado');
  assert.equal(result.whatsapp, null);
  assert.equal(result.role, 'student');
});
