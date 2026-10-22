import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageSkeleton } from '../components/PageSkeleton';
import { useApp } from '../store';
import { useChampionship, useNow } from '../useChampionship';
import { Canvas } from '../components/Canvas';
import { TimingTower, type TowerCar } from '../components/TimingTower';
import { StartLights } from '../components/StartLights';
import { drawPlaceholder, renderGame } from '../gameRenderers';
import { getArena } from '../../storage/arena';
import { SessionSim, policiesFor, replayDriversFor, type SimCar } from '../../core/champ/sim';
import { ReplayDriver, type DayReplay } from '../../core/champ/replay';
import { lapsFor } from '../../core/champ/format';
import { dayState, dayStatus, liveSession, sessionWindows } from '../../core/champ/timing';
import { shadeFor, teamColor, teamLook } from '../../core/champ/livery';
import { STEP_MS, type RacingSnapshot } from '../../core/games/racing/env';
import type { RaceCard } from '../../core/champ/types';
import { lapTime, raceTime, timeText, untilText } from '../format';
import { useIsPortrait, useWakeLock } from '../device';
import { track } from '../../storage/metrics';
import { useTeamPaint } from '../teamLooks';
import { Podium } from '../components/Podium';
import { t as words, useLang, useT } from '../../i18n';
import { driverName, grandPrixTitle, teamName } from '../../i18n/names';

/** Lights sequence before a replay. Live sessions get it from the wall clock. */
const PREROLL_MS = 5000;
/** Ceiling on catch-up work per animation frame, so a backgrounded tab recovers
 *  smoothly instead of locking the page for a second. */
const MAX_STEPS_PER_FRAME = 400;
/** What the skip buttons and the arrow keys jump. */
const SKIP_MS = 10000;
/** How far the simulation may trail the playhead before the viewer is told it is
 *  re-running the race rather than showing a frozen picture. */
const SEEK_SLACK_STEPS = 12;
/** A retired car is declared out some seconds after its last gate, so a session
 *  outlives its last recorded lap by about that much. Only used to guess the
 *  length of a replay before it has been played through to the flag once. */
const RETIREMENT_GRACE_MS = 8000;

type Camera = 'track' | 'follow';

/**
 * What drives the cars on screen.
 *
 * In the cloud, the replay the server recorded: nobody's weights reach the
 * browser. A local championship has its own weights and drives from those.
 * Before the lights there is nothing to drive yet - the cars only sit on the
 * grid - and `missing` is a race that has no replay at all.
 */
type DriveSource =
  | { kind: 'grid' }
  | { kind: 'replay'; replay: DayReplay }
  | { kind: 'weights'; weights: Map<string, string> }
  | { kind: 'missing' };

/** How often to ask again for a live race's replay that is not there yet. */
const REPLAY_RETRY_MS = 15_000;

export function Broadcast() {
  const b = useT().broadcast;
  const { viewRaceId, go, openRace } = useApp();
  const { state } = useChampionship();
  const now = useNow(500);

  const card = useMemo(() => {
    if (!state) return null;
    if (viewRaceId) return state.cards.find((c) => c.id === viewRaceId) ?? null;
    return (
      state.cards.find((c) => dayState(c, Date.now(), state.results.get(c.id)) === 'live') ??
      state.cards[state.cards.length - 1] ??
      null
    );
  }, [state, viewRaceId]);

  if (!state) {
    return (
      <div style={{ margin: 20 }}>
        <PageSkeleton variant="race" />
      </div>
    );
  }
  if (!card) {
    return (
      <div className="empty" style={{ margin: 20 }}>
        {b.nothing}
        <div style={{ marginTop: 14 }}>
          <button onClick={() => go('championship')}>{b.backToChamp}</button>
        </div>
      </div>
    );
  }

  return <BroadcastStage card={card} now={now} onExit={() => openRace(card.id, 'report')} onHome={() => go('championship')} />;
}

