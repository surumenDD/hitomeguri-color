import { type CSSProperties, useRef } from 'react';
import type { Preset } from '../script';

const labels = {
  original: '夕方',
  afterglow: '残照',
  blueHour: '青の時間',
  midnight: '深夜',
  lateNight: '夜明け前',
  twilight: '薄明',
  sunrise: '日の出',
  morning: '朝',
};
export const timeName = (seconds: number, preset: Preset): string => {
  const at = seconds / preset.durationSec;
  return labels[(preset.sequence.findLast((s) => s.at <= at) ?? preset.sequence[0]).key];
};
export function Timeline({
  seconds,
  preset,
  upper,
  lower,
  disabled,
  onSeek,
}: {
  seconds: number;
  preset: Preset;
  upper: string;
  lower: string;
  disabled: boolean;
  onSeek: (s: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seek = (x: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (box) onSeek(Math.max(0, Math.min(1, (x - box.left) / box.width)) * preset.durationSec);
  };
  return (
    <div
      ref={ref}
      className="strip"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label="1周の中の時刻"
      aria-valuemin={0}
      aria-valuemax={preset.durationSec}
      aria-valuenow={Number(seconds.toFixed(2))}
      aria-valuetext={`${timeName(seconds, preset)}、${seconds.toFixed(1)} 秒`}
      onPointerDown={(event) => {
        if (disabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        seek(event.clientX);
      }}
      onPointerMove={(event) => {
        if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId))
          seek(event.clientX);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        const step = event.shiftKey ? 1 : 0.1;
        let next = seconds;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= step;
        else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += step;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = preset.durationSec;
        else return;
        event.preventDefault();
        onSeek(next);
      }}
    >
      <div className="band upper" style={{ background: upper }} />
      <div className="band lower" style={{ background: lower }} />
      <div
        className="head"
        style={{ '--playhead': `${(seconds / preset.durationSec) * 100}%` } as CSSProperties}
      />
    </div>
  );
}
