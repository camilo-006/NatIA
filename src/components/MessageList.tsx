import { useEffect, useRef } from 'react';
import type { ChatTurn } from '../types/chat';

interface MessageListProps {
  turns: ChatTurn[];
  onReplay: (text: string) => void;
  onReplayFeedback: (correctionEs?: string | null, pronunciationTip?: string | null) => void;
  canSpeak: boolean;
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

export function MessageList({ turns, onReplay, onReplayFeedback, canSpeak }: MessageListProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length]);

  return (
    <div className="flex flex-col gap-5">
      {turns.map((turn) => {
        const showFeedback = Boolean(turn.correction_es) || Boolean(turn.pronunciation_tip);
        return (
          <article key={turn.id} className="natia-fade-in flex flex-col gap-2">
            {/* What the user said */}
            <div className="flex justify-end">
              <p
                lang="en"
                className="max-w-[85%] rounded-2xl rounded-br-md border border-cyan-400/20 bg-gradient-to-br from-[#06B6D4]/20 to-[#14B8A6]/10 px-4 py-2.5 text-sm text-cyan-50"
              >
                {turn.user_transcript}
              </p>
            </div>

            {/* NatIA reply */}
            <div className="flex items-end gap-2">
              <p
                lang="en"
                className="max-w-[85%] rounded-2xl rounded-bl-md border border-white/10 bg-[#111827]/80 px-4 py-2.5 text-sm text-slate-100 backdrop-blur"
              >
                {turn.reply_en}
              </p>
              {canSpeak && (
                <button
                  type="button"
                  onClick={() => onReplay(turn.reply_en)}
                  aria-label="Repetir respuesta en audio"
                  className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-indigo-400/30 bg-indigo-500/10 text-indigo-300 transition hover:bg-indigo-500/25 active:scale-90"
                >
                  <SpeakerIcon />
                </button>
              )}
            </div>

            {/* Constructive feedback */}
            {showFeedback && (
              <div className="flex items-start justify-between gap-2 rounded-2xl border border-[#F59E0B]/25 bg-[#F59E0B]/10 px-4 py-3 text-sm text-amber-100/90">
                <div className="flex-1">
                  {turn.correction_es && (
                    <p className="flex gap-2">
                      <span aria-hidden="true">💡</span>
                      <span>{turn.correction_es}</span>
                    </p>
                  )}
                  {turn.pronunciation_tip && (
                    <p className={`flex gap-2 ${turn.correction_es ? 'mt-2 border-t border-[#F59E0B]/15 pt-2' : ''}`}>
                      <span aria-hidden="true">🗣️</span>
                      <span>{turn.pronunciation_tip}</span>
                    </p>
                  )}
                </div>
                {canSpeak && (
                  <button
                    type="button"
                    onClick={() => onReplayFeedback(turn.correction_es, turn.pronunciation_tip)}
                    aria-label="Escuchar corrección en español"
                    title="Escuchar corrección"
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber-400/30 bg-amber-500/10 text-amber-300 transition hover:bg-amber-500/25 active:scale-90"
                  >
                    <SpeakerIcon />
                  </button>
                )}
              </div>
            )}
          </article>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
