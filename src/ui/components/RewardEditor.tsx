import { useState } from 'react';
import type { EnvSpec, RewardChannelDef, RewardConfig } from '../../core/games/types';
import { dismissKeyboard } from '../device';
import {
  REWARD_LEVELS,
  channelDefault,
  levelOf,
  levelValue,
  matchingPreset,
  presetRewards,
} from '../../core/games/types';

interface Props {
  spec: EnvSpec;
  value: RewardConfig;
  onChange: (next: RewardConfig) => void;
  /** Shown while training is live, where edits take effect immediately. */
  live?: boolean;
}

/**
 * The reward table - the knob that actually decides what the model becomes, and
 * the only thing left to configure.
 *
 * Each channel is one slider with ten notches and a word at each end. The raw
 * weights stay out of sight: choosing between "זהיר" and "פזיז" is a decision
 * anybody can make, while choosing between -1 and -0.6 is not.
 *
 * Ten sliders are still a lot for somebody who only wants to try, so a game
 * that defines presets gets three style buttons on top, and the sliders fold
 * away under "מתקדם". They open by themselves for a table that is not one of
 * the presets - whoever tuned it by hand should not have to hunt for it.
 */
export function RewardEditor({ spec, value, onChange, live }: Props) {
  const setLevel = (c: RewardChannelDef, level: number) =>
    onChange({ ...value, [c.key]: levelValue(c, level) });
  const reset = () => {
    const next: RewardConfig = {};
    for (const c of spec.rewardChannels) next[c.key] = channelDefault(c);
    onChange(next);
  };
  const changed = spec.rewardChannels.some((c) => value[c.key] !== channelDefault(c));
  const presets = spec.presets ?? [];
  const current = matchingPreset(spec, value);
  const [advanced, setAdvanced] = useState(() => presets.length === 0 || current === null);

  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}>
        <div className="eyebrow">אופי הנהיגה</div>
        <div className="spacer" style={{ flex: 1 }} />
        {live && <span className="pill good">משפיע מיד</span>}
        <button className="ghost small" onClick={reset} disabled={!changed}>
          איפוס
        </button>
      </div>
      {presets.length > 0 && (
        <>
          <div className="segmented" style={{ width: '100%', marginBottom: 6 }}>
            {presets.map((p) => (
              <button
                key={p.id}
                style={{ flex: 1 }}
                className={current?.id === p.id ? 'on' : ''}
                title={p.hint}
                onClick={() => onChange(presetRewards(spec, p))}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="muted small" style={{ margin: '0 0 8px' }}>
            {current ? current.hint : 'סגנון משלכם - כוונון ידני במחוונים.'}
          </p>
          <button className="ghost small" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
            {advanced ? '▾' : '▸'} מתקדם · כוונון ידני בעשרה מחוונים (סליידרים)
          </button>
        </>
      )}
      {advanced && (
        <p className="muted small" style={{ margin: '8px 0' }}>
          כל מחוון שואל כמה זה חשוב לכם: ימינה זה תמיד "יותר מזה". אין כאן תשובה נכונה אחת.
        </p>
      )}
      {advanced && spec.rewardChannels.map((c) => {
        const level = levelOf(c, value[c.key] ?? channelDefault(c));
        const isDefault = level === c.defaultLevel;
        return (
          <div className="reward-row" key={c.key}>
            <div className="name">{c.label}</div>
            <div className={`level ${isDefault ? 'muted' : ''}`}>{level}</div>
            <div className="hint">{c.hint}</div>
            <input
              type="range"
              min={1}
              max={REWARD_LEVELS}
              step={1}
              value={level}
              aria-label={`${c.label}: ${level} מתוך ${REWARD_LEVELS}`}
              // How far the track is filled with the accent, up to the thumb.
              style={{ ['--fill' as string]: `${((level - 1) / (REWARD_LEVELS - 1)) * 100}%` }}
              // A slider drag leaves a focused number field focused, and the
              // phone then drags the view back to it on every touch.
              onPointerDown={dismissKeyboard}
              onChange={(e) => setLevel(c, Number(e.target.value))}
            />
            {/* Forced LTR to match the slider itself, so notch 1 sits under the
                left end of the track and notch 10 under the right one. */}
            <div className="ends">
              <span>1 · {c.lowLabel}</span>
              <span>{c.highLabel} · {REWARD_LEVELS}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
