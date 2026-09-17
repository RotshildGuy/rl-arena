import type { EnvSpec, RewardChannelDef, RewardConfig } from '../../core/games/types';
import { dismissKeyboard } from '../device';
import { REWARD_LEVELS, channelDefault, levelOf, levelValue } from '../../core/games/types';

interface Props {
  spec: EnvSpec;
  value: RewardConfig;
  onChange: (next: RewardConfig) => void;
  /** Shown while training is live, where edits take effect immediately. */
  live?: boolean;
}

/**
 * The reward table — the knob that actually decides what the model becomes, and
 * the only thing left to configure.
 *
 * Each channel is one slider with ten notches and a word at each end. The raw
 * weights stay out of sight: choosing between "זהיר" and "פזיז" is a decision
 * anybody can make, while choosing between -1 and -0.6 is not.
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
      <p className="muted small" style={{ margin: '0 0 8px' }}>
        עשרה מחוונים, וזהו. כל אחד מהם הוא החלטה על סוג הנהג שייצא לך — אין כאן תשובה נכונה אחת.
      </p>
      {spec.rewardChannels.map((c) => {
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
