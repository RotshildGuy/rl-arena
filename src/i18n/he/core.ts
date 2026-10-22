/**
 * Strings that live in `core/`: the circuits, the race day, the shop, the
 * reward sliders and the advice after a race. Core keeps its data; the words
 * it shows come from here.
 */

/** By track id. A circuit with no entry here shows the name in its definition. */
export const tracks: Record<string, string> = {
  oval: 'אליפסה',
  kidney: 'כליה',
  technical: 'טכני',
  speedway: 'מהיר',
};

export const champ = {
  grandPrix: (track: string) => `גרנד פרי ${track}`,
  semiFinal: 'חצי גמר',
  quarterFinal: 'רבע גמר',
  heats: 'מוקדמות',
  final: 'גמר',
  race: 'מרוץ',
  minutes: (n: number) => `${n} דקות`,
  hour: 'שעה',
  hours: (n: number) => `${n} שעות`,
  houseTeam: 'קבוצת הבית',
  /** House drivers by entry id. */
  house: { 'house-1': 'טירון', 'house-2': 'מתלמד', 'house-3': 'מאוזן', 'house-4': 'פזיז' } as Record<string, string>,
};

export const names = {
  tooShort: (n: number) => `השם צריך לפחות ${n} תווים`,
  tooLong: (n: number) => `השם מוגבל ל-${n} תווים`,
  invisible: 'השם מכיל תווים בלתי נראים שאינם מותרים',
  link: 'אי אפשר לכלול קישור או כתובת בשם',
  repeated: 'השם לא יכול להיות תו אחד חוזר',
  noLetter: 'השם צריך לכלול לפחות אות או ספרה',
  house: 'השם הזה שמור לקבוצת הבית',
};

/** Shop items by id. */
export const shopItems: Record<string, string> = {
  'color-scarlet': 'ארגמן',
  'color-crimson': 'בורדו',
  'color-orange': 'כתום מרוץ',
  'color-sky': 'תכלת',
  'color-navy': 'כחול לילה',
  'color-teal': 'טורקיז',
  'color-pink': 'ורוד',
  'color-silver': 'כסף',
  'color-graphite': 'גרפיט',
  'color-white': 'לבן',
  'second-white': 'לבן',
  'second-black': 'שחור',
  'second-scarlet': 'ארגמן',
  'second-orange': 'כתום',
  'second-sky': 'תכלת',
  'second-navy': 'כחול לילה',
  'second-teal': 'טורקיז',
  'second-pink': 'ורוד',
  'second-silver': 'כסף',
  'pattern-stripe': 'פס מרכזי',
  'pattern-twotone': 'שני גוונים',
  'pattern-solid': 'חלק',
  number: 'מספר לבחירה',
  'helmet-gold': 'קסדה מוזהבת',
  'helmet-black': 'קסדה שחורה',
  'helmet-red': 'קסדה אדומה',
  'smoke-blue': 'עשן כחול בדריפט',
  'smoke-red': 'עשן אדום בדריפט',
  'smoke-white': 'עשן לבן סמיך',
};

export const coins = {
  points: (n: number) => `נקודות במרוצים (${n})`,
  starts: (n: number) => `השתתפות (${n} זינוקים)`,
  season: (season: number, position: number) => `סיום עונה ${season} במקום ${position}`,
  firstFinish: 'מרוץ ראשון עד הדגל',
  firstPodium: 'פודיום ראשון',
  firstWin: 'ניצחון ראשון',
  clean: 'מרוץ שלם בלי לגעת בקיר',
  tenRaces: 'עשרה מרוצים',
};

export const diagnose = {
  unreadyFinding: (laps: number, of: number) => `השלים ${laps} מתוך ${of} הקפות`,
  unreadyAction: 'המודל לא מוכן למרוץ מלא. תנו לו עוד זמן אימון, עד שבאימון הוא משלים את כל ההקפות ברצף.',
  wallsFinding: (hits: number, laps: number) => `${hits} פגיעות בקיר ב-${laps} הקפות, יותר מרוב המגרש`,
  wallsAction: (slider: string) => `הזיזו ימינה את "${slider}" - קנס חמור יותר על הקיר מלמד לבלום לפני הפנייה.`,
  speedFinding: (top: number, avg: number) => `מהירות שיא ${top} קמ״ש, מול ממוצע ${avg} קמ״ש של השאר`,
  speedAction: (slider: string) => `הזיזו ימינה את "${slider}" - הוא נוהג לאט מדי בישורות.`,
  contactFinding: (hits: number, lost: number) =>
    `${hits} מגעים עם רכבים, ו-${lost === 1 ? 'מקום אחד שאבד' : `${lost} מקומות שאבדו`} מהזינוק`,
  contactAction: (slider: string) => `הזיזו שמאלה את "${slider}" - המגעים עולים לו מקומות.`,
  noCleanLap: 'לא השלים הקפה נקייה',
  onPace: 'קצב הקפה בין המהירים במרוץ',
  offPace: (pct: string) => `ההקפה המהירה שלו איטית ב-${pct}% מהמהירה במרוץ`,
  paceLostAtStart: 'הקצב קיים; המקום הלך בזינוק או בתנועה. אמנו עם יותר רכבים על המסלול כדי שילמד לעקוף.',
  paceQuali: 'הקצב קיים ולא אבד אף מקום. הניצחון מתחיל במוקדמות: הקפה מהירה יותר שם פירושה זינוק מקדימה.',
  slow: 'הוא נקי אבל איטי. המשיכו לאמן אותו על המסלול הזה - זמן אימון הוא מה שחסר כאן.',
};

