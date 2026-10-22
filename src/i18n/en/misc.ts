import type * as He from '../he/misc';

export const format: typeof He.format = {
  days: (n) => `${n}d`,
  hours: (n) => `${n}h`,
  minutes: (n) => `${n}m`,
  daysClock: (days, clock) => `${days}d ${clock}`,
  today: 'today',
  tomorrow: 'tomorrow',
  onDate: (date) => `on ${date}`,
  at: (which, time) => `${which} at ${time}`,
  durationHours: (h, m) => `${h}h ${m}m`,
  durationMinutes: (clock) => `${clock} min`,
  durationSeconds: (s) => `${s}s`,
  kmh: (n) => `${n} km/h`,
};

export const calendar: typeof He.calendar = {
  title: 'RL Arena - the daily race',
  details: 'A Grand Prix of trained models, live. Qualifying is done and the grid is locked.',
};

export const misc: typeof He.misc = {
  on: 'On',
  off: 'Off',
  close: 'Close',
  loading: 'Loading',
  start: 'Start',
  secondsToStart: (n) => `${n} seconds to the start`,
  weightsTimeout: 'The request for the weights went unanswered',
  coachClose: 'Close the tip',
  coachSkip: 'Skip the guide',
  retired: 'Out',
  leader: 'Leader',
  myGarage: 'My garage',
  unnamedModel: 'Unnamed model',
  unnamed: 'Unnamed',
  raceFailed: 'Running the race failed',
  raceTooSlow: 'Running the race took too long',
  runningQuali: (round) => `Running qualifying for round ${round}…`,
  runningRace: (name) => `Running the ${name}…`,
};

export const estimate: typeof He.estimate = {
  trainRate: 'training steps per second',
  envRate: 'environment steps per second',
  underMinute: 'Under a minute and a half',
  minutes: (n) => `About ${n} minutes`,
  hours: (n) => `About ${n} hours`,
};

export const share: typeof He.share = {
  track: (name) => `${name} circuit`,
  points: (n) => (n === 1 ? '1 point' : `${n} points`),
  gained: (up, n) => `${up ? 'Gained' : 'Lost'} ${n === 1 ? 'one place' : `${n} places`}`,
  lap: (time) => `Lap ${time}`,
  tagline: 'A model trained with reinforcement learning drove this on its own',
  text: (driver, dnf, position, race) => `${driver} ${dnf ? 'retired' : `finished P${position}`} in the ${race} · RL Arena`,
};

export const entry: typeof He.entry = {
  noTeam: 'Set a competitor name before entering the championship',
  racingOnly: 'The championship is a car race only',
  teamIssue: (issue) => `Competitor name - ${issue}`,
  driverIssue: (issue) => `Model name - ${issue}`,
  noWeights: "Couldn't load the model's weights",
  teamFull: (n) => `Each team may have ${n} cars on track. Remove one to enter another in its place`,
  drift: {
    name: 'Old name on track',
    weights: 'Old version on track',
    both: 'Old name and version on track',
  },
};

export const modelFile: typeof He.modelFile = {
  cannotLoad: "Couldn't load the model",
  notModel: 'The file is not a model file',
  notOurs: 'The file is not an RL Arena model file',
  newer: 'The file was made by a newer version of the site',
  noModel: 'The file holds no model',
  missingDetails: "The model's details are missing from the file",
  unknownGame: (id) => `The model belongs to a game this site doesn't have (${id})`,
  badArch: 'The architecture in the file is not valid',
  badObs: "The model was trained on an observation layout that doesn't match this version",
  noWeights: 'The weights are missing from the file',
  unreadable: "Couldn't read the weights from the file",
  sizeMismatch: (actual, expected) => `The weights don't match the architecture (${actual} instead of ${expected})`,
  badJson: 'The file is not valid JSON',
};

export const authErrors: typeof He.authErrors = {
  password: 'Email and password',
  invalidEmail: 'That email address is not valid.',
  missingPassword: 'Type a password.',
  weakPassword: 'The password is too short - at least 6 characters.',
  emailInUse: 'There is already an account with this email. Sign in to it instead of signing up.',
  wrongCredentials: 'The email or password is wrong.',
  disabled: 'This account is blocked.',
  tooMany: 'Too many attempts from this device. Try again in a few minutes.',
  cancelled: 'Sign-in was cancelled.',
  popupBlocked: 'The browser blocked the sign-in window. Allow pop-ups for the site, or sign in with email and password.',
  credentialInUse: 'That account already belongs to another user here.',
  alreadyLinked: 'The account is already linked.',
  recentLogin: 'For security, sign in again before doing this.',
  network: 'No network connection right now.',
  apiKey: 'The Firebase API key is not valid. Check the values in .env.local.',
  notConfigured: 'Authentication is not enabled in the project. Firebase Console → Authentication → Get started.',
  notConfiguredOpen: 'Authentication is not enabled in the project. Open Firebase Console → Authentication → Get started.',
  methodOff: 'This sign-in method is off in the project. Firebase Console → Authentication → Sign-in method.',
  domain: 'This domain is not authorized. Firebase Console → Authentication → Settings → Authorized domains.',
  noGoogle: "This browser doesn't support signing in with Google. Try email and password.",
  noUser: 'No account signed in',
  noUserLocal: 'No account signed in - models are saved in this browser only.',
  rules: 'The Firestore security rules block access. Deploy firestore.rules from the repo.',
  noDb: 'The Firestore database has not been created yet. Firebase Console → Firestore Database → Create database.',
  offline: 'No connection to Firestore right now.',
  leagueMissing: 'League not found',
  nameTaken: 'That name is already taken by another competitor. Pick another one.',
};

export const feedbackCore: typeof He.feedbackCore = {
  kind: { bug: 'Bug', idea: 'Idea', other: 'Other' },
  status: { new: 'Received', seen: 'Read', done: 'Handled' },
  tooShort: (n) => `Write at least ${n} characters - what happened, or what you would like`,
  tooLong: (n) => `Up to ${n} characters`,
  contactTooLong: 'The contact details are too long',
};
