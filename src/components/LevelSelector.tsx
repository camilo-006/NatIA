import { LEVELS, type Level } from '../types/chat';

interface LevelSelectorProps {
  value: Level;
  onChange: (level: Level) => void;
  disabled?: boolean;
}

export function LevelSelector({ value, onChange, disabled = false }: LevelSelectorProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Nivel de inglés"
      className="flex items-center gap-0.5 rounded-full border border-white/10 bg-[#111827]/80 p-0.5 backdrop-blur"
    >
      {LEVELS.map((level) => {
        const active = level === value;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(level)}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-all disabled:opacity-50 ${
              active
                ? 'bg-gradient-to-r from-[#6366F1] to-[#3B82F6] text-white shadow shadow-indigo-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {level}
          </button>
        );
      })}
    </div>
  );
}
