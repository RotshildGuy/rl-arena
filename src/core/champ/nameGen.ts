/**
 * Default names for new models: two random English words, the way a console
 * hands out a gamertag.
 *
 * Most people overwrite the suggestion, some keep it, and the ones that are
 * kept end up on a public leaderboard next to everybody else's. So the
 * generator is built around one invariant: **every pair the lists can produce
 * has to be inoffensive** — not most pairs, every pair. Three things hold it
 * up, and none of them is a filter running over free text:
 *
 * 1. The words are split by role. An adjective is never drawn into the noun
 *    slot, so the result stays grammatical and the space of outcomes is the
 *    product of two curated lists rather than of one big bag of words.
 * 2. The vocabulary stays inside safe domains — speed, light, weather, stone,
 *    animals, space, machinery. No people, places, body parts, food, weapons
 *    or instruments: that is where English keeps most of its double meanings.
 * 3. `scripts/sanity.ts` walks the entire cross product on every run and fails
 *    on any pair that trips `BANNED`, exceeds `NAME_MAX` or does not satisfy
 *    `isNameOk`. The promise is checked over all of the pairs, not sampled.
 *
 * Adding a word is cheap, and the sanity run is what says whether it was a
 * good idea. Keep both lists free of anything that needs a second reading.
 */
import { NAME_MAX, isNameOk } from './names';

/** Ten characters at most, so any pair fits inside `NAME_MAX` with room. */
export const NAME_ADJECTIVES = [
  'Swift', 'Rapid', 'Turbo', 'Nimble', 'Brisk', 'Fleet', 'Quick', 'Sudden',
  'Steady', 'Restless', 'Tireless', 'Fearless', 'Endless', 'Relentless',
  'Eager', 'Bold', 'Brave', 'Noble', 'Loyal', 'Clever', 'Gentle', 'Mighty',
  'Grand', 'Royal', 'Regal', 'Humble', 'Patient', 'Curious', 'Cheerful',
  'Sunny', 'Merry', 'Lucky', 'Jolly', 'Radiant', 'Gleaming', 'Shining',
  'Glowing', 'Blazing', 'Molten', 'Frosted', 'Frozen', 'Icy', 'Misty',
  'Foggy', 'Stormy', 'Breezy', 'Snowy', 'Cosmic', 'Stellar', 'Lunar',
  'Solar', 'Astral', 'Orbital', 'Arctic', 'Polar', 'Alpine', 'Coastal',
  'Tidal', 'Wild', 'Free', 'Lone', 'Hidden', 'Secret', 'Silent', 'Quiet',
  'Neon', 'Chrome', 'Cobalt', 'Crimson', 'Scarlet', 'Amber', 'Azure',
  'Emerald', 'Indigo', 'Violet', 'Golden', 'Silver', 'Copper', 'Bronze',
  'Ivory', 'Jade', 'Onyx', 'Velvet', 'Marble', 'Electric', 'Magnetic',
  'Atomic', 'Quantum', 'Digital', 'Nitro', 'Kinetic', 'Sonic',
] as const;

