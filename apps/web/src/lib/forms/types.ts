export type FormQuestion = {
  id: string;
  channelId?: string;
  prompt: string;
  kind?: string;
  pos: number;
  locked?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type FormPayload = {
  questions: FormQuestion[];
  myAnswers: Record<string, string>;
  answersByUser: Record<string, Record<string, string>>;
  allSubmitted?: Record<string, boolean>;
  participants?: string[];
};

export type FormEvents = {
  state: { channelId: string; questions: FormQuestion[]; allSubmitted?: Record<string, boolean>; participants?: string[] };
  answer: { channelId: string; questionId: string; userId: string; answer?: string | null; hasAnswer?: boolean; savedAt?: string };
  questionCreate: { channelId: string; question: FormQuestion };
  questionUpdate: { channelId: string; question: FormQuestion };
  questionDelete: { channelId: string; questionId: string };
};
