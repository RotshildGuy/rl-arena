import type * as He from '../he/core';

export const tracks: typeof He.tracks = {
  oval: 'Oval',
  kidney: 'Kidney',
  technical: 'Technical',
  speedway: 'Speedway',
  stadium: 'Stadium',
  triangle: 'Triangle',
  serpent: 'Serpent',
  clover: 'Clover',
  coast: 'Coast',
  ring: 'Ring',
};

export const champ: typeof He.champ = {
  grandPrix: (track) => `${track} Grand Prix`,
  semiFinal: 'Semi-final',
  quarterFinal: 'Quarter-final',
  heats: 'Heat',
  final: 'Final',
  race: 'Race',
  minutes: (n) => `${n} minutes`,
  hour: 'an hour',
  hours: (n) => `${n} hours`,
  houseTeam: 'House Team',
  house: { 'house-1': 'Rookie', 'house-2': 'Learner', 'house-3': 'Steady', 'house-4': 'Reckless' },
};

export const names: typeof He.names = {
  tooShort: (n) => `The name needs at least ${n} characters`,
  tooLong: (n) => `The name is limited to ${n} characters`,
  invisible: 'The name has invisible characters, which are not allowed',
  link: "A name can't include a link or an address",
  repeated: "The name can't be one character repeated",
  noLetter: 'The name needs at least one letter or digit',
  house: 'That name is reserved for the house team',
};

export const shopItems: typeof He.shopItems = {
  'color-scarlet': 'Scarlet',
  'color-crimson': 'Crimson',
  'color-orange': 'Racing orange',
  'color-sky': 'Sky blue',
  'color-navy': 'Night blue',
  'color-teal': 'Teal',
  'color-pink': 'Pink',
  'color-silver': 'Silver',
  'color-graphite': 'Graphite',
  'color-white': 'White',
  'second-white': 'White',
  'second-black': 'Black',
  'second-scarlet': 'Scarlet',
  'second-orange': 'Orange',
  'second-sky': 'Sky blue',
  'second-navy': 'Night blue',
  'second-teal': 'Teal',
  'second-pink': 'Pink',
  'second-silver': 'Silver',
  'pattern-stripe': 'Centre stripe',
  'pattern-twotone': 'Two-tone',
  'pattern-solid': 'Plain',
  number: 'Number of your choice',
  'helmet-gold': 'Gold helmet',
  'helmet-black': 'Black helmet',
  'helmet-red': 'Red helmet',
  'smoke-blue': 'Blue drift smoke',
  'smoke-red': 'Red drift smoke',
  'smoke-white': 'Thick white smoke',
};

export const coins: typeof He.coins = {
  points: (n) => `Race points (${n})`,
  starts: (n) => `Taking part (${n} starts)`,
  season: (season, position) => `Season ${season} finished P${position}`,
  firstFinish: 'First race to the flag',
  firstPodium: 'First podium',
  firstWin: 'First win',
  clean: 'A whole race without touching the wall',
  tenRaces: 'Ten races',
};

export const diagnose: typeof He.diagnose = {
  unreadyFinding: (laps, of) => `Completed ${laps} of ${of} laps`,
  unreadyAction: "The model isn't ready for a full race. Give it more training, until in training it completes every lap in a row.",
  wallsFinding: (hits, laps) => `${hits} wall hits in ${laps} laps, more than most of the field`,
  wallsAction: (slider) => `Move "${slider}" to the right - a harsher wall penalty teaches it to brake before the corner.`,
  speedFinding: (top, avg) => `Top speed ${top} km/h, against the rest's average of ${avg} km/h`,
  speedAction: (slider) => `Move "${slider}" to the right - it drives too slowly on the straights.`,
  contactFinding: (hits, lost) => `${hits} contacts with cars, and ${lost === 1 ? 'one place lost' : `${lost} places lost`} from the start`,
  contactAction: (slider) => `Move "${slider}" to the left - the contact is costing it places.`,
  noCleanLap: "Didn't complete a clean lap",
  onPace: 'Lap pace among the fastest in the race',
  offPace: (pct) => `Its fastest lap is ${pct}% slower than the race's fastest`,
  paceLostAtStart: 'The pace is there; the place went at the start or in traffic. Train with more cars on track so it learns to overtake.',
  paceQuali: 'The pace is there and no place was lost. Winning starts in qualifying: a faster lap there means starting further up.',
  slow: "It's clean but slow. Keep training it on this circuit - training time is what's missing here.",
};

