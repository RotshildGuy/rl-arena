/** Small components used by more than one screen. */
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
  placeholder: 'לדוגמה: הברקים הכחולים',
  suggest: 'הגרלה',
  suggestTitle: 'הצעה לשם קבוצה פנוי',
  saving: 'שומר…',
  save: 'שמור',
  cancel: 'ביטול',
};

export const slidersSheet = {
  title: 'אופי הנהיגה',
  show: 'מחוונים',
  hide: 'הסתר מחוונים',
};
