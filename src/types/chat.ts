export type Level = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';

export const LEVELS: readonly Level[] = ['A1', 'A2', 'B1', 'B2', 'C1'];

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

/** Mirrors the `TutorResponse` Pydantic model in api/index.py. */
export interface TutorResponse {
  user_transcript: string;
  reply_en: string;
  has_error: boolean;
  correction_es: string | null;
  pronunciation_tip: string | null;
}

/** Mirrors the `HistoryTurn` Pydantic model in api/index.py. */
export interface HistoryTurn {
  role: 'user' | 'model';
  text: string;
}

/** One full exchange rendered in the conversation panel. */
export interface ChatTurn extends TutorResponse {
  id: string;
}
