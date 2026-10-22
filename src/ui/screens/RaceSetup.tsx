import { useEffect, useMemo, useState } from 'react';
import { LineSkeleton } from '../components/PageSkeleton';
import { getGame } from '../../core/games/registry';
import { useApp } from '../store';
import { GameOptions } from '../components/GameOptions';
import { DriverCell } from '../components/Livery';
import { getStore, type ModelMeta } from '../../storage';
import { isTouchDevice } from '../device';
import { useChampionship } from '../useChampionship';
import { ARENA_PREFIX } from '../opponents';
import { HOUSE_DRIVERS } from '../../core/champ/house';
import { lapTime } from '../format';
import { driverName, teamName } from '../../i18n/names';
import { locale, useT } from '../../i18n';

/**
 * Setting up a race against models.
 *
 * Two pools: your own garage, and championship cars - your own entries and the
 * house team. Other teams' cars are not on the list: their weights stay with
 * their owners, and only the server races them.
 */
export function RaceSetup() {
  const t = useT();
  const r = t.raceSetup;
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
    const uid = champ.state.uid;
    const mine = champ.state.entries.filter(
      (e) => e.uid === uid && !e.retired && e.gameId === 'racing' && e.obsVersion === game.spec.obsVersion,
    );
    return [...mine, ...HOUSE_DRIVERS.filter((h) => h.obsVersion === game.spec.obsVersion)];
  }, [champ.state, gameId, game.spec.obsVersion]);

  /** Best qualifying lap each entry has set this season - a rough form guide. */
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
        <div className="eyebrow">{r.eyebrow}</div>
        <h1 className="display">{r.title}</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 640 }}>
          {game.seatHint} - {isTouchDevice ? game.touchHint : game.controlsHint}. {r.offRecord}
        </p>
      </div>

      <div className="split-setup">
        <div className="card notched">
          <div className="eyebrow" style={{ marginBottom: 12 }}>{r.settings(game.matchNoun)}</div>
          <GameOptions options={configOptions} value={race.config} onChange={(config) => patchRace({ config })} />
          <div className="small muted">
            {maxOpponents === 1
              ? r.oneOnOne
              : race.opponents.length === 0
                ? r.pick
                : r.onTrack(race.opponents.length)}
          </div>
        </div>

        <div className="card notched">
          <div className="head">
            <div className="eyebrow">{r.rivals}</div>
            <div className="fill" />
            <span className="muted small">
              {r.chosen} <span className="mono">{race.opponents.length}</span> {r.of(maxOpponents)}
            </span>
          </div>

          <div className="segmented" style={{ marginBottom: 12, width: '100%' }}>
              <button style={{ flex: 1 }} className={pool === 'mine' ? 'on' : ''} onClick={() => setPool('mine')}>
                {r.mine}
              </button>
            <button style={{ flex: 1 }} className={pool === 'arena' ? 'on' : ''} onClick={() => setPool('arena')}>
              {r.arena}
            </button>
          </div>

          {pool === 'mine' && (
            <>
              {models === null && <LineSkeleton />}
              {models !== null && models.length === 0 && (
                <div className="empty">
                  <p style={{ margin: '0 0 12px' }}>{r.noModels}</p>
                  <button className="primary" onClick={() => go('trainSetup')}>
                    {r.train}
                  </button>
                </div>
              )}
              {models?.map((m) => (
                <OpponentRow
                  key={m.id}
                  id={m.id}
                  on={race.opponents.includes(m.id)}
                  driver={m.name}
                  team={m.owner || team || t.misc.unnamed}
                  note={r.episodes(m.training.episodes.toLocaleString(locale()))}
                  right={m.training.bestLapMs ? r.fastLap(lapTime(m.training.bestLapMs)) : ''}
                  onToggle={toggle}
                />
              ))}
            </>
          )}

          {pool === 'arena' && (
            <>
              {arenaEntries.length === 0 && (
                <div className="muted small">{r.noEntries}</div>
              )}
              {arenaEntries.map((e) => (
                <OpponentRow
                  key={e.id}
                  id={ARENA_PREFIX + e.id}
                  on={race.opponents.includes(ARENA_PREFIX + e.id)}
                  driver={driverName(e)}
                  team={teamName(e.team)}
                  tag={e.tag}
                  note={r.episodes(e.episodes.toLocaleString(locale()))}
                  right={formGuide.has(e.id) ? r.fastLap(lapTime(formGuide.get(e.id)!)) : ''}
                  onToggle={toggle}
                />
              ))}
              <div className="small muted" style={{ marginTop: 8 }}>
                {r.arenaNote}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="row wrap" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
        {race.opponents.length === 0 && (
          <span className="small muted" role="status" style={{ marginInlineEnd: 'auto' }}>
            {r.pickOne}
          </span>
        )}
        <button className="ghost" onClick={() => go('library')}>
          {r.toGarage}
        </button>
        <button className="primary" onClick={() => go('race')} disabled={race.opponents.length === 0}>
          {r.go}
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
        aria-label={`${driver} · ${team}`}
        style={{ width: 22, height: 22, flex: '0 0 auto', margin: 0, accentColor: 'var(--accent)' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <DriverCell driver={driver} team={team} tag={tag} note={note} />
      </div>
      {right && <span className="mono small muted">{right}</span>}
    </label>
  );
}
