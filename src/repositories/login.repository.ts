import { supabaseAuth } from '../lib/supabase.js';
import type { LoginInput, LoginResult } from '../models/login.model.js';

export class LoginRepository {
  async login(input: LoginInput): Promise<LoginResult> {
    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email: input.email.toLowerCase(),
      password: input.password,
    });

    if (error || !data.user || !data.session) {
      throw new LoginRepositoryError(error?.message, error?.status, error?.code);
    }

    return {
      userId: data.user.id,
      email: data.user.email ?? input.email.toLowerCase(),
      role: data.user.app_metadata?.role,
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresIn: data.session.expires_in,
      },
    };
  }
}

export class LoginRepositoryError extends Error {
  constructor(
    message?: string,
    public readonly status?: number,
    public readonly providerCode?: string,
  ) {
    super(message ?? 'Login failed');
    this.name = 'LoginRepositoryError';
  }
}
