import { useEffect, useRef, useState } from 'react';
import { getGame } from '../../core/games/registry';
import { useApp } from '../store';
import { Canvas } from '../components/Canvas';
import { drawPlaceholder, renderGame } from '../gameRenderers';
import { StartLights } from '../components/StartLights';

import { Policy } from '../../core/rl/policy';
import { defaultRewards, type Env } from '../../core/games/types';
import { TouchPad } from '../components/TouchPad';
import { goFullscreenLandscape, isTouchDevice, useIsPortrait } from '../device';
import { loadOpponent } from '../opponents';
import { lapTime, posClass, raceTime } from '../format';
import type { RacingSnapshot } from '../../core/games/racing/env';

type Phase = 'loading' | 'countdown' | 'racing' | 'done';

interface Standing {
  car: number;
  name: string;
  team: string;
  color: string;
  laps: number;
  finished: boolean;
  timeMs: number | null;
  bestLapMs: number | null;
}

const STEP_MS = 1000 / 60;
const COUNTDOWN_MS = 5000;
/** The player's own colour. Fixed, so "which one am I" is never a question. */
const PLAYER_COLOR = '#ffffff';

export function RaceScreen() {
  const { gameId, race, go } = useApp();
  const game = getGame(gameId);

  const envRef = useRef<Env<unknown> | null>(null);
  const policiesRef = useRef<(Policy | null)[]>([]);
  const namesRef = useRef<string[]>([]);
  const teamsRef = useRef<string[]>([]);
  const colorsRef = useRef<string[]>([]);
  const obsRef = useRef<Float32Array>(new Float32Array(game.spec.obsSize));
  const actionsRef = useRef<Int32Array>(new Int32Array(1));
  const keysRef = useRef(new Set<string>());
  const accRef = useRef(0);
  const lastRef = useRef(0);
  const phaseRef = useRef<Phase>('loading');
  const startedAtRef = useRef(0);
  const finishTimesRef = useRef<(number | null)[]>([]);
  const hudTickRef = useRef(0);

  const [phase, setPhase] = useState<Phase>('loading');
  const [countdown, setCountdown] = useState(COUNTDOWN_MS);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** True once every AI car has finished — the player is the only one still out there. */
  const [opponentsDone, setOpponentsDone] = useState(false);
  // Playing is landscape-only: the tracks are 1000x700 and the controls need a row of their own.
  const portrait = useIsPortrait();
  const mustRotate = isTouchDevice && portrait;
  const compact = isTouchDevice && !portrait;
  const stageRef = useRef<HTMLDivElement>(null);

  /** Action index used by finished agents — the middle of the action list is a no-op in both games. */
  const neutralAction = Math.floor(game.spec.actions.length / 2);

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const policies: (Policy | null)[] = [null]; // car 0 is the player
        const names = ['אתה'];
        const teams = [useApp.getState().competitor || 'הקבוצה שלי'];
        const colors = [PLAYER_COLOR];

        for (const id of race.opponents) {
          const opp = await loadOpponent(id);
          if (!opp) continue;
          policies.push(opp.policy);
          names.push(opp.name);
          teams.push(opp.team);
          colors.push(opp.color);
        }
        if (cancelled) return;
        if (policies.length < 2) {
          setError('לא הצלחתי לטעון אף מודל יריב');
          return;
        }

        const env = game.createEnv(game.raceConfig(race.config, policies.length - 1), defaultRewards(game.spec));
        env.reset(Math.floor(Math.random() * 1e9));

        envRef.current = env;
        policiesRef.current = policies;
        namesRef.current = names;
        teamsRef.current = teams;
        colorsRef.current = colors;
        actionsRef.current = new Int32Array(policies.length);
        finishTimesRef.current = new Array(policies.length).fill(null);
        startedAtRef.current = performance.now();
        setPhaseBoth('countdown');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    const down = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      keysRef.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.code);
    const blur = () => keysRef.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);

    return () => {
      cancelled = true;
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildStandings = (): Standing[] => {
    const env = envRef.current;
    if (!env) return [];
    const snap = env.snapshot() as {
      cars?: Array<{ lap: number; finished: boolean; bestLapMs: number | null; totalMs: number | null }>;
      scores?: number[];
      order: number[];
    };
    return snap.order.map((car) => ({
      car,
      name: namesRef.current[car] ?? String(car),
      team: teamsRef.current[car] ?? '',
      color: colorsRef.current[car] ?? '#888',
      laps: snap.cars?.[car]?.lap ?? snap.scores?.[car] ?? 0,
      // Fall back to the agent flag for a game with no per-car snapshot.
      finished: snap.cars?.[car]?.finished ?? env.isAgentDone(car),
      // The simulation's own clock, not the wall clock. Frame time is captured
      // once per animation frame, so two cars finishing within the same frame
      // would print identical times while the classification separated them.
      timeMs: snap.cars?.[car]?.totalMs ?? finishTimesRef.current[car],
      bestLapMs: snap.cars?.[car]?.bestLapMs ?? null,
    }));
  };

  /** Advances the simulation. Called from the canvas animation frame. */
  const simulate = (now: number) => {
    const env = envRef.current;
    if (!env) return;

    if (phaseRef.current === 'countdown') {
      const elapsed = now - startedAtRef.current;
      setCountdown(Math.max(0, COUNTDOWN_MS - elapsed));
      if (elapsed >= COUNTDOWN_MS) {
        setPhaseBoth('racing');
        startedAtRef.current = now;
        lastRef.current = now;
        accRef.current = 0;
      }
      return;
    }
    if (phaseRef.current !== 'racing') return;

    // Fixed timestep keeps the physics frame-rate independent. The catch-up is
    // capped so a backgrounded tab does not fast-forward the whole race on return.
    accRef.current += Math.min(250, now - lastRef.current);
    lastRef.current = now;

    while (accRef.current >= STEP_MS) {
      accRef.current -= STEP_MS;
      const actions = actionsRef.current;
      const policies = policiesRef.current;
      for (let i = 0; i < policies.length; i++) {
        if (env.isAgentDone(i)) {
          actions[i] = neutralAction;
          continue;
        }
        if (i === 0) {
          actions[i] = game.humanAction(keysRef.current);
        } else {
          env.observe(i, obsRef.current);
          actions[i] = policies[i]!.act(obsRef.current);
        }
      }
      const res = env.step(actions);

      for (let i = 0; i < policies.length; i++) {
        if (finishTimesRef.current[i] === null && res.done[i] === 1) {
          finishTimesRef.current[i] = now - startedAtRef.current;
        }
      }

      if (res.allDone) {
        setStandings(buildStandings());
        setPhaseBoth('done');
        return;
      }
    }

    if (now - hudTickRef.current > 120) {
      hudTickRef.current = now;
      setStandings(buildStandings());
      let allOthersDone = true;
      for (let i = 1; i < policiesRef.current.length; i++) {
        if (!env.isAgentDone(i)) {
          allOthersDone = false;
          break;
        }
      }
      setOpponentsDone(allOthersDone);
    }
  };

  /** Stop waiting and show the standings as they stand. */
  const endRace = () => {
    setStandings(buildStandings());
    setPhaseBoth('done');
  };

  const restart = () => {
    const env = envRef.current;
    if (!env) return;
    env.reset(Math.floor(Math.random() * 1e9));
    finishTimesRef.current = finishTimesRef.current.map(() => null);
    startedAtRef.current = performance.now();
    setCountdown(COUNTDOWN_MS);
    setOpponentsDone(false);
    setPhaseBoth('countdown');
  };

  if (error) {
    return (
      <div className="empty">
        <h2>לא ניתן להתחיל {game.matchNoun}</h2>
        <p>{error}</p>
        <button onClick={() => go('raceSetup')}>חזרה</button>
      </div>
    );
  }

  const drawFrame = (ctx: CanvasRenderingContext2D) => {
    simulate(performance.now());
    const env = envRef.current;
    if (!env) {
      drawPlaceholder(ctx, ['טוען את היריבים…']);
      return;
    }
    renderGame(gameId, ctx, env.snapshot(), {
      playerCar: 0,
      labels: namesRef.current,
      colors: colorsRef.current,
      dimDone: true,
      // Chase camera, heading up. Training keeps the whole-track overview instead,
      // where the point is watching every car at once.
      follow: { car: 0, viewHeight: 230, rotate: true },
      // On touch the throttle sits over the bottom corners, so the map moves up.
      minimap: compact ? 'top' : 'bottom',
    });
  };

  const countdownOverlay = phase === 'countdown' && (
    <div className={`countdown ${compact ? 'small' : ''}`}>
      <StartLights secondsLeft={countdown / 1000} />
      {countdown <= 0 && <div className="word">צא!</div>}
    </div>
  );

  const leader = standings[0];
  const won = leader?.car === 0;
  // "Won" is reserved for taking the flag. Being ahead when someone stopped the
  // clock is leading, not winning, and calling it a win is exactly the kind of
  // scoreboard nobody believes twice.
  const winnerLine = !leader
    ? ''
    : leader.finished
      ? won
        ? 'ניצחת! 🏆'
        : `${leader.name} ניצח`
      : won
        ? `הובלת כש${game.matchNoun} נעצר`
        : `${leader.name} הוביל כש${game.matchNoun} נעצר`;
  const snap = envRef.current ? (envRef.current.snapshot() as Partial<RacingSnapshot>) : null;

  const standingsRows = standings.map((s, i) => (
    <tr key={s.car} className={s.car === 0 ? 'me' : ''}>
      <td style={{ width: 44 }}>
        <span className={posClass(i + 1)}>{i + 1}</span>
      </td>
      <td>
        <div className="driver">
          <span className="livery" style={{ background: s.color }} />
          <div className="names">
            <span className="who" style={{ fontWeight: s.car === 0 ? 800 : 600 }}>
              {s.name}
            </span>
            <span className="team">{s.team}</span>
          </div>
        </div>
      </td>
      <td className="mono num small muted">{s.bestLapMs ? lapTime(s.bestLapMs) : '—'}</td>
      <td className="mono num small">
        {s.timeMs !== null ? raceTime(s.timeMs) : `הקפה ${s.laps + 1}`}
      </td>
    </tr>
  ));

  // Touch landscape: claim the whole viewport so the controls cannot fall below
  // the fold on a 375px-tall screen.
  if (compact) {
    return (
      <div className="match-fill">
        <div className="match-bar">
          <strong style={{ fontSize: 13 }}>{game.matchNoun}</strong>
          <span className="muted tiny">{game.touchHint}</span>
          <div style={{ flex: 1 }} />
          {phase === 'racing' && (
            <button className={opponentsDone ? 'primary' : ''} onClick={endRace}>
              סיים
            </button>
          )}
          <button onClick={restart} disabled={phase === 'loading'}>
            מחדש
          </button>
          <button className="ghost" onClick={() => go('raceSetup')}>
            יציאה
          </button>
        </div>

        <div className="match-stage" ref={stageRef}>
          <Canvas fillHeight draw={drawFrame} />
          {/* Over the track, not below it. Stacking the pedals into a column
              made the control strip tall enough to take a third of a landscape
              phone away from the thing being controlled. */}
          <TouchPad layout={game.touchControls} keys={keysRef} />
          {phase !== 'done' && standings.length > 0 && (
            <div className="stage-overlay">
              <div className="tower">
                {standings.map((s, i) => (
                  <div className={`row-t ${s.car === 0 ? 'me' : ''}`} key={s.car}>
                    <span className="p">{i + 1}</span>
                    <span className="livery" style={{ background: s.color }} />
                    <span className="who">{s.name}</span>
                    <span className="gap">{s.finished ? '✓' : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {countdownOverlay}
          {phase === 'done' && (
            <div className="done-overlay">
              <div className={`pill ${won ? 'good' : ''}`}>{winnerLine}</div>
              <button className="primary" onClick={restart}>
                עוד {game.matchNoun}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="toolbar">
        <div className="title">
          <div className="eyebrow">מגרש אימונים</div>
          <h1 className="display">{game.matchNoun}</h1>
          <span className="muted small">{isTouchDevice ? game.touchHint : game.controlsHint}</span>
        </div>
        <div className="actions">
          {phase === 'racing' && (
            <button className={opponentsDone ? 'primary' : ''} onClick={endRace}>
              סיים {game.matchNoun}
            </button>
          )}
          <button onClick={restart} disabled={phase === 'loading'}>
            {game.matchNoun} מחדש
          </button>
          <button className="ghost" onClick={() => go('raceSetup')}>
            שינוי הגדרות
          </button>
        </div>
      </div>

      <div className="split-wide">
        <div style={{ position: 'relative' }} ref={stageRef}>
          {mustRotate ? (
            <div className="rotate-gate">
              <div className="glyph">📱</div>
              <h2>סובב את המכשיר</h2>
              <p className="muted" style={{ margin: 0, maxWidth: 300 }}>
                {game.matchNoun} משוחק לרוחב — כך המסלול נכנס למסך ויש מקום לפקדים.
              </p>
              <button
                className="primary"
                onClick={() => stageRef.current && void goFullscreenLandscape(stageRef.current)}
              >
                מסך מלא
              </button>
            </div>
          ) : (
            <Canvas aspect={16 / 10} draw={drawFrame} />
          )}
          {!mustRotate && countdownOverlay}
          {!mustRotate && phase === 'racing' && snap?.raceMs !== undefined && (
            <div className="stage-overlay-end">
              <span className="pill mono">{raceTime(snap.raceMs)}</span>
            </div>
          )}
        </div>

        <div className="card notched" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 6px' }}>
            <div className="eyebrow">{phase === 'done' ? 'תוצאות' : 'דירוג'}</div>
            {phase === 'racing' && opponentsDone && (
              <div className="pill warn" style={{ marginTop: 8 }}>
                כל היריבים סיימו
              </div>
            )}
          </div>
          <table className="timing">
            {/* Two bare numeric columns are unreadable without these: a lap time
                and a race time look alike, and a player comparing the wrong pair
                concludes the scoreboard is lying. */}
            <thead>
              <tr>
                <th style={{ width: 44 }}>#</th>
                <th>נהג</th>
                <th className="num">הקפה מהירה</th>
                <th className="num">זמן מרוץ</th>
              </tr>
            </thead>
            <tbody>{standingsRows}</tbody>
          </table>
          {phase === 'done' && (
            <div style={{ padding: 14 }}>
              <div className={`pill ${won ? 'good' : ''}`} style={{ marginBottom: 10 }}>
                {winnerLine}
              </div>
              <button className="primary" onClick={restart} style={{ width: '100%' }}>
                עוד {game.matchNoun}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
