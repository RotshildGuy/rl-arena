import * as account from './he/account';
import * as app from './he/app';
import * as broadcast from './he/broadcast';
import * as championship from './he/championship';
import * as components from './he/components';
import * as core from './he/core';
import * as dashboard from './he/dashboard';
import * as feedback from './he/feedback';
import * as garage from './he/garage';
import * as info from './he/info';
import * as misc from './he/misc';
import * as play from './he/play';
import * as report from './he/report';
import * as shop from './he/shop';
import * as signin from './he/signin';
import * as standings from './he/standings';
import * as trainSetup from './he/trainSetup';

/** The reference dictionary: Hebrew, the language the app was written in. One file per area. */
export const he = {
  ...account,
  ...app,
  ...broadcast,
  ...championship,
  ...components,
  ...core,
  ...dashboard,
  ...feedback,
  ...garage,
  ...info,
  ...misc,
  ...play,
  ...report,
  ...shop,
  ...signin,
  ...standings,
  ...trainSetup,
};
