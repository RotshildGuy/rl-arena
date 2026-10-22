import type { Dict } from './dict';
import * as account from './en/account';
import * as app from './en/app';
import * as broadcast from './en/broadcast';
import * as championship from './en/championship';
import * as components from './en/components';
import * as core from './en/core';
import * as dashboard from './en/dashboard';
import * as feedback from './en/feedback';
import * as garage from './en/garage';
import * as info from './en/info';
import * as misc from './en/misc';
import * as play from './en/play';
import * as report from './en/report';
import * as shop from './en/shop';
import * as signin from './en/signin';
import * as standings from './en/standings';
import * as trainSetup from './en/trainSetup';

/** English, typed against the Hebrew: a key missing here, or one too many, fails the typecheck. */
export const en: Dict = {
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
