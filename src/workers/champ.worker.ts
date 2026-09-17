import { buildRaceCard } from '../core/champ/card';
import { runRaceDay } from '../core/champ/sim';
import type { FromChamp, ToChamp } from './champProtocol';

/**
 * Qualifying and a whole race day are a few seconds of solid arithmetic. Run on
 * the main thread that would freeze the standings screen mid-scroll, so it runs
 * here instead.
 */
self.onmessage = (ev: MessageEvent<ToChamp>) => {
  const msg = ev.data;
  const post = (m: FromChamp) => (self as unknown as Worker).postMessage(m);
  try {
    if (msg.type === 'buildCard') {
      post({ type: 'card', tag: msg.tag, card: buildRaceCard(msg.round, msg.entries, new Map(msg.weights)) });
    } else if (msg.type === 'runDay') {
      post({ type: 'result', tag: msg.tag, result: runRaceDay(msg.card, new Map(msg.weights)) });
    }
  } catch (e) {
    post({ type: 'error', tag: msg.tag, message: e instanceof Error ? e.message : String(e) });
  }
};
