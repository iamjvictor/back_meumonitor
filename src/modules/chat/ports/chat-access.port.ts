export type ChatScope = {
  studentId: string;
  teacherId: string;
  monitorId: string;
  subjectId: string;
};

export type ChatAccessInput = {
  userId: string;
  monitorId: string;
  subjectId: string;
};

export interface ChatAccessPort {
  resolveChatScope(input: ChatAccessInput): Promise<ChatScope | null>;
}