export const racing: typeof He.racing = {
  name: 'Car racing',
  scoreLabel: 'laps',
  actions: [
    'Gas + left', 'Gas', 'Gas + right',
    'Coast + left', 'Coast', 'Coast + right',
    'Brake + left', 'Brake', 'Brake + right',
  ],
  channels: {
    checkpoint: {
      label: 'Progress along the track',
      hint: 'For every gate crossed in the right direction - this is what teaches it where to go',
      lowLabel: 'Wanderer',
      highLabel: 'Locked on the track',
    },
    lap: { label: 'Completing a lap', hint: 'A bonus for every full lap', lowLabel: "Doesn't count laps", highLabel: 'Lives for the lap' },
    finish: {
      label: 'Finishing the race',
      hint: 'A one-time bonus for completing every lap',
      lowLabel: 'Just drive',
      highLabel: 'Must cross the line',
    },
    speed: { label: 'Speed', hint: 'An ongoing reward for forward speed', lowLabel: 'Relaxed', highLabel: 'Speed addict' },
    wallHit: {
      label: 'Staying off the barrier',
      hint: 'How much of a penalty for each touch of the barrier (at the moment of contact, not for the whole scrape)',
      lowLabel: 'Reckless',
      highLabel: 'Careful',
    },
    carHit: {
      label: 'Contact with a rival car',
      hint: 'From notch 8 up, contact earns points - the model will learn to push instead of avoiding',
      lowLabel: 'Gentleman',
      highLabel: 'Aggressive',
    },
    reverse: {
      label: 'Driving the right way',
      hint: 'How much of a penalty for each step the car moves against the track direction',
      lowLabel: 'Direction is a matter of opinion',
      highLabel: 'Forward only',
    },
    idle: {
      label: "Don't stand still",
      hint: 'How much of a penalty for each step the car nearly stops',
      lowLabel: 'Patient',
      highLabel: 'Must move',
    },
    timeStep: {
      label: 'Time pressure',
      hint: 'A small penalty every step, no conditions - pushes it to finish fast',
      lowLabel: "There's time",
      highLabel: 'Chasing the clock',
    },
    overtake: { label: 'Overtaking', hint: 'A bonus for every car passed', lowLabel: 'Stays in line', highLabel: 'Passes at every chance' },
  },
  presets: {
    careful: { label: 'Careful', hint: "Brakes early, doesn't touch the wall or rivals. Slower, but almost always finishes" },
    balanced: { label: 'Balanced', hint: 'The default - the balance known to teach a decent driver' },
    aggressive: { label: 'Aggressive', hint: "Fast, overtakes and isn't afraid of contact. Quicker when it works, and ends in the wall when it doesn't" },
  },
  blurb: 'A 2D race on four maps. The car "sees" through nine distance sensors and chooses gas, brake and steering.',
  options: {
    trackId: { label: 'Map' },
    nCars: { label: 'Number of cars', hint: 'The cars are split between the models in training. More cars - more traffic to deal with' },
    laps: { label: 'Laps' },
    carCollisions: { label: 'Contact between cars', hint: 'When off, cars pass through each other' },
  },
  cars: (n) => `${n} cars`,
  laps: (n) => `${n} laps`,
  contact: 'with contact',
  noContact: 'no contact',
  controlsHint: 'Arrows or WASD · ↑ gas · ↓ brake',
  touchHint: 'Hold gas or brake on the left · steer on the right',
  matchNoun: 'race',
  seatHint: 'You drive the first car',
  gas: 'Gas',
  brake: 'Brake',
  left: 'Left',
  right: 'Right',
};

export const algorithms: typeof He.algorithms = {
  dqn: {
    name: 'Learns as it drives',
    technical: 'DQN',
    blurb:
      'One car that corrects itself after every mistake, step by step. Learns fast from little experience, but every step takes heavy computing - better on a computer.',
    episodeLabel: 'attempt',
    episodesLabel: 'Attempts',
    exploreLabel: 'Curiosity',
  },
  ga: {
    name: 'Generation by generation',
    technical: 'Genetic algorithm',
    blurb:
      'A whole group of drivers competes; the best survive and make mutated versions of themselves. Needs many more drives, but each one is cheap - recommended on a phone.',
    episodeLabel: 'attempt',
    episodesLabel: 'Attempts',
    exploreLabel: 'Mutation strength',
  },
  gaNote: (current, total) => `Heat ${current}/${total} of the generation`,
  dqnNote: (steps) => `Step ${steps} of the attempt`,
};
