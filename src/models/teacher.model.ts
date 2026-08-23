export interface TeacherProfileResponse {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
  username: string;
  area: string;
  customArea: string | null;
  bio: string | null;
  pageSlug: string;
  avatarUrl: string | null;
  instagram: string | null;
  tiktok: string | null;
  youtube: string | null;
  role: string;
  emailVerified: boolean;
  status: string;
  termsAcceptedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
