import type { Advice } from '../../core/champ/diagnose';

/** One piece of post-race advice: what was seen, then what to change. */
export function AdviceLine({ advice }: { advice: Advice }) {
  return (
    <div className="small" style={{ paddingInlineStart: 4, margin: '3px 0' }}>
      <span className="muted">{advice.finding} · </span>
      {advice.action}
    </div>
  );
}
