export interface StudentProfileUser {
  id: string;
  email?: string;
  fullName?: string;
}

export interface StudentProfileInput {
  fullName?: string;
  phone?: string;
  cpf?: string;
  avatarUrl?: string;
}

export interface StudentProfileUpsertInput {
  userId: string;
  email: string;
  fullName: string;
  phone?: string;
  cpf?: string;
  avatarUrl?: string;
}

export interface StudentProfileRecord {
  userId: string;
  email: string;
  fullName: string;
  phone: string | null;
  cpf: string | null;
  avatarUrl: string | null;
  role: string;
}

export interface StudentProfileRepository {
  upsertStudent(input: StudentProfileUpsertInput): Promise<StudentProfileRecord>;
}

export interface UpdateStudentProfileInput {
  user: StudentProfileUser;
  profile: StudentProfileInput;
}

export interface StudentProfileResult {
  userId: string;
  email: string;
  fullName: string;
  whatsapp: string | null;
  cpf: string | null;
  avatarUrl: string | null;
  role: string;
}

export function createStudentProfileService(repository: StudentProfileRepository) {
  return {
    async updateProfile(input: UpdateStudentProfileInput): Promise<StudentProfileResult> {
      const updated = await repository.upsertStudent({
        userId: input.user.id,
        email: input.user.email || '',
        fullName: input.profile.fullName?.trim() || input.user.fullName || 'Estudante',
        phone: input.profile.phone?.trim(),
        cpf: input.profile.cpf?.trim(),
        avatarUrl: input.profile.avatarUrl?.trim(),
      });

      return {
        userId: updated.userId,
        email: updated.email,
        fullName: updated.fullName,
        whatsapp: updated.phone || null,
        cpf: updated.cpf || null,
        avatarUrl: updated.avatarUrl || null,
        role: updated.role,
      };
    },
  };
}
