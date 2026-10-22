import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageSkeleton } from '../components/PageSkeleton';
import { getGame } from '../../core/games/registry';
import { useApp } from '../store';
import { LineChart } from '../components/LineChart';
import { DriverCell } from '../components/Livery';
import { getStore, newModelId, type ModelMeta } from '../../storage';
import { ALGORITHMS } from '../../core/rl/algorithms';
import { useChampionship } from '../useChampionship';
import {
  enterChampionship,
  renameEntry,
  removeEntry,
  entryDrift,
  EntryError,
  MAX_ENTRIES_PER_TEAM,
} from '../enterChampionship';
import { teamColor } from '../../core/champ/livery';
import { REWARD_LEVELS, channelDefault, levelOf } from '../../core/games/types';
import type { ArenaEntry } from '../../core/champ/types';
import {
  lockAtForRound,
  currentRound,
  startsAtForRound,
  trackForRound,
} from '../../core/champ/schedule';
import { eligibleEntries } from '../../core/champ/card';
import { RACE_LAPS } from '../../core/champ/format';
import { Modal } from '../components/Modal';
import { durationText, lapTime, raceTime, whenText } from '../format';
import { TRACK_DEFS } from '../../core/games/racing/tracks';
import { TeamNameForm } from '../components/TeamNameForm';
import { TrainingPrimer, hasSeenPrimer, markPrimerSeen } from '../components/TrainingPrimer';
import { exportModel, importModel, ModelFileError } from '../modelFile';
import { CoachAnchor, modelsChanged, useCoachStep } from '../coach';
import { locale, useT } from '../../i18n';
import { grandPrixTitle, trackName } from '../../i18n/names';
import { Name } from '../components/Name';

