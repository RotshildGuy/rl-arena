import { useState } from 'react';
import { useApp } from '../store';
import { changeTeamName } from '../teamName';

/**
 * The one place a team name is chosen or changed.
 *
 * Saved on a button rather than on every keystroke, because saving is a claim:
 * the name is checked against every other team, and taking it releases the
 * old one. A claim per letter typed would reserve "R", then "Ro", then "Rot".
 */
export function TeamNameForm({
  autoFocus,
  onSaved,
  onCancel,
  label = 'שם המתחרה — זה יהיה שם הקבוצה שלכם בטבלה',
  onTyping,
  wrap,
}: {
  autoFocus?: boolean;
  onSaved?: (name: string) => void;
  onCancel?: () => void;
  label?: string;
  onTyping?: () => void;
  /** Lets a caller put something around the field, such as a coach bubble. */
  wrap?: (field: React.ReactNode) => React.ReactNode;
}) {
  const competitor = useApp((s) => s.competitor);
  const setCompetitor = useApp((s) => s.setCompetitor);
  const [name, setName] = useState(competitor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await changeTeamName(name);
      setCompetitor(saved);
      onSaved?.(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שמירת השם נכשלה');
    } finally {
      setBusy(false);
    }
  };

  const field = (
    <div className="field" style={{ marginBottom: 0, flex: '1 1 220px' }}>
      <label>{label}</label>
      <input
        type="text"
        value={name}
        autoFocus={autoFocus}
        placeholder="לדוגמה: גיא"
        onChange={(e) => {
          onTyping?.();
          setError(null);
          setName(e.target.value);
        }}
        onKeyDown={(e) => e.key === 'Enter' && void save()}
      />
    </div>
  );

  return (
    <>
      <div className="row wrap" style={{ alignItems: 'flex-end' }}>
        {wrap ? wrap(field) : field}
        <button className="primary" disabled={!name.trim() || busy} onClick={() => void save()}>
          {busy ? 'שומר…' : 'שמור'}
        </button>
        {onCancel && (
          <button className="ghost" onClick={onCancel} disabled={busy}>
            ביטול
          </button>
        )}
      </div>
      {error && (
        <div className="small" style={{ marginTop: 8, color: 'var(--warn)' }}>
          {error}
        </div>
      )}
    </>
  );
}