export const NAME_NOUNS = [
  // wings
  'Falcon', 'Eagle', 'Hawk', 'Osprey', 'Kestrel', 'Condor', 'Raven', 'Heron',
  'Ibis', 'Puffin', 'Swallow', 'Sparrow', 'Magpie', 'Albatross',
  // paws and hooves
  'Panther', 'Leopard', 'Cheetah', 'Lynx', 'Ocelot', 'Cougar', 'Bobcat',
  'Wolf', 'Fox', 'Otter', 'Badger', 'Marten', 'Ferret', 'Bison', 'Moose',
  'Elk', 'Stag', 'Ibex', 'Gazelle', 'Antelope', 'Zebra', 'Rhino', 'Tapir',
  'Lemur', 'Panda', 'Wombat', 'Meerkat', 'Mongoose', 'Dingo',
  // scales
  'Gecko', 'Iguana', 'Cobra', 'Viper', 'Mamba', 'Komodo', 'Dragon',
  // water
  'Dolphin', 'Orca', 'Narwhal', 'Manta', 'Marlin', 'Barracuda', 'Nautilus',
  'Kraken', 'Walrus',
  // sky at night
  'Comet', 'Meteor', 'Nebula', 'Quasar', 'Pulsar', 'Nova', 'Orbit',
  'Eclipse', 'Galaxy', 'Aurora', 'Zenith', 'Horizon', 'Apogee', 'Vector',
  'Beacon',
  // weather and ground
  'Storm', 'Cyclone', 'Monsoon', 'Typhoon', 'Blizzard', 'Avalanche',
  'Glacier', 'Canyon', 'Summit', 'Ridge', 'Mesa', 'Dune', 'Delta', 'Fjord',
  'Geyser', 'Volcano', 'Ember', 'Cinder', 'Thunder', 'Lightning', 'Tempest',
  'Zephyr', 'Gale', 'Frost',
  // things that move, and things that point
  'Piston', 'Turbine', 'Rotor', 'Axle', 'Gearbox', 'Clutch', 'Circuit',
  'Engine', 'Motor', 'Rocket', 'Throttle', 'Chicane', 'Slipstream',
  'Dynamo', 'Voltage', 'Spark', 'Anchor', 'Rudder', 'Lantern',
  'Prism', 'Quartz',
] as const;

/**
 * A tripwire, not a filter. Nothing in the lists above comes close to these,
 * which is exactly the point: the check exists so that a word added later —
 * or a pair whose two halves only spell something together, with the space
 * removed — fails the sanity run instead of reaching a leaderboard. Free text
 * typed by a person is a different path entirely; see `names.ts` for what is
 * enforced there, and the moderation list for what a filter cannot decide.
 */
const BANNED = [
  'anal', 'anus', 'arse', 'ass', 'bitch', 'boob', 'butt', 'clit', 'cock',
  'crap', 'cunt', 'dick', 'fag', 'fuck', 'homo', 'jizz', 'nigg', 'penis',
  'piss', 'poop', 'porn', 'pube', 'puss', 'queer', 'rape', 'shit', 'slut',
  'suck', 'tits', 'turd', 'twat', 'wank', 'whore',
];

/**
 * True when a generated name is fit to publish: clean with the space removed
 * as well as with it, short enough for the arena, and valid by the same rules
 * a typed name has to pass.
 */
export function isCleanName(name: string): boolean {
  const flat = name.toLowerCase().replace(/[^a-z]/g, '');
  if (BANNED.some((bad) => flat.includes(bad))) return false;
  return name.length <= NAME_MAX && isNameOk(name);
}

/**
 * A fresh "Adjective Noun", avoiding any name in `avoid` — pass the names
 * already on screen and the grid comes out without two identical cars.
 *
 * `rng` is injectable so a test can replay the same draw.
 */
export function randomModelName(rng: () => number = Math.random, avoid: Iterable<string> = []): string {
  const taken = new Set([...avoid].map((n) => n.trim().toLowerCase()));
  const pick = <T>(xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];

  for (let i = 0; i < 60; i++) {
    const name = `${pick(NAME_ADJECTIVES)} ${pick(NAME_NOUNS)}`;
    if (!taken.has(name.toLowerCase()) && isCleanName(name)) return name;
  }

  // Thousands of pairs against at most a handful of taken names, so the loop
  // above effectively always returns. Should the draw be that unlucky, walk
  // the product in order rather than hand back a name that was ruled out.
  for (const adjective of NAME_ADJECTIVES)
    for (const noun of NAME_NOUNS) {
      const name = `${adjective} ${noun}`;
      if (!taken.has(name.toLowerCase()) && isCleanName(name)) return name;
    }
  return `${NAME_ADJECTIVES[0]} ${NAME_NOUNS[0]}`;
}
