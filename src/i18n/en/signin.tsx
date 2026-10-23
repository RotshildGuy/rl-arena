import type * as He from '../he/signin';

export const signin: typeof He.signin = {
  needEmail: 'Type an email address.',
  shortPassword: (n) => `The password is too short - at least ${n} characters.`,
  emailFirst: 'Type your email address first, then tap again.',
  resetSent: 'A password reset email is on its way. Check the spam folder too.',
  headline1: 'One race a day.',
  headline2: 'The models drive, you build them.',
  intro:
    'Train a model in the browser, enter it in the championship, and once a day every entered model races the others. No coding needed - you choose how the car should drive, and it learns on its own.',
  entering: 'Entering…',
  continueNoAccount: 'Continue without an account',
  playNow: '🏁 Play now - no account',
  inherited: (
    <>
      This browser already holds an anonymous identity, and this button carries on <b>with it</b> - with the
      models, cars and points it earned. If you have an account, sign in to it below instead.
    </>
  ),
  noSignup: 'No sign-up and no details. Progress is saved in this browser, and you can connect it to Google or an email whenever you like without losing anything.',
  or: 'or',
  saveProgress: 'Want to keep your progress in an account?',
  signInExisting: 'Sign in to an existing account',
  anyDevice: 'With an account your models and points are there on any device.',
  waiting: 'Your models and points will be waiting exactly where you left them.',
  connecting: 'Signing in…',
  google: 'Continue with Google',
  email: 'Email',
  password: 'Password',
  moment: 'One moment…',
  signIn: 'Sign in',
  createAccount: 'Create account',
  toSignUp: "I don't have an account - sign up",
  toSignIn: 'I already have an account - sign in',
  sending: 'Sending…',
  forgot: 'Forgot password',
  offline:
    "You can also come in without the cloud. Training, the garage and playing all work fully; what won't work is the shared championship, and models are saved in this browser only.",
  continueOffline: 'Continue without the cloud',
};
