import { useEffect, useRef, useState } from 'react';
import { getGame } from '../../core/games/registry';
import {
  chooseTimeLimit,
  MAX_TRAIN_SLOTS,
  nextGrandPrixTrack,
  TIME_LIMITS,
  TRAINING_GRID,
  TRAINING_HIDDEN_OPTIONS,
  TRAINING_LAPS,
  useApp,
  withTrainingDefaults,
  type TrainSlot,
} from '../store';
import { GameOptions } from '../components/GameOptions';
import { RewardEditor } from '../components/RewardEditor';
import { ALGORITHMS, type AlgorithmId } from '../../core/rl/algorithms';
import { estimateTraining, formatEstimate, type TimeEstimate } from '../estimate';
import { isMobileClass } from '../device';
import { getStore, type ModelMeta } from '../../storage';
import { randomModelName } from '../../core/champ/nameGen';
import { CoachAnchor, useCoachStep } from '../coach';
import { TeamNameForm } from '../components/TeamNameForm';
import { locale, useT } from '../../i18n';
import { trackName } from '../../i18n/names';

export function TrainSetup() {
  const s = useT().trainSetup;
  const { gameId, draft, patchDraft, patchSlot, addSlot, removeSlot, slotFromModel, newDraft, go, competitor } =
    useApp();
  const [editingName, setEditingName] = useState(false);
  const game = getGame(gameId);
  const coach = useCoachStep();
  const [saved, setSaved] = useState<ModelMeta[]>([]);
  const [tab, setTab] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => setSaved(await (await getStore()).list(gameId)))();
  }, [gameId]);

  /**
   * One suggested name per slot, drawn once and then kept. Redrawing on every
   * render would change the name under the cursor while someone is reading it,
   * and `start` would commit something other than what the field showed. The
   * names already drawn are passed along so no two cars on the grid share one.
   */
  const suggestions = useRef<string[]>([]);
  const suggestFor = (i: number): string => {
    if (!suggestions.current[i]) {
      suggestions.current[i] = randomModelName(Math.random, suggestions.current.filter(Boolean));
    }
    return suggestions.current[i];
  };

  const slots = draft.slots;
  const multi = slots.length > 1;
  const continuing = slots.some((s) => s.modelId !== null && !s.restart);
  const slotIndex = Math.min(tab, slots.length - 1);
  const slot = slots[slotIndex];

  /**
   * A new model joins at the end of the list, and the screen follows it there:
   * its card is brought into view and the sliders panel switches to it, so the
   * thing just created is the thing in front of you.
   */
  const addModel = () => {
    addSlot();
    setTab(slots.length);
    setTimeout(() => listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };

  const start = () => {
    slots.forEach((s, i) => {
      if (!s.name.trim()) patchSlot(i, { name: suggestFor(i) });
    });
    go('training');
  };

  return (
    <>
      <div className="toolbar">
        <div className="title">
          <div className="eyebrow">{s.eyebrow}</div>
          <h1 className="display">{continuing ? s.continue : multi ? s.together : s.newModel}</h1>
        </div>
      </div>

      {/*
        The way in and the way out, above everything that can be fiddled with.
        Every setting below this has a default that works, so somebody who only
        wants to watch a car learn should not have to scroll past ten sliders to
        find the button - and the estimate belongs up here with it, because how
        long it will take is the one thing worth knowing before starting.
      */}
      <div className="card notched start-bar">
        <Estimate />
        <TimeLimit />
        <div className="row start-bar-actions">
          {slots.some((s) => s.modelId) && (
            <button className="ghost" onClick={newDraft}>
              {s.startOver}
            </button>
          )}
          <button className="ghost" onClick={() => go('library')}>
            {s.cancel}
          </button>
          <CoachAnchor
            step={coach === 'setup' ? coach : null}
            text={s.coach}
          >
            <button className="primary" onClick={start}>
              {continuing ? s.continue : s.start}
            </button>
          </CoachAnchor>
        </div>
      </div>

      <div className="split-setup">
        <div className="grid">
          <div className="card notched">
            <div className="eyebrow" style={{ marginBottom: 10 }}>{s.who}</div>

            {multi && (
              <p className="muted small" style={{ margin: '0 0 10px' }}>
                {s.togetherExplain}
              </p>
            )}

            <div ref={listRef}>
              {slots.map((s, i) => (
                <SlotCard
                  key={i}
                  index={i}
                  slot={s}
                  // A model already on this grid cannot be picked twice: both
                  // seats would save over the same model, the last one winning.
                  saved={saved.filter((m) => m.id === s.modelId || !slots.some((o) => o.modelId === m.id))}
                  removable={slots.length > 1}
                  placeholder={suggestFor(i)}
                  onPatch={(p) => patchSlot(i, p)}
                  onPick={(m) => slotFromModel(i, m)}
                  onRemove={() => {
                    suggestions.current.splice(i, 1);
                    removeSlot(i);
                    setTab(0);
                  }}
                />
              ))}
            </div>

            {/* Under the list, not above it: a new slot is appended, so the
                button sits exactly where the card it creates will appear - the
                finger is already there and nothing scrolls out from under it. */}
            {slots.length < MAX_TRAIN_SLOTS && (
              <button
                className="small"
                style={{ marginTop: 10, width: '100%' }}
                onClick={addModel}
                title={s.addTitle}
              >
                {s.add}
              </button>
            )}
          </div>


          <div className="card notched">
            <div className="eyebrow" style={{ marginBottom: 12 }}>{s.trackAndTeam}</div>

            {/* One name, remembered: it fills the next model too, and it is what
                the championship entry races under. */}
            {!competitor || editingName ? (
              <div className="field">
                <TeamNameForm
                  label={s.teamLabel}
                  onSaved={() => setEditingName(false)}
                  onCancel={competitor ? () => setEditingName(false) : undefined}
                />
                {!competitor && (
                  <div className="small muted" style={{ marginTop: 6 }}>
                    {s.needTeam}
                  </div>
                )}
              </div>
            ) : (
              <div className="field">
                <label>{s.teamLabel}</label>
                <div className="row">
                  <b>{competitor}</b>
                  <button className="ghost small" onClick={() => setEditingName(true)}>
                    {s.rename}
                  </button>
                </div>
              </div>
            )}

            <GameOptions
              options={game.options}
              value={draft.config}
              hiddenKeys={TRAINING_HIDDEN_OPTIONS}
              onChange={(config) => patchDraft({ config: withTrainingDefaults(gameId, config) })}
            />
            {gameId === 'racing' && draft.config.trackId !== nextGrandPrixTrack() && (
              <div className="auth-note warn small" style={{ margin: '0 0 10px' }}>
                {s.otherTrack(trackName(nextGrandPrixTrack()))}{' '}
                <button
                  className="ghost small"
                  onClick={() =>
                    patchDraft({ config: withTrainingDefaults(gameId, { ...draft.config, trackId: nextGrandPrixTrack() }) })
                  }
                >
                  {s.trainThere}
                </button>
              </div>
            )}
            {gameId === 'racing' && (
              <div className="small muted">
                {s.fullGrid(TRAINING_GRID, TRAINING_LAPS)}
              </div>
            )}
          </div>
        </div>

        <div className="grid">
          <div className="card notched">
            {multi && (
              <div className="segmented" style={{ width: '100%', marginBottom: 10 }}>
                {slots.map((s, i) => (
                  <button
                    key={i}
                    style={{ flex: 1 }}
                    className={i === slotIndex ? 'on' : ''}
                    onClick={() => setTab(i)}
                  >
                    {s.name.trim() || suggestFor(i)}
                  </button>
                ))}
              </div>
            )}
            {multi && (
              <div className="small" style={{ marginBottom: 8 }}>
                {s.slidersOf} <b>{slot.name.trim() || suggestFor(slotIndex)}</b> {s.only}
                {slotIndex > 0 && !slot.modelId && (
                  <span className="muted">
                    {' '}
                    {s.bolder}
                  </span>
                )}
              </div>
            )}
            {/* Keyed by slot: each model gets its own editor, so nothing the
                last one had open or folded carries over to the next. */}
            <RewardEditor
              key={slotIndex}
              spec={game.spec}
              value={slot.rewards}
              onChange={(rewards) => patchSlot(slotIndex, { rewards })}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function SlotCard({
  index,
  slot,
  saved,
  removable,
  placeholder,
  onPatch,
  onPick,
  onRemove,
}: {
  index: number;
  slot: TrainSlot;
  saved: ModelMeta[];
  removable: boolean;
  placeholder: string;
  onPatch: (p: Partial<TrainSlot>) => void;
  onPick: (m: ModelMeta | null) => void;
  onRemove: () => void;
}) {
  // Algorithm and network shape are baked into saved weights, so a model that is
  // being continued cannot switch either without throwing the training away.
  const locked = slot.modelId !== null && !slot.restart;
  const s = useT().trainSetup;

  return (
    <div className="slot-card">
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="pill small">{s.car(index + 1)}</span>
        <div style={{ flex: 1 }} />
        {slot.modelId && (
          <span className={`pill small ${slot.restart ? 'warn' : 'good'}`}>
            {slot.restart ? s.wipe : s.continuing}
          </span>
        )}
        {removable && (
          <button className="ghost small" onClick={onRemove} title={s.removeTitle}>
            {s.remove}
          </button>
        )}
      </div>

      {/* A model being continued is that model: its name, its weights and its
          history are what is being trained, so none of them is up for change
          here. Renaming lives in the garage; starting over is a new model. */}
      {slot.modelId ? (
        <div className="field">
          <label>{s.continueTraining}</label>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{slot.name}</div>
        </div>
      ) : (
      <div className="cols-2">
        <div className="field">
          <label>{s.nameLabel}</label>
          <input
            type="text"
            value={slot.name}
            placeholder={placeholder}
            onChange={(e) => onPatch({ name: e.target.value })}
          />
        </div>

        <div className="field">
          <label>{s.from}</label>
          <select
            value={slot.modelId ?? ''}
            onChange={(e) => onPick(saved.find((m) => m.id === e.target.value) ?? null)}
          >
            <option value="">{s.fromScratch}</option>
            {saved.map((m) => (
              <option key={m.id} value={m.id}>
                {s.continueModel(m.name)}
              </option>
            ))}
          </select>
        </div>
      </div>
      )}

      {/* Folded: the default suits the device, and two method names were
          the first words a newcomer did not understand. */}
      <details className="field" style={{ marginBottom: 0 }}>
        <summary className="small muted" style={{ cursor: 'pointer' }}>
          {s.method} <b>{ALGORITHMS[slot.algorithm].name}</b> {locked ? s.locked : s.keep}
        </summary>
        <div className="segmented" style={{ width: '100%' }}>
          {(Object.keys(ALGORITHMS) as AlgorithmId[]).map((id) => (
            <button
              key={id}
              style={{ flex: 1 }}
              disabled={locked}
              className={slot.algorithm === id ? 'on' : ''}
              onClick={() => onPatch({ algorithm: id })}
            >
              {ALGORITHMS[id].name}
            </button>
          ))}
        </div>
        <div className="small muted">{ALGORITHMS[slot.algorithm].blurb}</div>
      </details>
    </div>
  );
}

/**
 * Measures this device by briefly running the configured algorithm, rather than
 * guessing from the user agent. A phone can be 3-5x slower than a laptop and the
 * gap is not predictable, so the only honest estimate is a measured one.
 */
function Estimate() {
  const s = useT().trainSetup;
  const { gameId, draft } = useApp();
  const [result, setResult] = useState<TimeEstimate | null>(null);
  const [measuring, setMeasuring] = useState(true);

  const slots = draft.slots.length;
  const key = JSON.stringify([gameId, draft.slots.map((s) => s.algorithm), draft.config]);

  useEffect(() => {
    setMeasuring(true);
    // Debounced and deferred: the probe blocks the main thread for ~250ms, which
    // would make typing in the fields above stutter.
    const timer = setTimeout(() => {
      try {
        // The slowest model sets the pace, and models on one grid share one CPU:
        // two of them take roughly twice as long to get anywhere as one alone.
        const each = draft.slots.map((s) =>
          estimateTraining(gameId, s.algorithm, draft.config, draft.hyper, draft.gaHyper),
        );
        const worst = each.reduce((a, b) => (b.seconds > a.seconds ? b : a));
        setResult({ ...worst, seconds: worst.seconds * slots });
      } catch {
        setResult(null);
      }
      setMeasuring(false);
    }, 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="estimate">
      <div className="eyebrow">{s.howLong}</div>
      {/* The same two lines whether measured yet or not: swapping a short
          "measuring" note for a big number and a sentence moved the start
          button out from under a finger that was on its way to it. */}
      {(measuring || result) && (
        <>
          {measuring ? (
            <span className="skel" style={{ width: 120, height: 30, display: 'inline-block' }} aria-label={s.measuringLabel} />
          ) : (
            <strong
              className="mono"
              style={{ fontSize: 24, lineHeight: '30px', color: 'var(--accent-2)' }}
              title={s.measured(Math.round(result!.rate).toLocaleString(locale()), result!.rateLabel)}
            >
              {formatEstimate(result!.seconds)}
            </strong>
          )}
          <span className="muted small">
            {slots > 1 ? s.untilGoodMany(slots) : s.untilGood}
            {' · '}
            {measuring ? s.measuring : s.approx}
          </span>
        </>
      )}
      {!measuring && !result && <span className="muted small">{s.measureFailed}</span>}
      {isMobileClass && (
        <span className="pill warn small">{s.mobile}</span>
      )}
    </div>
  );
}

/**
 * How long to train before stopping and saving by itself.
 *
 * A browser only trains while its tab is open - on a phone, while the screen
 * is on and the app is in front. Saying so up front, and offering a run that
 * ends in a saved model after five minutes, is what makes training on a phone
 * something that works instead of something that quietly stops.
 */
function TimeLimit() {
  const s = useT().trainSetup;
  const { draft, patchDraft } = useApp();
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className="eyebrow">{s.autoStop}</div>
      <div className="segmented">
        {TIME_LIMITS.map((m) => (
          <button
            key={m}
            className={draft.timeLimitMin === m ? 'on' : ''}
            onClick={() => {
              chooseTimeLimit(m);
              patchDraft({ timeLimitMin: m });
            }}
          >
            {m === 0 ? s.noLimit : s.minutes(m)}
          </button>
        ))}
      </div>
      <span className="muted small">
        {isMobileClass
          ? s.mobileNote
          : s.desktopNote}
      </span>
    </div>
  );
}