function BroadcastStage({
  card,
  now,
  onExit,
  onHome,
}: {
  card: RaceCard;
  now: number;
  onExit(): void;
  onHome(): void;
}) {
  const b = useT().broadcast;
  const lang = useLang();
  const { state } = useChampionship();
  const goTo = useApp((st) => st.go);
  /** Somebody with no car of their own: the end of a race is the moment to offer them one. */
  const spectator = state ? !state.entries.some((e) => e.uid === state.uid && !e.retired) : false;
  // The session names are in the reader's language, so they are worked out again when it changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const windows = useMemo(() => sessionWindows(card), [card, lang]);
  const live = liveSession(card, now);
  const isLive = live !== null;

  const [source, setSource] = useState<DriveSource | null>(null);
  const started = now >= card.startsAt;
  /** Bumped to ask again for a replay that was not there. */
  const [attempt, setAttempt] = useState(0);
  const [sessionId, setSessionId] = useState<string>(() => live?.session.id ?? windows[windows.length - 1]?.session.id);
  const [camera, setCamera] = useState<Camera>('track');
  // A wide circuit inside a tall viewport letterboxes badly. In portrait the
  // canvas keeps its own aspect and the timing tower takes the space underneath
  // instead of floating on top of it.
  const portrait = useIsPortrait();
  const [followIdx, setFollowIdx] = useState(0);
  const [, bump] = useState(0);

  const simRef = useRef<SessionSim | null>(null);
  const snapRef = useRef<RacingSnapshot | null>(null);
  /**
   * Wall-clock moment this session's playhead sits at zero - lights out.
   *
   * While a replay plays, the playhead is derived from this, so seeking is
   * nothing more than moving the anchor. A live session anchors to the real
   * lights-out and never moves.
   */
  const anchorRef = useRef(0);
  /** The playhead itself, in race milliseconds. Authoritative while paused. */
  const headRef = useRef(0);
  const playingRef = useRef(true);
  /** Exact length of the session - known only once it has run to the flag. */
  const endRef = useRef<number | null>(null);
  /** Wall clock the lights go out on. Kept apart from the anchor so that touching
   *  the transport cancels the ceremony instead of replaying it. */
  const prerollRef = useRef(0);
  const builtFor = useRef<string>('');

  const [playing, setPlaying] = useState(true);
  const [headMs, setHeadMs] = useState(0);
  const [endMs, setEndMs] = useState<number | null>(null);

  useWakeLock(true);
  useEffect(() => track('watch'), []);

  // A live day pulls the viewer along with it: when the next session starts, the
  // broadcast follows, the same way a television feed would.
  useEffect(() => {
    if (live && live.session.id !== sessionId) setSessionId(live.session.id);
  }, [live, sessionId]);

  /** The race `source` belongs to. */
  const sourceFor = useRef('');

  // The replay is read from the lights: before them it does not exist for the
  // browser (the rules keep a race's outcome sealed until it starts).
  useEffect(() => {
    if (sourceFor.current !== card.id) {
      // Never a moment of the previous race on screen, or driving this one.
      sourceFor.current = card.id;
      simRef.current = null;
      builtFor.current = '';
      setSource(null);
    }
    if (!started) {
      setSource({ kind: 'grid' });
      return;
    }
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const arena = await getArena();
      let next: DriveSource = { kind: 'missing' };
      try {
        const replay = await arena.loadReplay(card.id);
        if (replay) next = { kind: 'replay', replay };
        else if (arena.kind === 'local') {
          const weights = await arena.loadRaceWeights(card.id);
          if (weights.size) next = { kind: 'weights', weights };
        }
      } catch {
        // Refused or offline: the same as not there yet.
      }
      if (cancelled) return;
      setSource(next);
      if (next.kind === 'missing' && isLive) retry = setTimeout(() => setAttempt((n) => n + 1), REPLAY_RETRY_MS);
    })();
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, started, attempt]);

  const window_ = windows.find((w) => w.session.id === sessionId) ?? windows[0];
  const result = state?.results.get(card.id) ?? null;
  const storedSession = result?.sessions.find((s) => s.sessionId === sessionId) ?? null;
  const grid = storedSession?.grid.length ? storedSession.grid : window_?.session.grid ?? [];

  const entryById = useMemo(() => new Map(card.entries.map((e) => [e.id, e])), [card]);
  const myIds = useMemo(
    () => new Set(state ? state.entries.filter((e) => e.uid === state.uid).map((e) => e.id) : []),
    [state],
  );

  /** Livery per grid slot, plus a shade when a team fields more than one car. */
  // Paint bought in the shop, checked against what each team has earned.
  const paint = useTeamPaint(grid.map((id) => entryById.get(id)?.uid ?? ''));
  const towerCars: TowerCar[] = useMemo(() => {
    const seen = new Map<string, number>();
    return grid.map((id, i) => {
      const e = entryById.get(id);
      const team = e?.team ?? '-';
      const n = seen.get(team) ?? 0;
      seen.set(team, n + 1);
      const bought = e ? paint.get(e.uid) : undefined;
      return {
        car: i,
        name: e ? driverName(e) : '-',
        tag: e?.tag ?? '???',
        color: shadeFor(bought?.color ?? teamColor(team), n),
        look: { ...teamLook(team, e?.driver ?? ''), ...bought?.look },
        mine: myIds.has(id),
      };
    });
  }, [grid, entryById, myIds, paint, lang]);

  const colors = towerCars.map((c) => c.color);
  const labels = towerCars.map((c) => c.tag);
  const looks = towerCars.map((c) => c.look);

  /**
   * A fresh simulation of the selected session.
   *
   * Rewinding works by building one of these and running it forward again: the
   * race is deterministic, so replaying the first thirty seconds produces the
   * same thirty seconds it produced a minute ago, and nothing has to be held in
   * memory to be able to scrub back into it.
   */
  const buildSim = useCallback((): SessionSim | null => {
    if (!source || !window_ || grid.length === 0) return null;
    let cars: SimCar[] = [];
    if (source.kind === 'replay') cars = replayDriversFor(grid, source.replay.get(window_.session.id) ?? {});
    else if (source.kind === 'weights') cars = policiesFor(grid, entryById, source.weights);
    else if (source.kind === 'grid') cars = grid.map((entryId) => ({ entryId, policy: new ReplayDriver('') }));
    if (cars.length === 0) return null;
    return new SessionSim(
      card.trackId,
      lapsFor(window_.session),
      cars,
      card.seed + window_.session.offsetMs,
      card.physics,
    );
  }, [source, window_, grid, entryById, card]);

  // Build (or rebuild) the simulation for the selected session.
  useEffect(() => {
    if (!window_) return;
    const key = `${card.id}:${sessionId}:${grid.length}:${source?.kind}`;
    if (builtFor.current === key) return;
    const sim = buildSim();
    if (!sim) return;
    builtFor.current = key;
    simRef.current = sim;
    snapRef.current = sim.snapshot();
    endRef.current = null;
    setEndMs(null);
    headRef.current = 0;
    setHeadMs(0);
    playingRef.current = true;
    setPlaying(true);

    if (isLive) {
      // Join in progress: fast-forward silently to wherever the world is.
      anchorRef.current = window_.startsAt;
      const elapsed = Date.now() - window_.startsAt;
      if (elapsed > 0) sim.advanceTo(elapsed);
    } else {
      anchorRef.current = Date.now() + PREROLL_MS;
    }
    prerollRef.current = anchorRef.current;
    // Default the follow camera to the viewer's own car, if they have one here.
    const mineIdx = towerCars.findIndex((c) => c.mine);
    setFollowIdx(mineIdx >= 0 ? mineIdx : 0);
    bump((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, sessionId, card.id, grid.length]);

  /**
   * How long the replay runs.
   *
   * Until the session has been played through once, this is read off the stored
   * classification - the last car home, or a retirement plus the delay before it
   * is declared out. The moment the simulation actually finishes, the exact
   * figure replaces the estimate.
   */
  const estimatedMs = useMemo(() => {
    let max = 0;
    for (const f of storedSession?.classification ?? []) {
      const ran = f.lapTimesMs.reduce((a, b) => a + b, 0);
      const t = f.totalMs ?? ran + RETIREMENT_GRACE_MS;
      if (t > max) max = t;
    }
    if (max === 0 && window_) max = lapsFor(window_.session) * 12000;
    return Math.ceil(max / 1000) * 1000;
  }, [storedSession, window_]);
  // Whatever happens, the playhead is never past the end of its own slider.
  const durationMs = Math.max(endMs ?? estimatedMs, headMs, 1000);

  /** Move the playhead. While playing this only moves the anchor; the draw loop
   *  notices the simulation is ahead of it and re-runs the race to meet it. */
  const seek = useCallback((ms: number) => {
    prerollRef.current = 0;
    const t = Math.max(0, Math.min(endRef.current ?? Number.MAX_SAFE_INTEGER, ms));
    headRef.current = t;
    setHeadMs(t);
    if (playingRef.current) anchorRef.current = Date.now() - t;
  }, []);

  const setPlayState = useCallback((on: boolean) => {
    prerollRef.current = 0;
    // Play, from a playhead parked on the flag, means watch it again.
    if (on && endRef.current !== null && headRef.current >= endRef.current) headRef.current = 0;
    if (on) anchorRef.current = Date.now() - headRef.current;
    else headRef.current = Math.max(0, Date.now() - anchorRef.current);
    playingRef.current = on;
    setPlaying(on);
  }, []);

  /**
   * Drive the clock, not a frame counter.
   *
   * In a live session the step index is derived from wall-clock time, so two
   * people watching on two devices see the same corner at the same second even
   * if one of them dropped frames or had the tab in the background. This is also
   * why a live session has no speed control: the race is a shared, fixed-rate
   * event. A replay runs off the same clock - only there, the playhead moves.
   */
  const drawFrame = (ctx: CanvasRenderingContext2D) => {
    let sim = simRef.current;
    if (!sim) {
      drawPlaceholder(
        ctx,
        source?.kind === 'missing' && !isLive
          ? [words().broadcast.noReplay, grandPrixTitle(card.trackId)]
          : [words().broadcast.connecting, grandPrixTitle(card.trackId)],
      );
      return;
    }
    // Cars on the grid with nothing to drive them yet - before the lights, or
    // while the replay is on its way - stay where they are.
    const parked = source?.kind !== 'replay' && source?.kind !== 'weights';
    let ms = parked ? 0 : Math.max(0, playingRef.current ? Date.now() - anchorRef.current : headRef.current);
    const target = Math.floor(ms / STEP_MS);
    if (sim.env.step_ > target) {
      // Rewind: the only way back through a simulation is forward through a new
      // one. Cheap in memory, and it cannot drift from what the timing sheet
      // recorded, because it is the same computation that produced it.
      const fresh = buildSim();
      if (fresh) {
        simRef.current = fresh;
        sim = fresh;
      }
    }
    if (!sim.done && sim.env.step_ < target) {
      let budget = MAX_STEPS_PER_FRAME;
      while (!sim.done && sim.env.step_ < target && budget-- > 0) sim.step();
    }
    if (sim.done) {
      // The flag is the end of the recording. The playhead stops on it rather
      // than running on into nothing, and the transport stops with it - which is
      // what every player does when a video ends.
      const end = sim.env.step_ * STEP_MS;
      if (endRef.current === null) endRef.current = end;
      if (ms > end) {
        ms = end;
        playingRef.current = false;
      }
    }
    headRef.current = ms;
    const snap = sim.snapshot();
    snapRef.current = snap;
    // Following a car that has retired means watching a parked wreck; the feed
    // cuts to the leader, which is what a director would do.
    const focus = snap.cars[followIdx]?.done ? (snap.order[0] ?? followIdx) : followIdx;
    renderGame('racing', ctx, snap, {
      labels,
      colors,
      looks,
      dimDone: true,
      // Bottom: the lap counter and race clock own the top-left of a broadcast.
      minimap: camera === 'follow' ? 'bottom' : undefined,
      follow: camera === 'follow' ? { car: focus, viewHeight: 260, rotate: true } : undefined,
    });
  };

  // Re-render the overlay ~6 times a second; the canvas has its own loop.
  useEffect(() => {
    const id = setInterval(() => {
      // The draw loop owns the playhead; this pulls what it settled on into the
      // transport, including a stop at the flag it decided on its own.
      setEndMs(endRef.current);
      setPlaying(playingRef.current);
      setHeadMs(Math.max(0, headRef.current));
      bump((n) => n + 1);
    }, 160);
    return () => clearInterval(id);
  }, []);

  // Keyboard, for whoever is watching on a laptop: space plays and pauses, the
  // arrows jump. A live session has nothing to jump to.
  useEffect(() => {
    if (isLive) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlayState(!playingRef.current);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seek(headRef.current + SKIP_MS);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seek(headRef.current - SKIP_MS);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isLive, seek, setPlayState]);

  const snap = snapRef.current;
  // What follows the session on screen, for the gap between the flag and the
  // next set of lights.
  const nextSession = useMemo(() => {
    const status = dayStatus(card, state?.results.get(card.id), now);
    return status.next && status.current?.session.id === sessionId ? status.next : null;
  }, [card, state, now, sessionId]);
  const toLights = playing ? prerollRef.current - now : -1;
  const preStart = toLights > 0;
  const sim = simRef.current;
  const finished = sim?.done ?? false;
  const totalLaps = window_ ? lapsFor(window_.session) : 0;
  const leadLap = snap ? Math.min(totalLaps, (snap.cars[snap.order[0]]?.lap ?? 0) + 1) : 0;
  // Re-running the race after a rewind takes a moment on a phone. Saying so is
  // the difference between a picture that is catching up and one that is stuck.
  const targetStep = Math.floor(headMs / STEP_MS);
  const behind = sim && !sim.done ? targetStep - sim.env.step_ : 0;
  const rewinding = behind > SEEK_SLACK_STEPS;
  const rewindPct = targetStep > 0 ? Math.min(99, Math.floor(((targetStep - behind) / targetStep) * 100)) : 0;

  return (
    <div className="match-fill">
      <div className="match-bar">
        <button className="small" onClick={onHome}>
          {b.backArrow}
        </button>
        <strong style={{ fontSize: 13 }}>{grandPrixTitle(card.trackId)}</strong>
        {isLive ? (
          <span className="pill live small">
            <span className="blip" /> {b.live}
          </span>
        ) : (
          <span className="pill small">{b.replay}</span>
        )}
        <span className="muted tiny">{window_?.session.name}</span>
        <div style={{ flex: 1 }} />

        {windows.length > 1 && (
          <select
            value={sessionId}
            disabled={isLive}
            style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
            onChange={(e) => setSessionId(e.target.value)}
          >
            {windows.map((w) => (
              <option key={w.session.id} value={w.session.id}>
                {w.session.name} · {timeText(w.startsAt)}
              </option>
            ))}
          </select>
        )}

        <div className="segmented">
          <button className={camera === 'track' ? 'on' : ''} onClick={() => setCamera('track')}>
            {b.track}
          </button>
          <button className={camera === 'follow' ? 'on' : ''} onClick={() => setCamera('follow')}>
            {b.car}
          </button>
        </div>
        {camera === 'follow' && (
          <select
            value={followIdx}
            style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
            onChange={(e) => setFollowIdx(Number(e.target.value))}
          >
            {towerCars.map((c, i) => (
              <option key={i} value={i}>
                {c.name}
                {c.mine ? b.mine : ''}
              </option>
            ))}
          </select>
        )}
        <button className="small" onClick={onExit}>
          {b.report}
        </button>
      </div>

      <div className={`match-stage ${portrait ? 'stacked' : ''}`}>
        {portrait ? <Canvas aspect={16 / 11} draw={drawFrame} /> : <Canvas fillHeight draw={drawFrame} />}

        {snap && !preStart && !portrait && (
          <div className="stage-overlay">
            <TimingTower snap={snap} cars={towerCars} />
          </div>
        )}

        {snap && !preStart && (
          <div className="stage-overlay-end" style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
            <div className="pill" style={{ fontSize: 13 }}>
              {b.lap} <span className="mono">{leadLap}</span> / {totalLaps}
            </div>
            <div className="pill mono">{raceTime(snap.raceMs)}</div>
            {snap.fastestLap && (
              <div className="pill" style={{ borderColor: 'var(--purple)', color: 'var(--purple)' }}>
                {b.fastLap} {towerCars[snap.fastestLap.car]?.name ?? ''} ·{' '}
                <span className="mono">{lapTime(snap.fastestLap.ms)}</span>
              </div>
            )}
          </div>
        )}

        {rewinding && (
          <div className="seek-note">
            {b.rewinding} <span className="mono">{rewindPct}%</span>
          </div>
        )}

        {preStart && (
          <div className="countdown">
            <StartLights secondsLeft={toLights / 1000} />
            <div className="word">{window_?.session.name}</div>
            <div className="muted small">
              {isLive ? b.liveIn : b.replayIn}{' '}
              <span className="mono">{Math.ceil(toLights / 1000)}</span> {b.seconds}
            </div>
          </div>
        )}

        {finished && snap && (
          <div className="done-overlay">
            <div className="checkers" style={{ width: 220 }} />
            <h1 className="display">{b.wins(towerCars[snap.order[0]]?.name ?? '')}</h1>
            <div className="muted small">
              {window_?.session.name} · {grandPrixTitle(card.trackId)} · {b.raceTime(raceTime(snap.cars[snap.order[0]]?.totalMs ?? snap.raceMs))}
            </div>
            <Podium
              compact
              places={snap.order.slice(0, 3).map((car, i) => {
                const c = snap.cars[car];
                const t = towerCars[car];
                return {
                  position: i + 1,
                  driver: t?.name ?? '-',
                  team: teamName(entryById.get(grid[car] ?? '')?.team ?? ''),
                  color: t?.color ?? '#888',
                  look: t?.look,
                  detail: !c?.finished
                    ? b.retired
                    : i === 0
                      ? raceTime(c.totalMs)
                      : b.gap(((c.totalMs! - (snap.cars[snap.order[0]]?.totalMs ?? 0)) / 1000).toFixed(1)),
                };
              })}
            />
            {/* The flag has fallen but the slot has not run out. Rather than a
                clock ticking up over a finished race, say when the next one
                starts - and let the viewer read this one's result meanwhile. */}
            {isLive && nextSession && (
              <div className="pill" style={{ fontSize: 15 }}>
                {b.startsIn(nextSession.session.name)}{' '}
                <span className="mono">{untilText(nextSession.startsAt - now)}</span>
              </div>
            )}
            {isLive && !nextSession && <div className="pill good">{b.dayOver}</div>}
            {/* Watching was the first thing they did, and a table of numbers
                was the next - which is where a curious visitor left. So the
                end of the race asks the obvious question instead. */}
            {spectator && (
              <div className="try-cta">
                <b>{b.ctaTitle}</b>
                <span className="small muted">{b.ctaBody}</span>
                <button className="primary" onClick={() => goTo('library')}>
                  {b.ctaButton}
                </button>
              </div>
            )}
            <div className="row">
              <button className={spectator ? '' : 'primary'} onClick={onExit}>
                {isLive && nextSession ? b.sessionResults(window_?.session.name ?? '') : b.toReport}
              </button>
              {/* A live broadcast cannot be rewound: everyone is watching the
                  same moment, and a replay only becomes available once the
                  session's slot on the schedule is over. */}
              {!isLive && (
                <button
                  onClick={() => {
                    setPlayState(true);
                    seek(0);
                  }}
                >
                  {b.replay}
                </button>
              )}
              {isLive && <button onClick={onHome}>{b.backToChamp}</button>}
            </div>
          </div>
        )}
      </div>

      {portrait && snap && !preStart && (
        <div className="tower-below">
          <TimingTower snap={snap} cars={towerCars} />
        </div>
      )}

      {isLive ? (
        <div className="match-bar" style={{ justifyContent: 'center' }}>
          <span className="dim tiny">
            {b.realTime}
          </span>
        </div>
      ) : (
        <div className="scrub">
          <button
            className="icon"
            onClick={() => setPlayState(!playing)}
            aria-label={playing ? b.pause : b.play}
            title={playing ? b.pauseKey : b.playKey}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <button
            className="icon ghost"
            onClick={() => seek(headMs - SKIP_MS)}
            aria-label={b.back10}
            title={b.back10}
          >
            {/* Two boxes rather than one string: the arrow is a neutral character
                and would swap sides with the digits depending on what surrounds
                it, leaving the two skip buttons looking identical. */}
            <span>↺</span>
            <span>10</span>
          </button>
          <span className="mono tiny clock">{raceTime(Math.min(headMs, durationMs))}</span>
          <input
            type="range"
            min={0}
            max={durationMs}
            step={100}
            value={Math.min(headMs, durationMs)}
            style={{ ['--fill' as string]: `${durationMs > 0 ? (Math.min(headMs, durationMs) / durationMs) * 100 : 0}%` }}
            aria-label={b.position}
            onChange={(e) => seek(Number(e.target.value))}
          />
          <span className="mono tiny clock dim">{raceTime(durationMs)}</span>
          <button
            className="icon ghost"
            onClick={() => seek(headMs + SKIP_MS)}
            aria-label={b.forward10}
            title={b.forward10}
          >
            <span>10</span>
            <span>↻</span>
          </button>
        </div>
      )}
    </div>
  );
}
