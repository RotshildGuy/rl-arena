import type * as He from '../he/account';

export const account: typeof He.account = {
  signedInAs: (email) => `Signed in${email ? ` as ${email}` : ''}`,
  anonymousTitle: 'Your account is anonymous and lives in this browser only. You can link it to Google or an email - or sign in to an account you already have',
  mine: 'My account',
  save: 'Save account',
  linkedToast: 'Account linked - you can sign in with it on any device',
  needEmail: 'Type an email address.',
  shortPassword: (n) => `The password is too short - at least ${n} characters.`,
  needPassword: 'Type a password.',
  linkedTitle: 'Account linked',
  anonymousHeading: 'Your account is anonymous',
  connectedAs: (email) => (
    <>
      Signed in as <b className="mono">{email}</b>.
    </>
  ),
  linked: 'The account is linked.',
  anyDevice: 'You can sign in with it on any device and find the same models, the same cars and the same points.',
  ways: 'Sign-in methods:',
  anonymousBody: (
    <>
      Your identity was created automatically and lives <b>in this browser only</b>. Everything works as usual
      with it, but if you clear the site's data, switch devices or open a private window, there is no way back
      to it, and your cars and points in the championship stay behind.
    </>
  ),
  linkBody: (
    <>
      Linking an account <b>moves nothing and starts nothing over</b>: the same id, the same models, the same
      cars on the grid and the same points - just with a way back. You can also carry on without linking, and
      nothing changes.
    </>
  ),
  linking: 'Linking…',
  linkGoogle: 'Link a Google account',
  or: 'or',
  email: 'Email',
  newPassword: 'New password',
  password: 'Password',
  linkEmail: 'Link email and password',
  haveAccount: 'I already have an account',
  switchWarning: (
    <>
      Signing in to an existing account <b>replaces</b> the identity in this browser now - it doesn't merge
      with it. Its cars on the grid and the points it earned stay with it, and there is no way back to it. The
      models saved in this browser come with you.
    </>
  ),
  signingIn: 'Signing in…',
  signInGoogle: 'Sign in with Google',
  signIn: 'Sign in',
  cancel: 'Cancel',
  otherDevice:
    'Linked an account on another device? This browser goes into the identity it already has, so to reach your account you need to sign in to it here explicitly.',
  signInExisting: 'Sign in to an existing account',
  conflict: (
    <>
      You can sign in to the existing account instead - but <b>the current anonymous identity stays behind</b>:
      its cars on the grid and the points it earned stay with it, and there is no way back to it. The models
      saved in this browser come with you.
    </>
  ),
  takeOver: 'Sign in to the existing account',
  leave: 'Sign out',
  leaveLinked: 'You can sign back in any time with the same account.',
  leaveAnonymous:
    "An anonymous identity has no way back. After signing out you can't return to it, and its cars and points in the championship stay with it. The models saved in this browser stay here.",
  leaving: 'Signing out…',
  confirmLeave: 'Yes, sign out',
  signOut: 'Sign out',
};
