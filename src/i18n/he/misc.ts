/** Strings of the helpers under `ui/` that are not screens: formats, errors, small components. */
export const format = {
  days: (n: number) => `${n} ימ׳`,
  hours: (n: number) => `${n} שע׳`,
  minutes: (n: number) => `${n} דק׳`,
  daysClock: (days: number, clock: string) => `${days} ימים ${clock}`,
  today: 'היום',
  tomorrow: 'מחר',
  onDate: (date: string) => `ב-${date}`,
  at: (which: string, time: string) => `${which} ב-${time}`,
  durationHours: (h: number, m: number) => `${h} שע׳ ${m} דק׳`,
  durationMinutes: (clock: string) => `${clock} דק׳`,
  durationSeconds: (s: number) => `${s} שנ׳`,
  kmh: (n: number) => `${n} קמ״ש`,
};

export const calendar = {
  title: 'RL Arena - המרוץ היומי',
  details: 'גרנד פרי של מודלים מאומנים, בשידור חי. המוקדמות כבר נערכו והגריד נעול.',
};

export const misc = {
  on: 'מופעל',
  off: 'כבוי',
  close: 'סגירה',
  loading: 'טוען',
  start: 'זינוק',
  secondsToStart: (n: number) => `${n} שניות לזינוק`,
  weightsTimeout: 'הבקשה למשקולות לא נענתה',
  coachSkip: 'דלגו על ההדרכה',
  retired: 'פרש',
  leader: 'מוביל',
  myGarage: 'המוסך שלי',
  unnamedModel: 'מודל ללא שם',
  unnamed: 'ללא שם',
  raceFailed: 'חישוב המרוץ נכשל',
  raceTooSlow: 'חישוב המרוץ לקח יותר מדי זמן',
  runningQuali: (round: number) => `מריץ מוקדמות לסבב ${round}…`,
  runningRace: (name: string) => `מריץ את ${name}…`,
};

export const estimate = {
  trainRate: 'צעדי אימון לשנייה',
  envRate: 'צעדי סביבה לשנייה',
  underMinute: 'פחות מדקה וחצי',
  minutes: (n: number) => `בערך ${n} דקות`,
  hours: (n: string) => `בערך ${n} שעות`,
};

export const share = {
  track: (name: string) => `מסלול ${name}`,
  points: (n: number) => `${n} נקודות`,
  gained: (up: boolean, n: number) => `${up ? 'עלה' : 'ירד'} ${n === 1 ? 'מקום אחד' : `${n} מקומות`}`,
  lap: (time: string) => `הקפה ${time}`,
  tagline: 'מודל שאומן בלמידת חיזוק נהג את זה לבד',
  text: (driver: string, dnf: boolean, position: number, race: string) =>
    `${driver} סיים ${dnf ? 'בפרישה' : `במקום ${position}`} ב${race} · RL Arena`,
};

export const entry = {
  noTeam: 'צריך להגדיר שם מתחרה לפני רישום לאליפות',
  racingOnly: 'האליפות מתקיימת במרוץ מכוניות בלבד',
  teamIssue: (issue: string) => `שם המתחרה - ${issue}`,
  driverIssue: (issue: string) => `שם המודל - ${issue}`,
  noWeights: 'לא הצלחתי לטעון את המשקולות של המודל',
  teamFull: (n: number) => `לכל קבוצה מותרים ${n} רכבים על המסלול. הסירו רכב קיים כדי לרשום אחר במקומו`,
  drift: {
    name: 'שם ישן על המסלול',
    weights: 'גרסה ישנה על המסלול',
    both: 'שם וגרסה ישנים על המסלול',
  },
};

