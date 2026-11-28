import { useCallback, useMemo, useRef, useState } from 'react';
import { LevelSelector } from './components/LevelSelector';
import { MessageList } from './components/MessageList';
import { NatiaOrb } from './components/NatiaOrb';
import { MAX_RECORDING_SECONDS, useAudioRecorder, type RecordingResult } from './hooks/useAudioRecorder';
import { useSpeech } from './hooks/useSpeech';
import { ApiError, sendChat } from './services/api';
import type { ChatTurn, HistoryTurn, Level, OrbState } from './types/chat';

const STATE_LABEL: Record<OrbState, string> = {
  idle: 'Toca para hablar',
  listening: 'Escuchando...',
  thinking: 'NatIA está pensando...',
  speaking: 'NatIA hablando...',
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function toHistory(turns: ChatTurn[]): HistoryTurn[] {
  return turns
    .flatMap<HistoryTurn>((turn) => [
      { role: 'user', text: turn.user_transcript },
      { role: 'model', text: turn.reply_en },
    ])
    .slice(-6);
}

export function App() {
  const [level, setLevel] = useState<Level>('B1');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const turnsRef = useRef<ChatTurn[]>(turns);
  turnsRef.current = turns;
  const levelRef = useRef<Level>(level);
  levelRef.current = level;
  const abortRef = useRef<AbortController | null>(null);

  const speech = useSpeech();

  const submitRecording = useCallback(
    async (recording: RecordingResult) => {
      setIsLoading(true);
      setApiError(null);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const result = await sendChat(
          recording.blob,
          recording.mimeType,
          levelRef.current,
          toHistory(turnsRef.current),
          controller.signal,
        );
        const turn: ChatTurn = { ...result, id: crypto.randomUUID() };
        setTurns((prev) => [...prev, turn]);
        speech.speakTurn(result.reply_en, result.correction_es, result.pronunciation_tip);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setApiError(
          error instanceof ApiError
            ? error.message
            : 'Ocurrió un error inesperado. Inténtalo de nuevo.',
        );
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [speech],
  );

  const recorder = useAudioRecorder({ onAutoStop: (result) => void submitRecording(result) });

  const orbState: OrbState = recorder.isRecording
    ? 'listening'
    : isLoading
      ? 'thinking'
      : speech.isSpeaking
        ? 'speaking'
        : 'idle';

  const handleOrbClick = useCallback(async () => {
    speech.unlock();
    if (isLoading) return;

    if (speech.isSpeaking) {
      speech.stop();
      return;
    }

    if (recorder.isRecording) {
      const result = await recorder.stop();
      if (result) {
        await submitRecording(result);
      } else {
        setApiError('No se escuchó nada. Inténtalo de nuevo.');
      }
      return;
    }

    setApiError(null);
    await recorder.start();
  }, [isLoading, recorder, speech, submitRecording]);

  const clearSession = useCallback(() => {
    abortRef.current?.abort();
    speech.stop();
    recorder.cancel();
    setTurns([]);
    setApiError(null);
    recorder.clearError();
    setIsLoading(false);
  }, [recorder, speech]);

  const errorMessage = recorder.error ?? apiError;

  const orbAriaLabel = useMemo(() => {
    if (orbState === 'listening') return 'Detener grabación y enviar';
    if (orbState === 'speaking') return 'Detener audio de NatIA';
    if (orbState === 'thinking') return 'NatIA está pensando';
    return 'Empezar a grabar';
  }, [orbState]);

  return (
    <div className="relative mx-auto flex h-dvh max-w-xl flex-col overflow-hidden bg-[#090D16] text-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-indigo-600/20 blur-3xl"
      />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between gap-2 px-4 pb-2 pt-[max(env(safe-area-inset-top),1rem)]">
        <h1 className="bg-gradient-to-r from-[#6366F1] to-[#3B82F6] bg-clip-text text-xl font-bold tracking-tight text-transparent">
          NatIA
        </h1>
        <LevelSelector value={level} onChange={setLevel} disabled={recorder.isRecording || isLoading} />
        <button
          type="button"
          onClick={clearSession}
          disabled={turns.length === 0 && !errorMessage && !isLoading && !recorder.isRecording}
          aria-label="Limpiar sesión"
          title="Limpiar sesión"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#111827]/80 text-slate-400 transition hover:text-slate-100 active:scale-90 disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="m19 6-1 14H6L5 6" />
          </svg>
        </button>
      </header>

      {/* Orb */}
      <section className="relative z-10 flex shrink-0 flex-col items-center pt-2">
        <NatiaOrb
          state={orbState}
          audioLevelRef={recorder.audioLevelRef}
          speechPulseRef={speech.pulseRef}
          onClick={() => void handleOrbClick()}
          disabled={isLoading}
          ariaLabel={orbAriaLabel}
        />
        <p
          aria-live="polite"
          className={`-mt-4 text-sm font-medium transition-colors ${
            orbState === 'listening' ? 'text-cyan-300' : 'text-slate-300'
          }`}
        >
          {STATE_LABEL[orbState]}
          {orbState === 'listening' && (
            <span className="ml-2 tabular-nums text-cyan-400/80">
              {formatTime(recorder.elapsed)} / {formatTime(MAX_RECORDING_SECONDS)}
            </span>
          )}
        </p>
        {errorMessage && (
          <div
            role="alert"
            className="natia-fade-in mx-4 mt-3 flex items-start gap-2 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-3 py-2 text-xs text-amber-100"
          >
            <span aria-hidden="true">⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}
      </section>

      {/* Conversation */}
      <main className="relative z-10 mt-4 min-h-0 flex-1 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        {turns.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#111827]/80 px-4 py-5 text-center text-sm text-slate-400 backdrop-blur">
            <p className="font-medium text-slate-200">¡Hola! Soy NatIA, tu tutora de inglés.</p>
            <p className="mt-1">
              Toca el orbe, habla en inglés y vuelve a tocar para enviar. Te responderé en voz alta y te
              daré correcciones en español.
            </p>
          </div>
        ) : (
          <MessageList
            turns={turns}
            onReplay={speech.speak}
            onReplayFeedback={speech.speakFeedback}
            canSpeak={speech.isSupported}
          />
        )}
      </main>
    </div>
  );
}

export default App;
