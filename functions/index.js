/*
 * RL Arena's server functions. Empty for now: the push notifications that
 * lived here were removed (Chrome on Android held them until the phone woke,
 * so they arrived too late to help). Deploying this file as it is
 * (`firebase deploy --only functions`) deletes the notification functions
 * that are still deployed.
 *
 * This is where the race day on the server goes. `race.js` is the server's
 * copy of the race calendar, checked against the app's by `npm run sanity`.
 *
 * Deploy: `cd functions && npm install && cd .. && firebase deploy --only functions`.
 * Scheduled functions need the Blaze (pay-as-you-go) plan.
 */