export const modelFile = {
  cannotLoad: 'לא הצלחתי לטעון את המודל',
  notModel: 'הקובץ אינו קובץ מודל',
  notOurs: 'הקובץ אינו קובץ מודל של RL Arena',
  newer: 'הקובץ נוצר בגרסה חדשה יותר של האתר',
  noModel: 'הקובץ אינו מכיל מודל',
  missingDetails: 'פרטי המודל חסרים בקובץ',
  unknownGame: (id: string) => `המודל שייך למשחק שאינו קיים באתר (${id})`,
  badArch: 'הארכיטקטורה בקובץ אינה תקינה',
  badObs: 'המודל אומן על פריסת תצפית שאינה תואמת לגרסה הנוכחית',
  noWeights: 'המשקולות חסרות בקובץ',
  unreadable: 'לא הצלחתי לקרוא את המשקולות מהקובץ',
  sizeMismatch: (actual: number, expected: number) => `המשקולות אינן תואמות לארכיטקטורה (${actual} במקום ${expected})`,
  badJson: 'הקובץ אינו JSON תקין',
};

export const authErrors = {
  password: 'מייל וסיסמה',
  invalidEmail: 'כתובת המייל אינה תקינה.',
  missingPassword: 'צריך להקליד סיסמה.',
  weakPassword: 'הסיסמה קצרה מדי - לפחות 6 תווים.',
  emailInUse: 'כבר יש חשבון עם המייל הזה. התחברו אליו במקום להירשם.',
  wrongCredentials: 'המייל או הסיסמה אינם נכונים.',
  disabled: 'החשבון הזה חסום.',
  tooMany: 'יותר מדי ניסיונות מהמכשיר הזה. נסו שוב בעוד כמה דקות.',
  cancelled: 'ההתחברות בוטלה.',
  popupBlocked: 'הדפדפן חסם את חלון ההתחברות. אפשרו חלונות קופצים לאתר, או התחברו עם מייל וסיסמה.',
  credentialInUse: 'החשבון הזה כבר שייך למשתמש אחר כאן.',
  alreadyLinked: 'החשבון כבר מקושר.',
  recentLogin: 'מטעמי אבטחה צריך להתחבר מחדש לפני הפעולה הזאת.',
  network: 'אין חיבור לרשת כרגע.',
  apiKey: 'מפתח ה-API של Firebase אינו תקין. בדקו את הערכים ב-.env.local.',
  notConfigured: 'Authentication לא הופעל בפרויקט. Firebase Console ← Authentication ← Get started.',
  notConfiguredOpen: 'Authentication לא הופעל בפרויקט. פתח את Firebase Console ← Authentication ← Get started.',
  methodOff: 'שיטת ההתחברות הזאת כבויה בפרויקט. Firebase Console ← Authentication ← Sign-in method.',
  domain: 'הדומיין הזה לא מורשה. Firebase Console ← Authentication ← Settings ← Authorized domains.',
  noGoogle: 'הדפדפן הזה לא תומך בהתחברות עם Google. נסו מייל וסיסמה.',
  noUser: 'אין חשבון מחובר',
  noUserLocal: 'אין חשבון מחובר - המודלים נשמרים בדפדפן הזה בלבד.',
  rules: 'כללי האבטחה של Firestore חוסמים את הגישה. פרוס את firestore.rules שבריפו.',
  noDb: 'מסד הנתונים של Firestore עוד לא נוצר. Firebase Console ← Firestore Database ← Create database.',
  offline: 'אין חיבור ל-Firestore כרגע.',
  leagueMissing: 'הליגה לא נמצאה',
  nameTaken: 'השם הזה כבר תפוס על ידי מתחרה אחר. בחרו שם אחר.',
};

export const feedbackCore = {
  kind: { bug: 'באג', idea: 'הצעה לשיפור', other: 'אחר' },
  status: { new: 'התקבלה', seen: 'נקראה', done: 'טופלה' },
  tooShort: (n: number) => `כתבו לפחות ${n} תווים - מה קרה, או מה הייתם רוצים`,
  tooLong: (n: number) => `עד ${n} תווים`,
  contactTooLong: 'פרטי הקשר ארוכים מדי',
};
