import { useCallback, useEffect, useRef, useState } from 'react';

const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

const PREFERRED_NAME_HINTS = ['natural', 'google us english', 'samantha', 'google uk english', 'daniel'];

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
    const hint = PREFERRED_NAME_HINTS.findIndex((h) => name.includes(h));
    if (hint >= 0) value += 10 - hint;
    if (voice.localService) value += 1;
    return value;
  };

  return [...english].sort((a, b) => score(b) - score(a))[0];
}

export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);

  /** Decaying 0..1 pulse set on every spoken word boundary, read by the orb. */
  const pulseRef = useRef(0);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const unlockedRef = useRef(false);
  const currentRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (!isSupported) return undefined;
    const synth = window.speechSynthesis;
    const loadVoices = () => {
      voiceRef.current = pickBestEnglishVoice(synth.getVoices());
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
    currentRef.current = null;
    window.speechSynthesis.cancel();
    pulseRef.current = 0;
    setIsSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (!isSupported || !text.trim()) return;
    const synth = window.speechSynthesis;
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voiceRef.current?.lang ?? 'en-US';
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.rate = 0.95;
    utterance.pitch = 1;

    const finish = () => {
      if (currentRef.current !== utterance) return;
      currentRef.current = null;
      pulseRef.current = 0;
      setIsSpeaking(false);
    };

    utterance.onstart = () => {
      if (currentRef.current === utterance) setIsSpeaking(true);
    };
    utterance.onboundary = () => {
      pulseRef.current = 1;
    };
    utterance.onend = finish;
    utterance.onerror = finish;

    currentRef.current = utterance;
    setIsSpeaking(true);
    synth.speak(utterance);
  }, []);

  return { isSupported, isSpeaking, pulseRef, unlock, speak, stop };
}
