import { useEffect, useRef, type MutableRefObject } from 'react';
import type { OrbState } from '../types/chat';

interface NatiaOrbProps {
  state: OrbState;
  /** Live microphone level, 0..1 (read every frame). */
  audioLevelRef: MutableRefObject<number>;
  /** Word-boundary pulse while speaking, 0..1 (read every frame). */
  speechPulseRef: MutableRefObject<number>;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
}

const SIZE = 300;
const RING_COUNT = 5;
const POINTS = 120;

const PALETTE: Record<OrbState, [string, string]> = {
  idle: ['#6366F1', '#3B82F6'],
  listening: ['#06B6D4', '#14B8A6'],
  thinking: ['#6366F1', '#3B82F6'],
  speaking: ['#6366F1', '#06B6D4'],
};

export function NatiaOrb({
  state,
  audioLevelRef,
  speechPulseRef,
  onClick,
  disabled = false,
  ariaLabel,
}: NatiaOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<OrbState>(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.scale(dpr, dpr);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const center = SIZE / 2;
    let raf = 0;
    let smoothedEnergy = 0;
    let colorMix = 0; // 0 = idle palette, 1 = listening palette
    const start = performance.now();

    const draw = (now: number) => {
      const t = ((now - start) / 1000) * (reduceMotion ? 0.3 : 1);
      const current = stateRef.current;

      // Target energy (0..1) per state.
      let targetEnergy = 0;
      let breathe = 0;
      if (current === 'listening') {
        targetEnergy = 0.15 + audioLevelRef.current * 0.85;
      } else if (current === 'thinking') {
        targetEnergy = 0.35 + 0.25 * Math.sin(t * 9);
      } else if (current === 'speaking') {
        speechPulseRef.current *= 0.93;
        targetEnergy = 0.3 + 0.2 * Math.sin(t * 5) + speechPulseRef.current * 0.5;
      } else {
        breathe = Math.sin(t * 1.1);
        targetEnergy = 0.08;
      }
      smoothedEnergy += (targetEnergy - smoothedEnergy) * 0.12;
      colorMix += ((current === 'listening' ? 1 : 0) - colorMix) * 0.1;

      const [a1, b1] = PALETTE.idle;
      const [a2, b2] = PALETTE[current];
      const useTarget = current === 'listening' ? colorMix > 0.5 : true;
      const c1 = useTarget ? a2 : a1;
      const c2 = useTarget ? b2 : b1;

      ctx.clearRect(0, 0, SIZE, SIZE);

      const baseRadius = 62 + breathe * 3 + smoothedEnergy * 10;

      // Ambient glow.
      const glow = ctx.createRadialGradient(center, center, baseRadius * 0.5, center, center, SIZE / 2);
      glow.addColorStop(0, `${c1}55`);
      glow.addColorStop(1, `${c1}00`);
      ctx.globalAlpha = 0.5 + smoothedEnergy * 0.5;
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, SIZE, SIZE);

      // Concentric wave rings.
      const stroke = ctx.createLinearGradient(0, 0, SIZE, SIZE);
      stroke.addColorStop(0, c1);
      stroke.addColorStop(1, c2);

      for (let i = RING_COUNT - 1; i >= 0; i -= 1) {
        const ring = i + 1;
        const spread = current === 'thinking' ? 14 + 6 * Math.sin(t * 9 - i) : 17;
        const radius = baseRadius + ring * spread * (0.6 + smoothedEnergy * 0.6);
        const lobes = current === 'speaking' ? 3 + (i % 3) : 4 + (i % 2);
        const amp =
          current === 'idle' && !reduceMotion
            ? 0.6 + breathe * 0.6
            : (2 + ring * 1.6) * (0.4 + smoothedEnergy * 2.2);
        const speed = current === 'speaking' ? 2.2 : current === 'thinking' ? 3.5 : 1.2;
        const direction = i % 2 === 0 ? 1 : -1;

        ctx.beginPath();
        for (let p = 0; p <= POINTS; p += 1) {
          const theta = (p / POINTS) * Math.PI * 2;
          const wobble =
            Math.sin(theta * lobes + t * speed * direction + i) * amp +
            Math.sin(theta * (lobes + 2) - t * speed * 0.7 + i * 2) * amp * 0.5;
          const r = radius + wobble;
          const x = center + Math.cos(theta) * r;
          const y = center + Math.sin(theta) * r;
          if (p === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.globalAlpha = Math.max(0.08, (0.55 - ring * 0.085) * (0.7 + smoothedEnergy * 0.6));
        ctx.lineWidth = 2.2 - ring * 0.2;
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }

      // Core sphere.
      const core = ctx.createRadialGradient(
        center - baseRadius * 0.3,
        center - baseRadius * 0.35,
        baseRadius * 0.1,
        center,
        center,
        baseRadius,
      );
      core.addColorStop(0, '#ffffffcc');
      core.addColorStop(0.25, c2);
      core.addColorStop(1, c1);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(center, center, baseRadius, 0, Math.PI * 2);
      ctx.fillStyle = core;
      ctx.shadowColor = c1;
      ctx.shadowBlur = 24 + smoothedEnergy * 30;
      ctx.fill();
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [audioLevelRef, speechPulseRef]);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="relative flex items-center justify-center rounded-full outline-none transition-transform duration-200 focus-visible:ring-2 focus-visible:ring-indigo-400/60 active:scale-95 disabled:cursor-wait"
      style={{ width: SIZE, height: SIZE, maxWidth: '86vw', maxHeight: '86vw', touchAction: 'manipulation' }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </button>
  );
}