export function Garage() {
  const t = useT();
  const g = t.garage;
  const { gameId, go, newDraft, draftFromModel, patchRace, showToast, competitor: team } = useApp();
  const game = getGame(gameId);
  const champ = useChampionship();
  const [models, setModels] = useState<ModelMeta[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [entering, setEntering] = useState<string | null>(null);
  // The model waiting for a place on a full grid - the swap dialog is open for it.
  const [swapFor, setSwapFor] = useState<ModelMeta | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Shown once per device on the first visit here, and reopenable from the header.
  const [primer, setPrimer] = useState(() => !hasSeenPrimer());
  const [naming, setNaming] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  const coach = useCoachStep();

  /**
   * Every change to the library - a save, an import, a delete, a duplicate -
   * comes back through here, which makes it the one place that has to tell the
   * first-run guide that the answer to "do you have a model yet" has moved.
   */
  const refresh = useCallback(async () => {
    const store = await getStore();
    setModels(await store.list(gameId));
    modelsChanged();
  }, [gameId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Opening a car brings its panel to the middle of the screen. Without this the
  // settings can open below the fold and it looks as if nothing happened.
  useEffect(() => {
    if (!selected) return;
    const id = setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    return () => clearTimeout(id);
  }, [selected]);

  /**
   * Entries I own, keyed by the model they were uploaded from.
   *
   * This can still hold an entry left retired under the old withdrawal rules;
   * keeping it here is what lets a re-registration reuse its id and its points.
   * Everything the screen *shows* goes through `carOf` instead: a retired entry
   * is not a car on the grid, and reads as an unregistered model.
   */
  const myEntries = useMemo(() => {
    const st = champ.state;
    if (!st) return new Map<string, ArenaEntry>();
    return new Map(st.entries.filter((e) => e.uid === st.uid).map((e) => [e.modelId, e]));
  }, [champ.state]);

  /** The car this model has on the grid, or null if it is not registered. */
  const carOf = useCallback(
    (modelId: string): ArenaEntry | null => {
      const e = myEntries.get(modelId);
      return e && !e.retired ? e : null;
    },
    [myEntries],
  );

  /** Cars of mine already on the grid - the limit is per team, not per model. */
  const myCars = useMemo(() => [...myEntries.values()].filter((e) => !e.retired), [myEntries]);
  const gridFull = myCars.length >= MAX_ENTRIES_PER_TEAM;

  const startNew = () => {
    newDraft();
    go('trainSetup');
  };

  const continueTraining = (m: ModelMeta, restart: boolean) => {
    draftFromModel(m, restart);
    go('trainSetup');
  };

  const duplicate = async (m: ModelMeta) => {
    const store = await getStore();
    const rec = await store.load(m.id);
    if (!rec) return;
    await store.save({ ...rec, id: newModelId(), name: m.name + g.copySuffix, createdAt: Date.now(), updatedAt: Date.now() });
    showToast(g.duplicated);
    void refresh();
  };

  const commitRename = async (m: ModelMeta) => {
    const name = renameText.trim();
    setRenaming(null);
    if (!name || name === m.name) return;

    // A registered model's name is public, so the rename has to satisfy the
    // public rules - otherwise the garage and the grid would drift apart again.
    const entry = myEntries.get(m.id);
    try {
      if (entry) await renameEntry(entry, name);
    } catch (e) {
      showToast(e instanceof EntryError ? e.message : g.renameFailed);
      return;
    }

    const store = await getStore();
    const rec = await store.load(m.id);
    if (!rec) return;
    await store.save({ ...rec, name, updatedAt: Date.now() });
    showToast(entry ? g.renamedBoth : g.renamed);
    if (entry) champ.reload();
    void refresh();
  };

  const remove = async (m: ModelMeta) => {
    // Deleting the model takes its car off the grid too. Leaving the entry would
    // strand a car nothing can reach: the garage row it was managed from is gone.
    const entry = myEntries.get(m.id);
    if (entry) await removeEntry(entry);

    const store = await getStore();
    await store.remove(m.id);
    setConfirmDelete(null);
    setSelected(null);
    showToast(entry ? g.deletedBoth : g.deleted);
    if (entry) champ.reload();
    void refresh();
  };

  const race = (m: ModelMeta) => {
    patchRace({ config: { ...m.config, laps: 3 }, opponents: [m.id] });
    go('raceSetup');
  };

  const enter = async (m: ModelMeta) => {
    setEntering(m.id);
    try {
      const wasEntered = carOf(m.id) !== null;
      await enterChampionship(m);
      // Say when it races: "registered" alone left people asking which race, and when.
      const round = Date.now() >= lockAtForRound(currentRound() + 1) ? currentRound() + 2 : currentRound() + 1;
      const when = g.when(round, whenText(startsAtForRound(round)));
      showToast(wasEntered ? g.updated(when) : g.entered(m.name, when));
      champ.reload();
    } catch (e) {
      showToast(e instanceof EntryError ? e.message : g.entryFailed);
    } finally {
      setEntering(null);
    }
  };

  const unregister = async (modelId: string) => {
    const entry = carOf(modelId);
    if (!entry) return;
    await removeEntry(entry);
    showToast(g.removed(entry.driver));
    champ.reload();
  };

  /**
   * Put a model on a full grid by taking one of my own cars off it.
   *
   * The limit used to be a dead end: the button was simply disabled and the
   * only way through was to find the right model and remove it yourself. Here
   * the choice of who steps aside is the whole dialog, and the swap is one act.
   */
  const swap = async (out: ArenaEntry, m: ModelMeta) => {
    setSwapFor(null);
    setEntering(m.id);
    try {
      await removeEntry(out);
      await enterChampionship(m);
      showToast(g.swapped(out.driver, m.name));
    } catch (e) {
      // The old car is already off the grid by now, so a bare "it failed" would
      // leave the team one down and none the wiser. The slot is free: say what
      // happened and the second half can simply be tried again.
      const why = e instanceof EntryError ? e.message : g.entryFailed;
      showToast(g.swapHalf(out.driver, m.name, why));
    } finally {
      setEntering(null);
      champ.reload();
    }
  };

  const save = async (m: ModelMeta) => {
    try {
      showToast(g.exported(await exportModel(m.id)));
    } catch (e) {
      showToast(e instanceof ModelFileError ? e.message : g.exportFailed);
    }
  };

  const load = async (file: File | undefined) => {
    if (!file) return;
    try {
      const rec = await importModel(file);
      showToast(g.imported(rec.name));
      void refresh();
    } catch (e) {
      showToast(e instanceof ModelFileError ? e.message : g.importFailed);
    }
  };

  const nextRound = currentRound() + 1;
  const locked = Date.now() >= lockAtForRound(nextRound);
  // The circuit the next Grand Prix runs on. Every car's headline time is its
  // time *there*: a record set on the oval says nothing about a mountain race,
  // and this is the one number that predicts how the next round will go.
  const gpTrackId = trackForRound(nextRound);
  // Exactly the field the next round will be built from, so a car that is over
  // the team limit is told here rather than discovering it on race day.
  const onGrid = new Set(champ.state ? eligibleEntries(champ.state.entries, nextRound).map((e) => e.id) : []);
  // One bubble, on the first car that has not been registered - the same note
  // repeated down a list of models is noise.
  const firstUnregistered = models?.find((m) => !carOf(m.id))?.id ?? null;

  return (
    <>
      <div className="toolbar">
        <div className="title">
          <div className="eyebrow">{g.eyebrow}</div>
          <h1 className="display">{g.title}</h1>
          <div className="muted small">{g.intro}</div>
        </div>
        <div className="actions">
          {/* Distinct from the footer's "how it works", which opens the rules of
              the championship. This one is about training specifically. */}
          <button className="ghost" onClick={() => setPrimer(true)} title={g.primerTitle}>
            {g.primer}
          </button>
          <button onClick={() => fileInput.current?.click()}>{g.importFile}</button>
          <CoachAnchor
            step={coach === 'create' ? coach : null}
            text={g.coachCreate}
          >
            <button className="primary" onClick={startNew}>
              {g.trainNew}
            </button>
          </CoachAnchor>
        </div>
      </div>

      {swapFor && (
        <SwapDialog
          model={swapFor}
          cars={myCars}
          models={models ?? []}
          gpTrackId={gpTrackId}
          onPick={(out) => void swap(out, swapFor)}
          onClose={() => setSwapFor(null)}
        />
      )}

      {primer && (
        <TrainingPrimer
          onClose={() => {
            markPrimerSeen();
            setPrimer(false);
          }}
          onStart={models !== null && models.length === 0 ? startNew : undefined}
        />
      )}

      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void load(e.target.files?.[0]);
          // Reset, or picking the same file twice does nothing the second time.
          e.target.value = '';
        }}
      />

      <div className="card" style={{ marginBottom: 14 }}>
          <div className="row wrap small">
            {team ? (
              <>
                <span className="pill">
                  <span className="livery" style={{ background: teamColor(team), width: 4, height: 12 }} />
                  {g.team(team)}
                </span>
                <span className={gridFull ? 'pill warn' : 'muted'}>
                  {g.onTrack(myCars.length, MAX_ENTRIES_PER_TEAM)}
                </span>
                <span className="muted">
                  {gridFull
                    ? g.gridFull
                    : g.racesDaily}
                </span>
              </>
            ) : (
              <>
                {/* Right here, rather than a trip to another tab and back. */}
                {naming ? (
                  <div style={{ flex: '1 1 260px' }}>
                    <TeamNameForm autoFocus label={g.teamName} onSaved={() => setNaming(false)} onCancel={() => setNaming(false)} />
                  </div>
                ) : (
                  <>
                    <span className="pill warn">{g.noTeam}</span>
                    <span className="muted">{g.needTeam}</span>
                    <button className="small" onClick={() => setNaming(true)}>
                      {g.pickName}
                    </button>
                  </>
                )}
              </>
            )}
            <div style={{ flex: 1 }} />
            <span className="dim tiny">{grandPrixTitle(gpTrackId)}</span>
            <span className="dim tiny">
              {locked
                ? g.locked(nextRound, nextRound + 1, whenText(startsAtForRound(nextRound + 1)))
                : g.open(whenText(startsAtForRound(nextRound)), whenText(lockAtForRound(nextRound)))}
            </span>
        </div>
      </div>

      {models === null && <PageSkeleton variant="list" />}

      {models !== null && models.length === 0 && (
        <div className="empty">
          <h2 style={{ marginBottom: 6 }}>{g.noModels}</h2>
          <p style={{ margin: '0 0 6px' }}>{game.blurb}</p>
          <p className="small" style={{ margin: '0 0 14px' }}>
            {g.firstRun}
          </p>
          <button className="primary" onClick={startNew}>
            {g.trainNew}
          </button>
        </div>
      )}

      {models !== null && models.length > 0 && (
        <div className="model-list">
          {models.map((m) => {
            const entry = carOf(m.id);
            const drift = entry ? entryDrift(entry, m) : 'none';
            const open = selected === m.id;
            const gp = gpRecord(m, gpTrackId);
            return (
              // The panel belongs directly under the car it describes, not at the
              // bottom of the list: on a phone the old layout put the settings of
              // the first model below the last one.
              <div className="model-slot" key={m.id} ref={open ? detailRef : undefined}>
                <div className={`model-card ${open ? 'sel' : ''}`} onClick={() => setSelected(open ? null : m.id)}>
                  <div className="row">
                    <DriverCell
                      driver={m.name}
                      team={team || t.misc.unnamed}
                      note={ALGORITHMS[m.algorithm]?.name ?? m.algorithm}
                    />
                    <div style={{ flex: 1 }} />
                    {gameId === 'racing' &&
                      (!entry ? (
                        <span className="dim tiny">{g.notEntered}</span>
                      ) : !onGrid.has(entry.id) ? (
                        <span className="pill warn small" title={g.perTeam(MAX_ENTRIES_PER_TEAM)}>
                          {g.overQuota}
                        </span>
                      ) : drift !== 'none' ? (
                        <span className="pill warn small">{t.entry.drift[drift]}</span>
                      ) : (
                        <span className="pill good small">{g.entered2}</span>
                      ))}
                  </div>

                  <div className="stats">
                    <span>
                      {ALGORITHMS[m.algorithm]?.episodesLabel ?? g.rounds}{' '}
                      <b>{m.training.episodes.toLocaleString(locale())}</b>
                    </span>
                    {/* Distance is only news until there is a full race to show. */}
                    {gp.raceMs == null && (
                      <span title={g.farthestTitle}>
                        {g.farthest} <b>{m.training.bestScore.toFixed(1)}</b> {game.spec.scoreLabel}
                      </span>
                    )}
                    {/* The circuit that matters is the one the next Grand Prix
                        runs on, not whichever the model happened to train on
                        last - so that is the time on the card, and a model that
                        has never been there is told so plainly. */}
                    <span title={g.gpRecordTitle(grandPrixTitle(gpTrackId))}>
                      {g.fastLapOn(trackName(gpTrackId))}{' '}
                      {gp.lapMs != null ? (
                        <b>{lapTime(gp.lapMs)}</b>
                      ) : (
                        <b style={{ color: 'var(--warn)' }}>{g.untrained}</b>
                      )}
                    </span>
                    {gp.raceMs != null && (
                      <span title={g.gpDistance(RACE_LAPS)}>
                        {g.fullRace} <b>{raceTime(gp.raceMs)}</b>
                      </span>
                    )}
                    <span>
                      {g.lastTraining} <b>{lastTrack(m.config) || '-'}</b>
                    </span>
                    <span>
                      {g.trainTime} <b>{durationText(m.training.trainedMs)}</b>
                    </span>
                  </div>

                  <div className="acts">
                    {gameId === 'racing' && (
                      <CoachAnchor
                        step={coach === 'enter' && m.id === firstUnregistered ? coach : null}
                        text={g.coachEnter}
                      >
                      <button
                        className={entry && drift === 'none' ? 'small' : 'small primary'}
                        disabled={entering === m.id || !team}
                        title={
                          gridFull && !entry
                            ? g.fullTitle(MAX_ENTRIES_PER_TEAM)
                            : undefined
                        }
                        onClick={(ev) => {
                          ev.stopPropagation();
                          // A full grid asks which car steps aside instead of
                          // refusing; registering is never a dead end.
                          if (gridFull && !entry) setSwapFor(m);
                          else void enter(m);
                        }}
                      >
                        {entering === m.id ? g.entering : entry ? g.update : g.enter}
                      </button>
                      </CoachAnchor>
                    )}
                    <button
                      className="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        continueTraining(m, false);
                      }}
                    >
                      {g.continue}
                    </button>
                    <button
                      className="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        race(m);
                      }}
                    >
                      {g.race}
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="card notched model-detail">
                    <div className="head">
                      {renaming === m.id ? (
                        <input
                          type="text"
                          autoFocus
                          aria-label={g.rename}
                          value={renameText}
                          onChange={(e) => setRenameText(e.target.value)}
                          onBlur={() => void commitRename(m)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void commitRename(m);
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                        />
                      ) : (
                        <h2>
                          <Name>{m.name}</Name>
                        </h2>
                      )}
                      <div className="fill" />
                      <button className="ghost small" onClick={() => setSelected(null)}>
                        {g.close}
                      </button>
                    </div>

                    {/* Continue and race are on the card itself, right above. */}
                    <div className="row wrap" style={{ marginBottom: 14 }}>
                      <button
                        onClick={() => {
                          setRenameText(m.name);
                          setRenaming(m.id);
                        }}
                      >
                        {g.rename}
                      </button>
                      <button onClick={() => duplicate(m)}>{g.duplicate}</button>
                      <button onClick={() => void save(m)} title={g.exportTitle}>
                        {g.exportFile}
                      </button>
                      {entry && <button onClick={() => void unregister(m.id)}>{g.unregister}</button>}
                      {confirmDelete === m.id ? (
                        <>
                          <button className="danger" onClick={() => void remove(m)}>
                            {entry ? g.deleteBoth : g.deleteForever}
                          </button>
                          <button className="ghost" onClick={() => setConfirmDelete(null)}>
                            {g.cancel}
                          </button>
                        </>
                      ) : (
                        <button className="danger" onClick={() => setConfirmDelete(m.id)}>
                          {g.delete}
                        </button>
                      )}
                    </div>

                    <h3 style={{ margin: '0 0 6px' }}>{g.records}</h3>
                    <RecordTable model={m} />

                    <h3 style={{ margin: '14px 0 6px' }}>{g.curve}</h3>
                    <LineChart
                      height={110}
                      series={[{ label: 'reward', color: '--accent-2', values: m.training.history.map((p) => p.reward) }]}
                    />

                    <h3 style={{ margin: '14px 0 6px' }}>{g.sliders}</h3>
                    <div className="small">
                      {game.spec.rewardChannels.map((c) => {
                        // The same 1-10 notch the slider showed, not the raw weight -
                        // otherwise the garage speaks a different language than setup.
                        const level = levelOf(c, m.rewards[c.key] ?? channelDefault(c));
                        const changed = level !== c.defaultLevel;
                        return (
                          <div className="row" key={c.key} style={{ justifyContent: 'space-between', padding: '2px 0' }}>
                            <span className={changed ? '' : 'muted'}>{c.label}</span>
                            <span className="mono" style={{ color: changed ? 'var(--accent-2)' : 'var(--muted)' }}>
                              {level} / {REWARD_LEVELS}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <h3 style={{ margin: '14px 0 6px' }}>{g.details}</h3>
                    <div className="small muted">
                      {ALGORITHMS[m.algorithm]?.name} · {ALGORITHMS[m.algorithm]?.technical}
                    </div>
                    <div className="small muted">{g.trainedOn(game.describeConfig(m.config))}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** The circuit a model last trained on, for the one-line summary on its card. */
function lastTrack(config: Record<string, unknown>): string {
  return TRACK_DEFS.some((d) => d.id === config.trackId) ? trackName(String(config.trackId)) : '';
}

/**
 * What a model has done on one circuit, across every distance it ran there.
 *
 * Lap times compare across distances - a lap is a lap - so the quickest lap of
 * any session on that circuit is the honest headline. A race time does not: six
 * laps and ten are different races, so only the Grand Prix distance counts.
 */
function gpRecord(model: ModelMeta, trackId: string): { lapMs: number | null; raceMs: number | null } {
  let lapMs: number | null = null;
  let raceMs: number | null = null;
  for (const r of Object.values(model.training.records ?? {})) {
    if (r.trackId !== trackId) continue;
    if (r.bestLapMs != null && (lapMs === null || r.bestLapMs < lapMs)) lapMs = r.bestLapMs;
    if (r.laps === RACE_LAPS && r.bestRaceMs != null && (raceMs === null || r.bestRaceMs < raceMs)) {
      raceMs = r.bestRaceMs;
    }
  }
  return { lapMs, raceMs };
}

/**
 * Who steps aside so another model can race.
 *
 * Shown instead of a disabled button when a team is already fielding its two
 * cars. It lists the cars that are out there with the one thing that decides
 * between them - how quick each is on the circuit the next Grand Prix uses -
 * and picking one is the whole swap: that car comes off, this model goes on.
 */
function SwapDialog({
  model,
  cars,
  models,
  gpTrackId,
  onPick,
  onClose,
}: {
  model: ModelMeta;
  cars: ArenaEntry[];
  models: ModelMeta[];
  gpTrackId: string;
  onPick(out: ArenaEntry): void;
  onClose(): void;
}) {
  const g = useT().garage;
  const byId = new Map(models.map((m) => [m.id, m]));
  const trackLabel = trackName(gpTrackId);
  return (
    <Modal eyebrow={g.full} title={g.whoLeaves(model.name)} onClose={onClose}>
      <p className="small muted">{g.swapBody(MAX_ENTRIES_PER_TEAM)}</p>
      {cars.map((e) => {
        const m = byId.get(e.modelId);
        const gp = m ? gpRecord(m, gpTrackId) : { lapMs: null, raceMs: null };
        return (
          <div className="row wrap" key={e.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
            <DriverCell driver={e.driver} team={e.team} tag={e.tag} />
            <div style={{ flex: 1 }} />
            <span className="small muted">
              {g.fastLapOn(trackLabel)}{' '}
              <span className="mono" style={{ color: gp.lapMs != null ? 'var(--accent-2)' : 'var(--muted)' }}>
                {gp.lapMs != null ? lapTime(gp.lapMs) : '-'}
              </span>
            </span>
            <span className="mono small muted">{g.attempts(e.episodes.toLocaleString(locale()))}</span>
            <button className="danger small" onClick={() => onPick(e)}>
              {g.takeOff(e.driver)}
            </button>
          </div>
        );
      })}
    </Modal>
  );
}

/**
 * Every setup this model has a record on.
 *
 * Kept per track and per distance on purpose: a lap around the oval and a lap
 * around the mountain circuit are not comparable, and neither is a three-lap run
 * to a ten-lap one, so one global "best" would always belong to the easiest
 * setup the model ever touched.
 */
function RecordTable({ model }: { model: ModelMeta }) {
  const g = useT().garage;
  const rows = Object.values(model.training.records ?? {}).sort((a, b) => b.at - a.at);
  if (rows.length === 0) {
    return <div className="small muted">{g.noRecord}</div>;
  }
  return (
    <div className="small">
      <div className="row dim tiny" style={{ justifyContent: 'space-between' }}>
        <span>{g.track}</span>
        <span>{g.lapAndRace}</span>
      </div>
      {rows.map((r) => (
        <div className="row" key={r.trackId + r.laps} style={{ justifyContent: 'space-between', padding: '3px 0' }}>
          <span>
            {trackName(r.trackId)}
            <span className="dim"> · {g.laps(r.laps)}</span>
          </span>
          <span className="mono">
            <span style={{ color: 'var(--accent-2)' }}>{lapTime(r.bestLapMs)}</span>
            <span className="dim"> · {raceTime(r.bestRaceMs)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
