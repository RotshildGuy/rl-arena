import type { EnvSpec, RewardChannelDef, RewardPreset } from '../types';

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
 * words at its ends.
 *
 * Every slider asks one question - how much does this matter to you - and 10 is
 * always "a lot". For a bonus that means a bigger bonus; for a penalty it means
 * a *harsher* penalty, so those channels list their weights from 0 down. Moving
 * any slider right always means "more of this", which is what anybody expects
 * without reading the labels. (Saved models store weights, not notches, and
 * `levelOf` maps a weight back to its notch, so the order is display only.)
 *
 * `defaultLevel` is chosen so a fresh model starts on exactly the weights that
 * were the defaults before the sliders existed - the balance that is known to
 * train a decent driver - with one exception, the wall, explained there.
 */
export const RACING_REWARDS: RewardChannelDef[] = [
  {
    key: 'checkpoint',
    label: 'התקדמות במסלול',
    hint: 'על כל שער שנחצה בכיוון הנכון - זה מה שמלמד אותו לאן לנסוע',
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
    label: 'שמירה מהמעקה',
    hint: 'כמה קנס על כל נגיעה בגדר (ברגע המגע, לא לאורך כל השפשוף)',
    levels: [0, -0.1, -0.3, -0.6, -1, -1.5, -2, -3, -4, -6],
    // -3, a harsher default than the -1 the table started with. Since the tyres
    // got a limit (physics 2) a crash costs real time, and a model charged -1
    // for one learned to corner on the wall; at -3 it learns to brake instead.
    defaultLevel: 8,
    lowLabel: 'פזיז',
    highLabel: 'זהיר',
  },
  {
    // The only channel that crosses zero. At the top notches contact with another
    // car pays, and the model learns to lean on people instead of avoiding them.
    key: 'carHit',
    label: 'מגע עם רכב יריב',
    hint: 'מקצה 8 ומעלה המגע מזכה בנקודות - המודל ילמד לדחוף במקום להתחמק',
    levels: [-4, -2.5, -1.5, -1, -0.5, -0.2, 0, 0.3, 0.8, 1.5],
    defaultLevel: 5,
    lowLabel: "ג'נטלמן",
    highLabel: 'אגרסיבי',
  },
  {
    key: 'reverse',
    label: 'נסיעה בכיוון הנכון',
    hint: 'כמה קנס בכל צעד שבו הרכב נע נגד כיוון המסלול',
    levels: [0, -0.05, -0.1, -0.2, -0.3, -0.5, -0.8, -1.2, -2, -3],
    defaultLevel: 5,
    lowLabel: 'כיוון זה עניין של פרשנות',
    highLabel: 'רק קדימה',
  },
  {
    key: 'idle',
    label: 'לא לעמוד במקום',
    hint: 'כמה קנס בכל צעד שבו הרכב כמעט עוצר',
    levels: [0, -0.02, -0.05, -0.1, -0.15, -0.3, -0.5, -0.8, -1.2, -2],
    defaultLevel: 5,
    lowLabel: 'סבלני',
    highLabel: 'חייב לזוז',
  },
  {
    key: 'timeStep',
    label: 'לחץ זמן',
    hint: 'קנס קטן בכל צעד, ללא תנאי - דוחף לסיים מהר',
    levels: [0, -0.001, -0.002, -0.003, -0.005, -0.01, -0.015, -0.02, -0.03, -0.05],
    defaultLevel: 5,
    lowLabel: 'יש זמן',
    highLabel: 'רודף את השעון',
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

/**
 * Three styles over the same table, for the first model of someone who does not
 * want to think about ten sliders yet. Balanced is the defaults themselves; the
 * other two move only the channels that decide character - speed, the wall,
 * contact, overtaking and the clock - and leave the ones that teach a car to
 * follow the road alone, because a style should change how it drives, not
 * whether it learns to drive at all.
 */
export const RACING_PRESETS: RewardPreset[] = [
  {
    id: 'careful',
    label: 'זהיר',
    hint: 'בולם מוקדם, לא נוגע בקיר ולא ביריבים. איטי יותר, אבל כמעט תמיד מסיים',
    levels: { speed: 4, wallHit: 10, carHit: 2, overtake: 3, timeStep: 4 },
  },
  {
    id: 'balanced',
    label: 'מאוזן',
    hint: 'ברירת המחדל - האיזון שידוע שמלמד נהג סביר',
    levels: {},
  },
  {
    id: 'aggressive',
    label: 'אגרסיבי',
    hint: 'מהיר, עוקף ולא מפחד ממגע. מהיר יותר כשזה עובד, ונגמר בקיר כשלא',
    levels: { speed: 8, wallHit: 6, carHit: 7, overtake: 8, timeStep: 7 },
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
  presets: RACING_PRESETS,
};
