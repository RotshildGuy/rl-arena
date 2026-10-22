import type { GameOption } from '../../core/games/registry';
import { useT } from '../../i18n';

interface Props {
  options: GameOption[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Options that cannot change once a run is under way. */
  disabledKeys?: string[];
  /**
   * Per-option floors that come from elsewhere on the screen - the grid cannot
   * be smaller than the number of models training on it.
   */
  minima?: Record<string, number>;
  /** Options decided elsewhere, not offered at all. */
  hiddenKeys?: string[];
}

export function GameOptions({ options, value, onChange, disabledKeys = [], minima = {}, hiddenKeys = [] }: Props) {
  const t = useT();
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });

  return (
    <>
      {options.filter((o) => !hiddenKeys.includes(o.key)).map((o) => {
        const disabled = disabledKeys.includes(o.key);
        return (
          <div className="field" key={o.key}>
            <label>{o.label}</label>
            {o.kind === 'select' && (
              <select value={String(value[o.key] ?? '')} disabled={disabled} onChange={(e) => set(o.key, e.target.value)}>
                {o.choices?.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
            {o.kind === 'number' && (
              <input
                type="number"
                min={Math.max(o.min ?? -Infinity, minima[o.key] ?? -Infinity)}
                max={o.max}
                disabled={disabled}
                value={Number(value[o.key] ?? 0)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  const floor = Math.max(o.min ?? -Infinity, minima[o.key] ?? -Infinity);
                  set(o.key, Math.max(floor, Math.min(o.max ?? Infinity, n)));
                }}
              />
            )}
            {o.kind === 'toggle' && (
              <label className="row small" style={{ cursor: disabled ? 'default' : 'pointer' }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto', accentColor: 'var(--accent)' }}
                  disabled={disabled}
                  checked={Boolean(value[o.key])}
                  onChange={(e) => set(o.key, e.target.checked)}
                />
                {Boolean(value[o.key]) ? t.misc.on : t.misc.off}
              </label>
            )}
            {o.hint && <div className="small muted">{o.hint}</div>}
          </div>
        );
      })}
    </>
  );
}
