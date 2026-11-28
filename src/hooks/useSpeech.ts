import { useCallback, useEffect, useRef, useState } from 'react';

const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

const PREFERRED_EN_HINTS = ['natural', 'google us english', 'samantha', 'google uk english', 'daniel'];
const PREFERRED_ES_HINTS = [
  'natural',
  'sabina',
  'paulina',
  'monica',
  'jorge',
  'google español',
  'helena',
  'laura',
];

interface SpeechSegment {
  text: string;
  lang: 'en' | 'es';
}

function pickBestEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  if (english.length === 0) return null;

  const score = (voice: SpeechSynthesisVoice): number => {
    const lang = voice.lang.replace('_', '-').toLowerCase();
    const name = voice.name.toLowerCase();
    let value = 0;
    if (lang === 'en-us') value += 30;
    else if (lang === 'en-gb') value += 20;
    else value += 5;
    const hint = PREFERRED_EN_HINTS.findIndex((h) => name.includes(h));
    if (hint >= 0) value += 12 - hint;
    if (voice.localService) value += 1;
    return value;
  };

  return [...english].sort((a, b) => score(b) - score(a))[0];
}

function pickBestSpanishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const spanish = voices.filter((v) => v.lang.toLowerCase().startsWith('es'));
  if (spanish.length === 0) return null;

  const score = (voice: SpeechSynthesisVoice): number => {
    const lang = voice.lang.replace('_', '-').toLowerCase();
    const name = voice.name.toLowerCase();
    let value = 0;
    if (lang === 'es-mx' || lang === 'es-co' || lang === 'es-us' || lang === 'es-419') value += 30;
    else if (lang === 'es-es') value += 22;
    else value += 10;
    const hint = PREFERRED_ES_HINTS.findIndex((h) => name.includes(h));
    if (hint >= 0) value += 12 - hint;
    if (voice.localService) value += 1;
    return value;
  };

  return [...spanish].sort((a, b) => score(b) - score(a))[0];
}

/**
 * Splits a Spanish correction containing quoted English words/phrases into alternating
 * Spanish and English speech segments so each language is pronounced natively.
 */
export function splitBilingualFeedback(text: string): SpeechSegment[] {
  const cleaned = text.trim();
  if (!cleaned) return [];

  const segments: SpeechSegment[] = [];
  // Matches double quotes ("...") or single quotes ('...') enclosing at least 1 letter
  const quoteRegex = /["“”'‘’]([A-Za-z0-9][^"“”'‘’]{0,120})["“”'‘’]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = quoteRegex.exec(cleaned)) !== null) {
    const before = cleaned.slice(lastIndex, match.index).trim();
    if (before) {
      segments.push({ text: before, lang: 'es' });
    }
    const englishPhrase = match[1].trim();
    if (englishPhrase) {
      segments.push({ text: englishPhrase, lang: 'en' });
    }
    lastIndex = match.index + match[0].length;
  }

  const remaining = cleaned.slice(lastIndex).trim();
  if (remaining) {
    // Discard standalone punctuation left right after a quote (e.g., "." or ",")
    if (/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/.test(remaining)) {
      segments.push({ text: remaining, lang: 'es' });
    }
  }

  return segments.length > 0 ? segments : [{ text: cleaned, lang: 'es' }];
}

export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);

  /** Decaying 0..1 pulse set on every spoken word boundary, read by the orb. */
  const pulseRef = useRef(0);
  const enVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const esVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const unlockedRef = useRef(false);
  const sessionIdRef = useRef(0);

  useEffect(() => {
    if (!isSupported) return undefined;
    const synth = window.speechSynthesis;
    const loadVoices = () => {
      const voices = synth.getVoices();
      enVoiceRef.current = pickBestEnglishVoice(voices);
      esVoiceRef.current = pickBestSpanishVoice(voices);
    };
    loadVoices();
    synth.addEventListener('voiceschanged', loadVoices);
    return () => {
      synth.removeEventListener('voiceschanged', loadVoices);
      synth.cancel();
    };
  }, []);

  /** Silent warm-up so iOS Safari allows later programmatic speech. Call from a user gesture. */
  const unlock = useCallback(() => {
    if (!isSupported || unlockedRef.current) return;
    unlockedRef.current = true;
    const warmUp = new SpeechSynthesisUtterance(' ');
    warmUp.volume = 0;
    warmUp.lang = 'en-US';
    window.speechSynthesis.speak(warmUp);
  }, []);

  const stop = useCallback(() => {
    if (!isSupported) return;
    sessionIdRef.current += 1;
    window.speechSynthesis.cancel();
    pulseRef.current = 0;
    setIsSpeaking(false);
  }, []);

  const playSegments = useCallback((segments: SpeechSegment[]) => {
    if (!isSupported) return;
    const valid = segments.filter((s) => s.text.trim().length > 0);
    if (valid.length === 0) return;

    const synth = window.speechSynthesis;
    synth.cancel();
    sessionIdRef.current += 1;
    const activeSession = sessionIdRef.current;

    setIsSpeaking(true);

    valid.forEach((seg, idx) => {
      const utterance = new SpeechSynthesisUtterance(seg.text);
      if (seg.lang === 'en') {
        utterance.lang = enVoiceRef.current?.lang ?? 'en-US';
        if (enVoiceRef.current) utterance.voice = enVoiceRef.current;
        utterance.rate = 0.95;
      } else {
        utterance.lang = esVoiceRef.current?.lang ?? 'es-MX';
        if (esVoiceRef.current) utterance.voice = esVoiceRef.current;
        utterance.rate = 1.02;
      }
      utterance.pitch = 1;

      utterance.onstart = () => {
        if (sessionIdRef.current === activeSession) {
          setIsSpeaking(true);
        }
      };
      utterance.onboundary = () => {
        if (sessionIdRef.current === activeSession) {
          pulseRef.current = 1;
        }
      };

      const isLast = idx === valid.length - 1;
      const handleEnd = () => {
        if (sessionIdRef.current !== activeSession) return;
        if (isLast) {
          pulseRef.current = 0;
          setIsSpeaking(false);
        }
      };

      utterance.onend = handleEnd;
      utterance.onerror = handleEnd;

      synth.speak(utterance);
    });
  }, []);

  /** Speak an English-only sentence. */
  const speak = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      playSegments([{ text, lang: 'en' }]);
    },
    [playSegments],
  );

  /** Speak a Spanish correction/tip while pronouncing quoted English words natively. */
  const speakFeedback = useCallback(
    (correctionEs?: string | null, pronunciationTip?: string | null) => {
      const combined = [correctionEs?.trim(), pronunciationTip?.trim()].filter(Boolean).join('. ');
      if (!combined) return;
      playSegments(splitBilingualFeedback(combined));
    },
    [playSegments],
  );

  /**
   * Speak the full tutor turn: first the natural English reply, and if there is
   * a correction or pronunciation tip in Spanish, speak it right after with bilingual voices.
   */
  const speakTurn = useCallback(
    (replyEn: string, correctionEs?: string | null, pronunciationTip?: string | null) => {
      const segments: SpeechSegment[] = [];
      if (replyEn.trim()) {
        segments.push({ text: replyEn.trim(), lang: 'en' });
      }
      const feedbackText = [correctionEs?.trim(), pronunciationTip?.trim()]
        .filter(Boolean)
        .join('. ');
      if (feedbackText) {
        segments.push(...splitBilingualFeedback(feedbackText));
      }
      playSegments(segments);
    },
    [playSegments],
  );

  return { isSupported, isSpeaking, pulseRef, unlock, speak, speakFeedback, speakTurn, stop };
}
