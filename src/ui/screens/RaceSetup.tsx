import { useEffect, useMemo, useState } from 'react';
import { getGame } from '../../core/games/registry';
import { useApp } from '../store';
import { GameOptions } from '../components/GameOptions';
import { DriverCell } from '../components/Livery';
import { getStore, type ModelMeta } from '../../storage';
import { isTouchDevice } from '../device';
import { useChampionship } from '../useChampionship';
import { ARENA_PREFIX } from '../opponents';
import { lapTime } from '../format';

/**
 * Setting up a race against models.
 *
 * Two pools, deliberately: your own garage, and the cars actually racing in the
 * championship. Lining up against the current points leader is the most direct
 * answer the game can give to "is my model any good".
 */
export function RaceSetup() {
  const { gameId, race, patchRace, go, competitor: team } = useApp();
  const game = getGame(gameId);
  const champ = useChampionship();
  const [models, setModels] = useState<ModelMeta[] | null>(null);
  const [pool, setPool] = useState<'mine' | 'arena'>('mine');

  useEffect(() => {
    void (async () => {
      const store = await getStore();
      const list = await store.list(gameId);
      setModels(list.filter((m) => m.obsVersion === game.spec.obsVersion));
    })();
  }, [gameId, game.spec.obsVersion]);

  const arenaEntries = useMemo(() => {
    if (!champ.state) return [];
    return champ.state.entries.filter((e) => !e.retired && e.gameId === 'racing' && e.obsVersion === game.spec.obsVersion);
  }, [champ.state, gameId, game.spec.obsVersion]);

  /** Best qualifying lap each entry has set this season — a rough form guide. */
  const formGuide = useMemo(() => {
    const out = new Map<string, number>();
    if (!champ.state) return out;
    for (const card of champ.state.cards) {
      for (const q of card.qualifying) {
        if (q.bestLapMs === null) continue;
        const prev = out.get(q.entryId);
        if (prev === undefined || q.bestLapMs < prev) out.set(q.entryId, q.bestLapMs);
      }
    }
    return out;
  }, [champ.state]);

  const maxOpponents = game.maxOpponents;

  const toggle = (id: string) => {
    const has = race.opponents.includes(id);
    if (has) {
      patchRace({ opponents: race.opponents.filter((x) => x !== id) });
    } else if (maxOpponents === 1) {
      // Exactly one seat: picking a new model replaces the current one.
      patchRace({ opponents: [id] });
    } else if (race.opponents.length < maxOpponents) {
      patchRace({ opponents: [...race.opponents, id] });
    }
  };

  // Options that only make sense while training are hidden here.
  const configOptions = game.options.filter((o) => !o.trainingOnly);

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">מחוץ לאליפות</div>
        <h1 className="display">אתה מול המודלים</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 640 }}>
          {game.seatHint} — {isTouchDevice ? game.touchHint : game.controlsHint}. תוצאות כאן אינן משפיעות
          על טבלת האליפות; זה מגרש אימונים.
        </p>
      </div>

      <div className="split-setup">
        <div className="card notched">
          <div className="eyebrow" style={{ marginBottom: 12 }}>הגדרות {game.matchNoun}</div>
          <GameOptions options={configOptions} value={race.config} onChange={(config) => patchRace({ config })} />
          <div className="small muted">
            {maxOpponents === 1
              ? 'משחק אחד מול אחד: אתה מול מודל אחד.'
              : 'מספר המשתתפים נקבע לפי מספר היריבים שבחרת: ' + (race.opponents.length + 1) + '.'}
          </div>
        </div>

        <div className="card notched">
          <div className="head">
            <div className="eyebrow">יריבים</div>
            <div className="fill" />
            <span className="muted small mono">
              {race.opponents.length} / {maxOpponents}
            </span>
          </div>

          <div className="segmented" style={{ marginBottom: 12, width: '100%' }}>
              <button style={{ flex: 1 }} className={pool === 'mine' ? 'on' : ''} onClick={() => setPool('mine')}>
                המודלים שלי
              </button>
            <button style={{ flex: 1 }} className={pool === 'arena' ? 'on' : ''} onClick={() => setPool('arena')}>
              רשת האליפות
            </button>
          </div>

          {pool === 'mine' && (
            <>
              {models === null && <div className="muted small">טוען מודלים…</div>}
              {models !== null && models.length === 0 && (
                <div className="empty">
                  <p style={{ margin: '0 0 12px' }}>אין מודלים מאומנים למשחק הזה.</p>
                  <button className="primary" onClick={() => go('trainSetup')}>
                    אמן מודל
                  </button>
                </div>
              )}
              {models?.map((m) => (
                <OpponentRow
                  key={m.id}
                  id={m.id}
                  on={race.opponents.includes(m.id)}
                  driver={m.name}
                  team={m.owner || team || 'ללא שם'}
                  note={`${m.training.episodes.toLocaleString('he-IL')} אפיזודות · שיא ${m.training.bestScore.toFixed(2)} ${game.spec.scoreLabel}`}
                  right={m.training.bestLapMs ? lapTime(m.training.bestLapMs) : ''}
                  onToggle={toggle}
                />
              ))}
            </>
          )}

          {pool === 'arena' && (
            <>
              {arenaEntries.length === 0 && (
                <div className="muted small">אף מודל לא רשום לאליפות עדיין.</div>
              )}
              {arenaEntries.map((e) => (
                <OpponentRow
                  key={e.id}
                  id={ARENA_PREFIX + e.id}
                  on={race.opponents.includes(ARENA_PREFIX + e.id)}
                  driver={e.driver}
                  team={e.team}
                  tag={e.tag}
                  note={`${e.episodes.toLocaleString('he-IL')} אפיזודות`}
                  right={formGuide.has(e.id) ? lapTime(formGuide.get(e.id)!) : ''}
                  onToggle={toggle}
                />
              ))}
            </>
          )}
        </div>
      </div>

      <div className="row wrap" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
        <button className="ghost" onClick={() => go('library')}>
          למוסך
        </button>
        <button className="primary" onClick={() => go('race')} disabled={race.opponents.length === 0}>
          לזינוק
        </button>
      </div>
    </>
  );
}

function OpponentRow({
  id,
  on,
  driver,
  team,
  tag,
  note,
  right,
  onToggle,
}: {
  id: string;
  on: boolean;
  driver: string;
  team: string;
  tag?: string;
  note: string;
  right: string;
  onToggle(id: string): void;
}) {
  return (
    <label
      className="row"
      style={{
        padding: '8px 10px',
        borderRadius: 3,
        cursor: 'pointer',
        background: on ? 'rgba(255, 46, 77, 0.08)' : 'transparent',
        border: '1px solid ' + (on ? 'var(--accent-dim)' : 'transparent'),
        marginBottom: 4,
      }}
    >
      <input
        type="checkbox"
        checked={on}
        onChange={() => onToggle(id)}
        style={{ width: 'auto', accentColor: 'var(--accent)' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <DriverCell driver={driver} team={team} tag={tag} note={note} />
      </div>
      {right && <span className="mono small muted">{right}</span>}
    </label>
  );
}
