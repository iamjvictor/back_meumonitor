import type { LoginInput } from '../models/login.model.js';
import { LoginRepository } from '../repositories/login.repository.js';

export class LoginService {
  constructor(private readonly repository: LoginRepository) {}

  async execute(input: LoginInput) {
    console.log('Login iniciado', {
      event: 'auth.login_started',
      email: `${input.email.slice(0, 2)}***@${input.email.split('@')[1] ?? 'invalido'}`,
    });

    const result = await this.repository.login(input);

    console.log('Login concluido', {
      event: 'auth.login_completed',
      userId: result.userId,
      role: result.role,
    });

    return result;
  }
}