export const racing = {
  name: 'מרוץ מכוניות',
  scoreLabel: 'הקפות',
  actions: [
    'גז + שמאלה', 'גז', 'גז + ימינה',
    'חופשי + שמאלה', 'חופשי', 'חופשי + ימינה',
    'בלם + שמאלה', 'בלם', 'בלם + ימינה',
  ],
  channels: {
    checkpoint: {
      label: 'התקדמות במסלול',
      hint: 'על כל שער שנחצה בכיוון הנכון - זה מה שמלמד אותו לאן לנסוע',
      lowLabel: 'מטייל',
      highLabel: 'נעול על המסלול',
    },
    lap: { label: 'השלמת הקפה', hint: 'בונוס על כל הקפה שלמה', lowLabel: 'לא סופר הקפות', highLabel: 'חי בשביל ההקפה' },
    finish: {
      label: 'סיום המרוץ',
      hint: 'בונוס חד־פעמי על השלמת כל ההקפות',
      lowLabel: 'העיקר לנסוע',
      highLabel: 'חייב לחצות את הקו',
    },
    speed: { label: 'מהירות', hint: 'תגמול מתמשך לפי המהירות קדימה', lowLabel: 'נינוח', highLabel: 'מכור למהירות' },
    wallHit: {
      label: 'שמירה מהמעקה',
      hint: 'כמה קנס על כל נגיעה בגדר (ברגע המגע, לא לאורך כל השפשוף)',
      lowLabel: 'פזיז',
      highLabel: 'זהיר',
    },
    carHit: {
      label: 'מגע עם רכב יריב',
      hint: 'מקצה 8 ומעלה המגע מזכה בנקודות - המודל ילמד לדחוף במקום להתחמק',
      lowLabel: "ג'נטלמן",
      highLabel: 'אגרסיבי',
    },
    reverse: {
      label: 'נסיעה בכיוון הנכון',
      hint: 'כמה קנס בכל צעד שבו הרכב נע נגד כיוון המסלול',
      lowLabel: 'כיוון זה עניין של פרשנות',
      highLabel: 'רק קדימה',
    },
    idle: {
      label: 'לא לעמוד במקום',
      hint: 'כמה קנס בכל צעד שבו הרכב כמעט עוצר',
      lowLabel: 'סבלני',
      highLabel: 'חייב לזוז',
    },
    timeStep: {
      label: 'לחץ זמן',
      hint: 'קנס קטן בכל צעד, ללא תנאי - דוחף לסיים מהר',
      lowLabel: 'יש זמן',
      highLabel: 'רודף את השעון',
    },
    overtake: { label: 'עקיפה', hint: 'בונוס על כל רכב שנעקף', lowLabel: 'נשאר בשורה', highLabel: 'עוקף בכל הזדמנות' },
  },
  presets: {
    careful: { label: 'זהיר', hint: 'בולם מוקדם, לא נוגע בקיר ולא ביריבים. איטי יותר, אבל כמעט תמיד מסיים' },
    balanced: { label: 'מאוזן', hint: 'ברירת המחדל - האיזון שידוע שמלמד נהג סביר' },
    aggressive: { label: 'אגרסיבי', hint: 'מהיר, עוקף ולא מפחד ממגע. מהיר יותר כשזה עובד, ונגמר בקיר כשלא' },
  },
  blurb: 'מרוץ 2D על ארבע מפות. הרכב "רואה" דרך תשעה חיישני מרחק ובוחר גז, בלם והיגוי.',
  options: {
    trackId: { label: 'מפה' },
    nCars: { label: 'מספר רכבים', hint: 'הרכבים מתחלקים בין המודלים שמתאמנים. יותר רכבים - יותר תנועה להתמודד איתה' },
    laps: { label: 'הקפות' },
    carCollisions: { label: 'מגע בין רכבים', hint: 'כשכבוי, הרכבים עוברים זה דרך זה' },
  },
  cars: (n: string) => `${n} רכבים`,
  laps: (n: string) => `${n} הקפות`,
  contact: 'עם מגע',
  noContact: 'ללא מגע',
  controlsHint: 'חיצים או WASD · ↑ גז · ↓ בלם',
  touchHint: 'החזיקו גז או בלם משמאל · היגוי מימין',
  matchNoun: 'מרוץ',
  seatHint: 'אתם נוהגים ברכב הראשון',
  gas: 'גז',
  brake: 'בלם',
  left: 'שמאלה',
  right: 'ימינה',
};

export const algorithms = {
  dqn: {
    name: 'לומד תוך כדי נסיעה',
    technical: 'DQN',
    blurb:
      'רכב אחד שמתקן את עצמו אחרי כל טעות, צעד אחר צעד. לומד מהר ממעט ניסיון, אבל כל צעד דורש חישוב כבד - עדיף על מחשב.',
    episodeLabel: 'ניסיון',
    episodesLabel: 'ניסיונות',
    exploreLabel: 'סקרנות',
  },
  ga: {
    name: 'דור אחרי דור',
    technical: 'אלגוריתם גנטי',
    blurb:
      'קבוצה שלמה של נהגים מתחרה, הטובים שורדים ויוצרים גרסאות מוטציה של עצמם. צריך הרבה יותר נסיעות, אבל כל נסיעה זולה - מומלץ בנייד.',
    episodeLabel: 'ניסיון',
    episodesLabel: 'ניסיונות',
    exploreLabel: 'עוצמת מוטציה',
  },
  gaNote: (current: number, total: number) => `מקצה ${current}/${total} בדור`,
  dqnNote: (steps: number) => `צעד ${steps} בניסיון`,
};
