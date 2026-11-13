import type * as He from '../he/components';

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
  suggest: 'Suggest',
  suggestTitle: 'Suggest a free team name',
  saving: 'Saving…',
  save: 'Save',
  cancel: 'Cancel',
};

export const slidersSheet: typeof He.slidersSheet = {
  title: 'Driving style',
  show: 'Sliders',
  hide: 'Hide sliders',
};
