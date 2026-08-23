import type { SignupInput } from '../models/auth.model.js';
import { AuthRepository } from '../repositories/auth.repository.js';

export class AuthService {
  constructor(private readonly repository: AuthRepository) {}

  async signup(input: SignupInput) {
    console.log('Signup iniciado', { event: 'auth.signup_started', email: input.email.replace(/(^..).+(@.*$)/, '$1***$2'), role: input.role });
    const result = await this.repository.signup(input);
    console.log('Signup concluido', { event: 'auth.signup_completed', userId: result.userId, role: result.role, sessionCreated: Boolean(result.session) });
    return result;
  }
}
