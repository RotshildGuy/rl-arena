import type { EnvSpec, RewardChannelDef } from '../types';

/** Sensor rays fanned across the front of the car. */
export const SENSOR_COUNT = 9;
export const SENSOR_MAX = 220;
export const SENSOR_SPREAD = Math.PI * 0.75;

export const OBS_SIZE = 24;
export const OBS_VERSION = 1;

/** throttle (gas / coast / brake) x steering (left / straight / right) */
export const ACTION_LABELS = [
  'גז + שמאלה', 'גז', 'גז + ימינה',
  'חופשי + שמאלה', 'חופשי', 'חופשי + ימינה',
  'בלם + שמאלה', 'בלם', 'בלם + ימינה',
];

/**
 * Every channel is a ten-notch slider. The numbers below are the weights the
 * environment actually adds up; the user only ever sees the notch and the two
 * words at its ends. Notch 1 is always the cautious, conservative end and notch
 * 10 the extreme one, so the whole table reads in one direction.
 *
 * `defaultLevel` is chosen so a fresh model starts on exactly the weights that
 * were the defaults before the sliders existed — the balance that is known to
 * train a decent driver.
 */
export const RACING_REWARDS: RewardChannelDef[] = [
  {
    key: 'checkpoint',
    label: 'התקדמות במסלול',
    hint: 'על כל שער שנחצה בכיוון הנכון — זה מה שמלמד אותו לאן לנסוע',
    levels: [0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8],
    defaultLevel: 5,
    lowLabel: 'מטייל',
    highLabel: 'נעול על המסלול',
  },
  {
    key: 'lap',
    label: 'השלמת הקפה',
    hint: 'בונוס על כל הקפה שלמה',
    levels: [1, 2, 4, 6, 8, 10, 14, 18, 24, 30],
    defaultLevel: 6,
    lowLabel: 'לא סופר הקפות',
    highLabel: 'חי בשביל ההקפה',
  },
  {
    key: 'finish',
    label: 'סיום המרוץ',
    hint: 'בונוס חד־פעמי על השלמת כל ההקפות',
    levels: [2, 5, 8, 12, 16, 20, 30, 40, 60, 80],
    defaultLevel: 6,
    lowLabel: 'העיקר לנסוע',
    highLabel: 'חייב לחצות את הקו',
  },
  {
    key: 'speed',
    label: 'מהירות',
    hint: 'תגמול מתמשך לפי המהירות קדימה',
    levels: [0, 0.005, 0.01, 0.02, 0.03, 0.05, 0.08, 0.12, 0.18, 0.25],
    defaultLevel: 5,
    lowLabel: 'נינוח',
    highLabel: 'מכור למהירות',
  },
  {
    key: 'wallHit',
    label: 'פגיעה במעקה',
    hint: 'קנס על כל נגיעה בגדר (ברגע המגע, לא לאורך כל השפשוף)',
    levels: [-6, -4, -3, -2, -1.5, -1, -0.6, -0.3, -0.1, 0],
    defaultLevel: 6,
    lowLabel: 'זהיר',
    highLabel: 'פזיז',
  },
  {
    // The only channel that crosses zero. At the top notches contact with another
    // car pays, and the model learns to lean on people instead of avoiding them.
    key: 'carHit',
    label: 'מגע עם רכב יריב',
    hint: 'מקצה 8 ומעלה המגע מזכה בנקודות — המודל ילמד לדחוף במקום להתחמק',
    levels: [-4, -2.5, -1.5, -1, -0.5, -0.2, 0, 0.3, 0.8, 1.5],
    defaultLevel: 5,
    lowLabel: "ג'נטלמן",
    highLabel: 'אגרסיבי',
  },
  {
    key: 'reverse',
    label: 'נסיעה נגד הכיוון',
    hint: 'קנס בכל צעד שבו הרכב נע נגד כיוון המסלול',
    levels: [-3, -2, -1.2, -0.8, -0.5, -0.3, -0.2, -0.1, -0.05, 0],
    defaultLevel: 6,
    lowLabel: 'רק קדימה',
    highLabel: 'כיוון זה עניין של פרשנות',
  },
  {
    key: 'idle',
    label: 'עמידה במקום',
    hint: 'קנס בכל צעד שבו הרכב כמעט עוצר',
    levels: [-2, -1.2, -0.8, -0.5, -0.3, -0.15, -0.1, -0.05, -0.02, 0],
    defaultLevel: 6,
    lowLabel: 'חייב לזוז',
    highLabel: 'סבלני',
  },
  {
    key: 'timeStep',
    label: 'לחץ זמן',
    hint: 'קנס קטן בכל צעד, ללא תנאי — דוחף לסיים מהר',
    levels: [-0.05, -0.03, -0.02, -0.015, -0.01, -0.005, -0.003, -0.002, -0.001, 0],
    defaultLevel: 6,
    lowLabel: 'רודף את השעון',
    highLabel: 'יש זמן',
  },
  {
    key: 'overtake',
    label: 'עקיפה',
    hint: 'בונוס על כל רכב שנעקף',
    levels: [0, 0.1, 0.2, 0.3, 0.5, 0.8, 1.2, 1.8, 2.5, 4],
    defaultLevel: 5,
    lowLabel: 'נשאר בשורה',
    highLabel: 'עוקף בכל הזדמנות',
  },
];

export const RACING_SPEC: EnvSpec = {
  id: 'racing',
  name: 'מירוץ מכוניות',
  obsSize: OBS_SIZE,
  obsVersion: OBS_VERSION,
  actions: ACTION_LABELS,
  scoreLabel: 'הקפות',
  rewardChannels: RACING_REWARDS,
};
