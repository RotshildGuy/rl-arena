import type * as He from '../he/components';

export const leagues: typeof He.leagues = {
  title: 'Friends league',
  needsCloud: 'Leagues need the cloud, and the site is running without it right now.',
  createFailed: 'Creating the league failed',
  shareText: (name) => `Join the league "${name}" on RL Arena`,
  copied: 'Invite link copied',
  left: (name) => `You left "${name}"`,
  leaveFailed: 'Leaving failed',
  intro:
    'The same races, a table just for you: a league counts only its members\' cars, with the points they really earned. Anyone with the link can join.',
  members: (n) => (n === 1 ? '1 member' : `${n} members`),
  invite: 'Invite',
  leave: 'Leave',
  newName: 'Name for a new league',
  create: 'Create',
};

export const rewardEditor: typeof He.rewardEditor = {
  title: 'Driving style',
  live: 'Takes effect now',
  reset: 'Reset',
  custom: 'Your own style - tuned by hand on the sliders.',
  advanced: 'Advanced · tune ten sliders by hand',
  explain: 'Each slider asks how much this matters to you: right always means "more of this". There is no one right answer.',
  level: (label, level, of) => `${label}: ${level} of ${of}`,
};

export const welcome: typeof He.welcome = {
  eyebrow: 'Welcome',
  title: 'How it works',
  ok: 'Got it',
};

export const primer: typeof He.primer = {
  eyebrow: 'Before you start',
  title: "The model isn't trying to drive well",
  startTraining: "Got it, let's train",
  ok: 'Got it',
  body1: (
    <>
      The model only tries <b>to collect as many points as it can by the sliders you set.</b> If there is an
      easier way to collect them than driving fast - it will find it.
    </>
  ),
  body2: (
    <>
      The championship measures only <b>time</b>, so set the sliders so that driving fast pays. You can change
      them in the middle of training too.
    </>
  ),
};

export const teamNameForm: typeof He.teamNameForm = {
  label: 'Competitor name - this will be your team name in the table',
  failed: 'Saving the name failed',
  placeholder: 'For example: Blue Lightning',
  saving: 'Saving…',
  save: 'Save',
  cancel: 'Cancel',
};
