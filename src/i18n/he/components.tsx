/** Small components used by more than one screen. */
export const leagues = {
  title: 'ליגת חברים',
  needsCloud: 'ליגות דורשות חיבור לענן, והאתר רץ כרגע בלעדיו.',
  createFailed: 'יצירת הליגה נכשלה',
  shareText: (name: string) => `הצטרפו לליגה "${name}" ב-RL Arena`,
  copied: 'קישור ההזמנה הועתק',
  left: (name: string) => `יצאתם מ"${name}"`,
  leaveFailed: 'היציאה נכשלה',
  intro:
    'אותם מרוצים, טבלה רק שלכם: ליגה סופרת רק את הרכבים של החברים בה, עם הנקודות שהם באמת צברו. מי שיש לו את הקישור יכול להצטרף.',
  members: (n: number) => `${n} חברים`,
  invite: 'הזמנה',
  leave: 'יציאה',
  newName: 'שם לליגה חדשה',
  create: 'יצירה',
};

export const rewardEditor = {
  title: 'אופי הנהיגה',
  live: 'משפיע מיד',
  reset: 'איפוס',
  custom: 'סגנון משלכם - כוונון ידני במחוונים.',
  advanced: 'מתקדם · כוונון ידני בעשרה מחוונים (סליידרים)',
  explain: 'כל מחוון שואל כמה זה חשוב לכם: ימינה זה תמיד "יותר מזה". אין כאן תשובה נכונה אחת.',
  level: (label: string, level: number, of: number) => `${label}: ${level} מתוך ${of}`,
};

export const welcome = {
  eyebrow: 'ברוכים הבאים',
  title: 'איך זה עובד',
  ok: 'הבנתי',
};

export const primer = {
  eyebrow: 'לפני שמתחילים',
  title: 'המודל לא מנסה לנהוג טוב',
  startTraining: 'הבנתי, בואו נאמן',
  ok: 'הבנתי',
  body1: (
    <>
      המודל רק מנסה <b>לצבור כמה שיותר נקודות לפי המחוונים שקבעתם.</b> אם יש דרך קלה יותר לצבור אותן
      מאשר לנהוג מהר - הוא ימצא אותה.
    </>
  ),
  body2: (
    <>
      באליפות נמדד רק <b>זמן</b>, אז כוונו את המחוונים כך שנהיגה מהירה תשתלם. אפשר לשנות אותם גם באמצע
      האימון.
    </>
  ),
};

export const teamNameForm = {
  label: 'שם המתחרה - זה יהיה שם הקבוצה שלכם בטבלה',
  failed: 'שמירת השם נכשלה',
  placeholder: 'לדוגמה: גיא',
  saving: 'שומר…',
  save: 'שמור',
  cancel: 'ביטול',
};
