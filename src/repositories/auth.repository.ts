import { supabaseAdmin, supabaseAuth } from '../lib/supabase.js';
import type { SignupInput, SignupResult } from '../models/auth.model.js';

export class AuthRepository {
  async signup(input: SignupInput): Promise<SignupResult> {
    const { data: createdData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: input.email.toLowerCase(),
      password: input.password,
      email_confirm: true,
      user_metadata: {
        full_name: input.name,
        cpf: input.cpf,
        document_type: input.docType,
        whatsapp: input.whatsapp,
      },
    });

    if (createError || !createdData.user) throw new AuthRepositoryError(createError?.message);

    const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(createdData.user.id, {
      app_metadata: { role: input.role },
    });

    if (metadataError) {
      await supabaseAdmin.auth.admin.deleteUser(createdData.user.id);
      throw new AuthRepositoryError(metadataError.message);
    }

    const { data: sessionData, error: sessionError } = await supabaseAuth.auth.signInWithPassword({
      email: input.email.toLowerCase(),
      password: input.password,
    });

    if (sessionError || !sessionData.session) {
      await supabaseAdmin.auth.admin.deleteUser(createdData.user.id);
      throw new AuthRepositoryError(sessionError?.message ?? 'Sessao nao criada apos signup');
    }

    return {
      userId: createdData.user.id,
      email: createdData.user.email ?? input.email.toLowerCase(),
      role: input.role,
      emailConfirmationRequired: false,
      session: {
        accessToken: sessionData.session.access_token,
        refreshToken: sessionData.session.refresh_token,
        expiresIn: sessionData.session.expires_in,
      },
    };
  }
}

export class AuthRepositoryError extends Error {
  constructor(message?: string) {
    super(message ?? 'Auth operation failed');
    this.name = 'AuthRepositoryError';
  }
}
