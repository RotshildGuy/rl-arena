import type * as He from '../he/info';

export const info: typeof He.info = {
  tabs: { how: 'How it works', terms: 'Terms of use', privacy: 'Privacy', notices: 'Account and data' },
  eyebrow: 'Info',
  title: 'All about the championship',
  back: 'Back',
  howTo: (f) => (
    <>
      <h2>In short</h2>
      <p>
        You don't drive - you build whoever drives. Train a reinforcement-learning model in the browser, enter it
        in the championship, and once a day every entered model races the others in a Grand Prix.
      </p>

      <h3>1 · Train a model</h3>
      <p>
        On the <b>Garage</b> screen tap "Train a new model". Give it a name - that will be the driver's name -
        and a competitor name, which is your team's name. Choose how it learns and on which track, and set ten
        <b> character sliders</b> - how careful, how aggressive, how hurried. Each slider is a simple scale from 1
        to 10, with no weights and no technical settings. This is the most important decision, and it decides
        what kind of driver you end up with.
      </p>
      <p>
        It matters to understand what really happens there: <b>the model isn't trying to drive well - it is
        trying to collect points.</b> If the penalty for hitting the wall is too low, it will find out that it
        pays to lean on the barrier and push along the whole track. It will pass gates, it will score, and it
        will be dreadfully slow. When the model behaves strangely it isn't wrong - it did exactly what you
        asked. The full explanation is behind the "About training" button in the garage.
      </p>
      <p>
        <b>Tyres have a limit.</b> A car that enters a corner too fast loses grip and slides wide - a drift. Full
        throttle during a slide only makes it bigger, and in the end it finishes in the wall: a hard crash stops
        the car almost completely, and the engine cuts out for a quarter of a second. Whoever keeps their foot
        down through the whole corner loses to a driver who knows where to brake - and that is exactly what the
        model has to learn. Braking before the corner, or lifting off the throttle in the middle of a slide,
        brings the grip back.
      </p>
      <p>
        You can train <b>several models together on the same track</b> - each with its own network and sliders,
        and they get in each other's way just like in a race. That's how you find out whether a model is really
        fast or only fast on an empty road.
      </p>
      <p className="muted">
        Tip: "Turbo" mode turns off the drawing and trains much faster. Give it a few minutes and watch the lap
        time drop.
      </p>

      <h3>2 · Enter the championship</h3>
      <p>
        In the garage, next to each model, there is "Enter in championship". <b>Saving a model doesn't put it in
        the tournament</b> - you have to enter it explicitly, because entering copies the model to a place
        everyone can see.
      </p>
      <ul>
        <li>
          <b>Entries close {f.lockLead} before the lights go out.</b> Whoever enters after that races in the next
          round. An update to a car that is already entered takes effect right up to the start itself.
        </li>
        <li>
          More training does <b>not</b> update by itself. There is an "Update car" button, and the garage marks
          "Old version on track" when there is a difference.
        </li>
        <li>An update keeps the same driver and the same points - a team that brings an upgrade doesn't get a new driver.</li>
        <li>
          Each team has <b>{f.maxCars} cars</b> on track. When they are taken, entering another model asks which
          car comes off in its place - the one that comes off loses its place in the next rounds, but the points
          it earned stay in the records and it can be entered again.
        </li>
        <li>A race needs at least {f.minEntries} entered models to be held.</li>
      </ul>

      <h3>3 · Race day</h3>
      <ul>
        <li>
          <b>Qualifying:</b> each model runs alone on an empty track. The fastest lap sets the grid position.
        </li>
        <li>
          <b>Race:</b> {f.raceLaps} laps. Up to {f.gridSize} models start together; beyond that the day splits
          into heats and the leaders go through to the final.
        </li>
        <li>
          <b>Broadcast:</b> at normal speed only, with no fast-forward. Everyone sees the same moment at the same
          time - so it's worth being there.
        </li>
        <li>
          <b>Results:</b> revealed when the broadcast ends, not before.
        </li>
      </ul>

      <h3>4 · Scoring</h3>
      <p className="mono" style={{ direction: 'ltr', textAlign: 'start' }}>
        {f.points}
      </p>
      <ul>
        <li>Points for the top ten, and {f.fastLapBonus} more for the fastest lap - only if that driver finished in the top ten.</li>
        <li>
          A car that didn't complete at least {f.classifyPct}% of the winner's distance is not classified and
          scores no points (NC).
        </li>
        <li>Ties on points are broken by the number of wins, and if still tied - by second places, and so on.</li>
        <li>The drivers' points of each team add up together in the teams' table.</li>
        <li>
          Every season the tables start from zero. Only the points reset: your models are kept, and a car entered
          in the championship keeps racing in the new season.
        </li>
      </ul>

      <h3>5 · Play yourself</h3>
      <p>
        In the <b>Play</b> tab you can drive against your own models or against the cars racing in the
        championship. It's a practice ground - results there don't go into any table.
      </p>
    </>
  ),
  terms: (nameMax) => (
    <>
      <h2>Terms of use</h2>
      <p className="muted">Last updated: October 2026</p>

      <h3>What this is</h3>
      <p>
        This is a hobby project, not for profit and free of charge. It is provided <b>AS IS</b>, with no warranty
        of any kind - not of availability, not of correctness, and not of fitness for any purpose. You use it at
        your own risk.
      </p>

      <h3>No commitment to continuity</h3>
      <ul>
        <li>The service may be closed, stopped or changed at any moment, without notice.</li>
        <li>A season may be reset and the rules may change. A user can't change a recorded result, but the site operator can reset a whole season.</li>
        <li>
          <b>No backup is guaranteed.</b> A model you don't want to lose - export it to a file from the garage.
          That is the only backup that survives even the service itself closing.
        </li>
      </ul>

      <h3>What is not allowed</h3>
      <ul>
        <li>
          Offensive, threatening, racist or sexual names - neither as a model name nor as a competitor name. These
          names are shown to every user. Saw one? Report it on the contact screen.
        </li>
        <li>Impersonating another person, team or organisation.</li>
        <li>Names that infringe a trademark, copyright or someone else's privacy.</li>
        <li>Trying to disrupt the service, overload it, or get around the championship's rules.</li>
        <li>Uploading content you are not allowed to upload.</li>
      </ul>
      <p>
        Names are limited to {nameMax} characters and can't contain links or invisible characters. We may remove
        any entry, at any time, without notice and at our discretion.
      </p>

      <h3>Content you enter</h3>
      <p>
        You are responsible for the names and models you upload, and you declare that you have the right to
        upload them. By uploading you give permission to show them on the site, run them in races and keep them
        as part of the championship's history.
      </p>

      <h3>History is permanent</h3>
      <p>
        Results of races that have already been held <b>cannot be changed</b>, including the model name and team
        name that appeared in them. They remain even after you delete your data. If that bothers you - don't use
        your real name.
      </p>

      <h3>Account</h3>
      <ul>
        <li>
          You can sign in with Google, with email and password, or with no account at all. You are responsible
          for keeping your sign-in details safe; don't share a password with others.
        </li>
        <li>
          <b>Coming in without an account is an identity of the browser.</b> Clearing the site's data, moving to
          another device or a private window cuts you off from it with no way back - including from the cars and
          points you earned. You can link an account to it at any time from Info - "Account and data", and that
          keeps everything.
        </li>
        <li>We may suspend or remove an account that breaks these terms.</li>
      </ul>

      <h3>Minors</h3>
      <p>The service is not intended for children under 13.</p>

      <h3>Law</h3>
      <p>These terms are governed by the laws of the State of Israel, and the courts of Israel have exclusive jurisdiction.</p>
    </>
  ),
  privacy: (
    <>
      <h2>Privacy policy</h2>
      <p className="muted">Last updated: September 2026</p>

      <p>
        In short: <b>no tracking and no advertising here.</b> The service doesn't ask for a real name or phone
        number and runs no third-party analytics. <b>You can use it without giving any detail</b> - coming in
        without an account is one of the three options on the opening screen, and it works fully.
      </p>

      <h3>How you sign in, and what that stores</h3>
      <ul>
        <li>
          <b>No account.</b> A random id is created (Firebase Anonymous Auth) that lives in this browser only. It
          isn't linked to any identifying detail and we don't know who you are.
        </li>
        <li>
          <b>Email and password.</b> The email address is kept in Firebase Authentication to recognise you the
          next time you sign in and to allow a password reset. The password itself is kept by Google in hashed
          form and is not visible to us. <b>The email doesn't appear anywhere public on the site</b> and nothing is
          sent to it except a password reset you asked for.
        </li>
        <li>
          <b>Google.</b> If you choose to sign in with Google, we receive your email address, display name and
          profile picture if there is one - and use only the address, to recognise you. They don't appear
          anywhere public either.
        </li>
        <li>
          <b>Linking an existing account.</b> Someone who came in without an account can link Google or an email
          to it later. Linking keeps the same id - nothing is moved and nothing starts over - and only adds the
          sign-in details above.
        </li>
      </ul>

      <h3>What is stored</h3>
      <ul>
        <li>
          <b>What you typed:</b> the competitor name and the model name. These are free fields - if you write an
          identifying detail in them, it will be shown to everyone. The competitor name is also kept with the
          account, so you race under the same team from any device.
        </li>
        <li>
          <b>The models you trained</b> and their training history.
        </li>
        <li>
          <b>Race results</b> your models took part in.
        </li>
        <li>
          <b>The shop:</b> the list of items you bought with coins and what is on your car. This is public,
          because every viewer draws your car in their own browser.
        </li>
        <li>
          <b>Friends leagues</b> you created or joined: the league name and the ids of its members. Anyone with
          the invite link can see them.
        </li>
        <li>
          <b>Messages you sent</b> (the contact screen): the text, the kind of message and the name of the screen it
          was sent from. Contact and browser details are kept only if you chose to attach them. Only you and the
          site's operators can read them.
        </li>
        <li>
          <b>Usage counts.</b> At most once a day, for each of five actions - visiting the site, starting
          training, saving a model, entering the championship and watching the broadcast - it is recorded that
          your id did it on that date. No time, no device, no address and no other detail, and in the
          championship's own Firestore, not with a third party. Only the site's operators can read it, and its
          only use is to know how many people come back.
        </li>
      </ul>

      <h3>What is not stored</h3>
      <p className="muted">
        Real name · phone · location · tracking cookies · advertising profile · third-party analytics. An email
        is kept only if you chose to sign in with email or Google, and is never shown to others. The site's fonts
        are served from our own server and not from an outside network, so loading the page reports to no third
        party.
      </p>

      <h3>Where</h3>
      <ul>
        <li>
          <b>In your browser:</b> the competitor name in localStorage and the models in IndexedDB. Deleting them
          is fully in your control, also through the browser's settings. Your theme and language choice are kept
          there too.
        </li>
        <li>
          <b>With the account:</b> a copy of the competitor name, in a private place only you read from, so it
          moves with you between devices. Deleting your data deletes it too.
        </li>
        <li>
          <b>In the cloud:</b> Google Firestore, in the <b>me-west1 (Tel Aviv)</b> region. The sign-in details
          themselves - the id, and the email address if there is one - sit in Firebase Authentication, a separate
          Google service.
        </li>
        <li>
          <b>Hosting:</b> Firebase Hosting. Like any web server, the hosting provider logs requests, including IP
          addresses. These are Google's server logs and not information we collect or access.
        </li>
      </ul>

      <h3>Who sees what</h3>
      <ul>
        <li>
          <b>Models not entered in the championship are entirely private.</b> The security rules lock them to the
          id that created them, and no other user can read them.
        </li>
        <li>
          <b>What you entered in the championship is public.</b> The model name, team name and results are
          visible to anyone who visits the site.
        </li>
        <li>
          <b>So are the weights themselves.</b> For every viewer's browser to run the race, it has to receive the
          models taking part in it. That means <b>the model you entered can be downloaded by anyone who visits the
          site</b>. It isn't a choice but a direct result of there being no server here running the race for you.
          Whoever would rather keep a model to themselves - simply doesn't enter it in the championship.
        </li>
      </ul>

      <h3>How long</h3>
      <p>
        Until you delete it. There is no automatic deletion. The exception is the race history, which stays for
        good - see "History is permanent" in the terms of use.
      </p>

      <h3>Your rights</h3>
      <p>
        You can delete everything of yours with one tap, in the "Account and data" tab above. Deleting removes all
        your models and all your championship entries, and takes you out of future races. The usage counts are
        not deleted: they hold only the random id and dates, and after deletion that id is no longer linked to
        anything.
      </p>

      <p>For questions and requests - use the feedback form, which is also at the bottom of every page. Only the site's operator sees the messages.</p>
    </>
  ),
  toFeedback: 'To the feedback form',
  deleted: (models, entries) =>
    `Deleted ${models === 1 ? 'one model' : `${models} models`} and ${entries === 1 ? 'one entry' : `${entries} entries`}`,
  deleteFailed: 'Deleting failed - try again',
  disclaimers: (
    <>
      <h2>Disclaimers</h2>
      <p>
        <b>This site has no connection to any real racing series, team, manufacturer or sports organisation</b>,
        and has no sponsorship, partnership or endorsement from any such body. All the names, tracks, teams and
        cars on the site are fictional or were created by users. The competition format and the scoring system
        are common game rules in motorsport.
      </p>

      <h3>Fonts</h3>
      <ul>
        <li>
          <b>Heebo</b> - Copyright 2014 The Heebo Project Authors. Licence:{' '}
          <a href="/fonts/OFL-Heebo.txt">SIL Open Font License 1.1</a>.
        </li>
        <li>
          <b>JetBrains Mono</b> - Copyright 2020 The JetBrains Mono Project Authors. Licence:{' '}
          <a href="/fonts/OFL-JetBrainsMono.txt">SIL Open Font License 1.1</a>.
        </li>
      </ul>

      <h3>Software</h3>
      <ul>
        <li>React and React DOM - MIT licence</li>
        <li>Zustand - MIT licence</li>
        <li>Vite - MIT licence</li>
        <li>Firebase JavaScript SDK - Apache 2.0 licence</li>
      </ul>
      <p className="muted">
        The learning engine, the physics and the neural network were written for this project. No outside
        machine-learning libraries are used.
      </p>
    </>
  ),
  myAccount: 'My account',
  noAccount: 'No account is signed in in this browser.',
  signedVia: 'Signed in',
  via: 'through',
  anyDevice: '. You can sign in with the same account on any device and find the same models and the same points.',
  manage: 'Manage account',
  guest: (
    <>
      You came in without an account. Everything works as usual, but the identity lives <b>in this browser
      only</b>: clearing the site's data or moving to another device cuts you off from it, and from your cars and
      points in the championship. Linking to Google or an email keeps the same id and everything under it.
    </>
  ),
  link: 'Link an account',
  yourId: 'Your id',
  idNote: "This is the id your models are stored under. It holds no personal detail, even when the account is linked.",
  deleteTitle: 'Delete my data',
  deleteBody:
    "Deletes all the models you trained and all your championship entries, in this browser and in the cloud. Results of races already held remain - the championship's history can't be rewritten.",
  needSignIn: 'To delete, you need to be signed in to the account the data belongs to.',
  deleting: 'Deleting…',
  confirmDelete: 'Yes, delete everything for good',
  cancel: 'Cancel',
  deleteAll: 'Delete all my data',
  metrics: 'Metrics (operators only)',
  metricsWindow: (n) => `Last 45 days · ${n} accounts`,
  returned: (day) => `Came back after ${day} ${day === 1 ? 'day' : 'days'}:`,
  ofCohort: (n, of) => `(${n} of ${of})`,
  reachedEntry: 'Visitors who reached a championship entry:',
  funnel: (visit, train, save, enter, watch) =>
    `(visit ${visit} · train ${train} · save ${save} · enter ${enter} · watch ${watch})`,
};
