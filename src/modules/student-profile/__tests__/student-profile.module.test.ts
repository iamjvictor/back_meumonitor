import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudentProfileModule } from '../student-profile.module.js';

test('composition root expõe o serviço de perfil', () => {
  const module = createStudentProfileModule({
    repository: {
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
    },
  });

  assert.equal(typeof module.service.updateProfile, 'function');
});
