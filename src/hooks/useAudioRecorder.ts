import { useCallback, useEffect, useRef, useState } from 'react';

export const MAX_RECORDING_SECONDS = 60;

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'] as const;

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
}

interface UseAudioRecorderOptions {
  /** Called when the 60s safety limit stops the recording automatically. */
  onAutoStop?: (result: RecordingResult) => void;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | undefined {
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

export function useAudioRecorder(options: UseAudioRecorderOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /** Live microphone level (0..1). A ref avoids re-rendering at 60fps. */
  const audioLevelRef = useRef(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const limitRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const onAutoStopRef = useRef(options.onAutoStop);

  useEffect(() => {
    onAutoStopRef.current = options.onAutoStop;
  }, [options.onAutoStop]);

  const releaseResources = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    if (limitRef.current !== null) window.clearTimeout(limitRef.current);
    rafRef.current = null;
    tickRef.current = null;
    limitRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    audioLevelRef.current = 0;
  }, []);

  const stop = useCallback((): Promise<RecordingResult | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        recorderRef.current = null;
        releaseResources();
        setIsRecording(false);
        setElapsed(0);
        resolve(blob.size > 0 ? { blob, mimeType } : null);
      };
      recorder.stop();
    });
  }, [releaseResources]);

  const start = useCallback(async (): Promise<boolean> => {
    if (recorderRef.current) return false;
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Tu navegador no permite grabar audio. Prueba con Chrome o Safari actualizados.');
      return false;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setError(
          'Permiso de micrófono denegado. Actívalo en los ajustes del navegador para poder hablar con NatIA.',
        );
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setError('No se encontró ningún micrófono en tu dispositivo.');
      } else {
        setError('No se pudo acceder al micrófono. Inténtalo de nuevo.');
      }
      return false;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    try {
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 64000,
      });
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorderRef.current = recorder;

      const Ctor = getAudioContextCtor();
      if (Ctor) {
        const ctx = new Ctor();
        void ctx.resume().catch(() => undefined);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);
        audioCtxRef.current = ctx;

        const buffer = new Uint8Array(analyser.fftSize);
        const loop = () => {
          analyser.getByteTimeDomainData(buffer);
          let sum = 0;
          for (let i = 0; i < buffer.length; i += 1) {
            const v = (buffer[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buffer.length);
          const target = Math.min(1, rms * 4);
          audioLevelRef.current += (target - audioLevelRef.current) * 0.35;
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      }

      recorder.start(250);
      startedAtRef.current = Date.now();
      setElapsed(0);
      setIsRecording(true);

      tickRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);

      limitRef.current = window.setTimeout(() => {
        void stop().then((result) => {
          if (result) onAutoStopRef.current?.(result);
        });
      }, MAX_RECORDING_SECONDS * 1000);

      return true;
    } catch {
      recorderRef.current = null;
      releaseResources();
      setError('No se pudo iniciar la grabación. Inténtalo de nuevo.');
      return false;
    }
  }, [releaseResources, stop]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    releaseResources();
    setIsRecording(false);
    setElapsed(0);
  }, [releaseResources]);

  useEffect(() => cancel, [cancel]);

  const clearError = useCallback(() => setError(null), []);

  return { isRecording, elapsed, error, audioLevelRef, start, stop, cancel, clearError };
}
