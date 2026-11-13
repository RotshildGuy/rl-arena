import type { CommentKind, RadioKind } from '../../core/champ/commentary';

/** What a commentary line is filled with: names already formatted. */
export interface Line {
  a: string;
  b: string;
  pos: number;
  time: string;
  gap: string;
}

/** The live broadcast and the replay. */
export const broadcast = {
  nothing: 'אין מרוץ להציג.',
  backToChamp: 'חזרה לאליפות',
  backArrow: '→ חזרה לאליפות',
  noReplay: 'למרוץ הזה אין צפייה חוזרת',
  connecting: 'מתחבר לשידור…',
  live: 'חי',
  replay: 'צפייה חוזרת',
  track: 'מסלול',
  car: 'רכב',
  directorCam: 'במאי',
  director: {
    reasons: {
      start: 'הזינוק',
      leader: 'המוביל',
      finish: 'לקראת הדגל',
      incident: 'אירוע על המסלול',
      battle: 'קרב על מקום',
      fastest: 'הקפה מהירה',
      field: 'במגרש',
      overview: 'כל המסלול',
    } as Record<'start' | 'leader' | 'finish' | 'incident' | 'battle' | 'fastest' | 'field' | 'overview', string>,
    lap: 'הקפה',
    speed: 'קמ״ש',
    ahead: 'לרכב שלפניו',
    behind: 'לרכב שמאחוריו',
    last: 'הקפה אחרונה',
    best: 'הקפה הטובה',
    sectors: 'מקטעים',
  },
  mine: ' (שלי)',
  report: 'דוח',
  lap: 'הקפה',
  fastLap: 'הקפה מהירה ·',
  rewinding: 'מריץ מחדש…',
  liveIn: 'השידור מתחיל בעוד',
  replayIn: 'צפייה חוזרת מתחילה בעוד',
  seconds: 'שניות',
  wins: (name: string) => `${name} מנצח`,
  raceTime: (time: string) => `זמן מרוץ ${time}`,
  retired: 'פרש',
  gap: (s: string) => `+${s} שנ׳`,
  startsIn: (session: string) => `${session} מתחיל בעוד`,
  dayOver: 'היום הסתיים - התוצאות פתוחות',
  ctaTitle: 'רוצים שגם לכם יהיה רכב על הגריד?',
  ctaBody: 'בוחרים איך הרכב ינהג, והוא לומד לבד מול העיניים. שתי דקות, בלי תכנות.',
  ctaButton: '🔧 לבנות נהג משלי',
  sessionResults: (session: string) => `תוצאות ${session}`,
  toReport: 'לדוח המרוץ',
  realTime: 'השידור רץ במהירות רגילה בלבד - כולם רואים את אותו רגע באותו זמן.',
  pause: 'השהה',
  play: 'נגן',
  pauseKey: 'השהה (רווח)',
  playKey: 'נגן (רווח)',
  back10: 'אחורה 10 שניות',
  position: 'מיקום בצפייה החוזרת',
  forward10: 'קדימה 10 שניות',
  /** The commentary toggle in the top bar. */
  commentaryOn: 'פרשנות',
  commentaryTitle: 'פרשנות כתובה ורדיו קבוצתי',
  radioFrom: (driver: string) => `רדיו · ${driver}`,
  radioTeam: 'קבוצה',
  /**
   * Written commentary. Each kind has a few wordings; one is picked per event,
   * the same for everybody. `a` is the car the line is about, `b` the other one.
   */
  commentary: {
    start: [
      (w: Line) => `הרמזורים כבים ויוצאים לדרך! ${w.a} מוביל לפנייה הראשונה.`,
      (w: Line) => `יצאנו! ${w.a} מזנק הכי טוב ומוביל.`,
      (w: Line) => `והמרוץ התחיל! ${w.a} בראש.`,
    ],
    lead: [
      (w: Line) => `${w.a} עוקף את ${w.b} ועובר להוביל!`,
      (w: Line) => `שינוי בהובלה! ${w.a} עובר את ${w.b}.`,
      (w: Line) => `${w.a} לוקח את המקום הראשון מ-${w.b}!`,
    ],
    pass: [
      (w: Line) => `${w.a} עוקף את ${w.b} ועולה למקום ${w.pos}.`,
      (w: Line) => `עקיפה! ${w.a} עובר את ${w.b}, עכשיו מקום ${w.pos}.`,
      (w: Line) => `${w.a} מצא את הפתח ועבר את ${w.b}.`,
    ],
    fastLap: [
      (w: Line) => `הקפה מהירה ל-${w.a}: ${w.time}.`,
      (w: Line) => `${w.a} קובע את ההקפה המהירה במרוץ, ${w.time}.`,
    ],
    lastLap: [
      (w: Line) => `ההקפה האחרונה! ${w.a} מוביל${w.gap ? ` בפער של ${w.gap}` : ''}.`,
      (w: Line) => `ההקפה האחרונה מתחילה. ${w.a} בראש${w.b ? `, ${w.b} מאחוריו` : ''}.`,
    ],
    wall: [
      (w: Line) => `${w.a} נוגע בקיר ומאבד מהירות.`,
      (w: Line) => `אאוץ'! ${w.a} פוגש את הקיר.`,
    ],
    contact: [
      (w: Line) => `מגע! ${w.a} נתקע ברכב אחר ומאבד מהירות.`,
      (w: Line) => `${w.a} נוגע ברכב אחר, צפוף שם.`,
    ],
    slide: [
      (w: Line) => `${w.a} מחליק ומאבד את האחיזה.`,
      (w: Line) => `${w.a} בדריפט ארוך, הצמיגים לא מחזיקים.`,
    ],
    battle: [
      (w: Line) => `קרב צמוד על מקום ${w.pos - 1}: ${w.a} נצמד ל-${w.b}.`,
      (w: Line) => `${w.a} יושב על הזנב של ${w.b}, פחות מחצי שנייה ביניהם.`,
    ],
    retired: [
      (w: Line) => `${w.a} פורש מהמרוץ.`,
      (w: Line) => `סוף המרוץ בשביל ${w.a}.`,
    ],
    win: [
      (w: Line) => `${w.a} חוצה את קו הסיום ומנצח!`,
      (w: Line) => `הדגל המשובץ! ${w.a} מנצח את המרוץ!`,
    ],
    podium: [
      (w: Line) => `${w.a} מסיים במקום ${w.pos} ועולה לפודיום.`,
      (w: Line) => `${w.a} חוצה את הקו, מקום ${w.pos}.`,
    ],
  } as Record<CommentKind, Array<(w: Line) => string>>,
  /**
   * Team radio: a short exchange, the driver or the team first. Masculine, the
   * way the drivers are spoken about everywhere else.
   */
  radio: {
    passMade: [
      [['driver', 'יש! עברתי אותו!'], ['team', 'יפה מאוד. עכשיו תשמור על הקצב.']],
      [['driver', 'נכנסתי לו בבלימה, הוא לא ראה אותי בא.']],
      [['team', 'עקיפה מעולה. הבא בתור.']],
    ],
    passLost: [
      [['driver', 'הוא עבר אותי, לא הייתה לי אחיזה ביציאה.']],
      [['driver', 'אני מאבד זמן בפניות!'], ['team', 'מובן. תישאר קרוב, ההזדמנות תגיע.']],
      [['team', 'הוא עבר. תישאר מאחוריו ותחכה לטעות שלו.']],
    ],
    wall: [
      [['driver', 'נגעתי בקיר! הכנף בסדר?'], ['team', 'נראה בסדר מכאן. תמשיך.']],
      [['driver', "אאוץ'. זה היה קרוב מדי."]],
    ],
    contact: [
      [['driver', 'הוא נכנס בי!'], ['team', 'ראינו. תמשיך לנהוג.']],
      [['driver', 'היה מגע. אני בסדר.']],
    ],
    slide: [
      [['driver', 'אין לי אחיזה מאחור.'], ['team', 'מובן. תהיה עדין עם הגז.']],
      [['driver', 'הצמיגים נגמרים!']],
    ],
    fastLap: [
      [['team', 'הקפה מהירה במרוץ! תמשיך ככה.']],
      [['team', 'סגול! ההקפה הכי מהירה של כולם.'], ['driver', 'מעולה, אני מרגיש טוב.']],
    ],
    lastLap: [
      [['team', 'הקפה אחרונה. תביא אותו הביתה.']],
      [['team', 'עוד הקפה אחת. בלי סיכונים.'], ['driver', 'קיבלתי.']],
    ],
    battle: [
      [['team', 'הוא חצי שנייה לפניך. יש לך את הקצב.']],
      [['driver', 'אני יכול לעבור אותו.'], ['team', 'סבלנות, חכה לפנייה הנכונה.']],
    ],
    win: [
      [['driver', 'כן! כן! ניצחנו!'], ['team', 'איזה מרוץ! ניצחון!']],
      [['driver', 'יש!!! תודה לכולם, איזה רכב!']],
    ],
    podium: [
      [['driver', 'פודיום! איזה מרוץ.'], ['team', 'עבודה טובה. כל הכבוד.']],
      [['team', 'מקום על הפודיום. כל הכבוד!']],
    ],
    retired: [
      [['driver', 'זהו, נגמר לי.'], ['team', 'מובן. תודה, עשית מה שיכולת.']],
      [['driver', "סליחה חבר'ה."]],
    ],
  } as Record<RadioKind, Array<Array<['driver' | 'team', string]>>>,
};
