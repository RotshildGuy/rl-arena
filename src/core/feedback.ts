/**
 * Bug reports and ideas, sent from inside the app.
 *
 * The rules here are the ones `firestore.rules` enforces as well (see the
 * README): a kind from a short list, a text of sensible length, and nothing
 * else about the sender than what they chose to add.
 */
export const FEEDBACK_KINDS = ['bug', 'idea', 'other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type FeedbackStatus = 'new' | 'seen' | 'done';

export const FEEDBACK_MIN = 10;
export const FEEDBACK_MAX = 2000;
export const CONTACT_MAX = 120;

export interface Feedback {
  id: string;
  uid: string;
  kind: FeedbackKind;
  text: string;
  /** The screen it was sent from, which is most of what a bug report needs. */
  screen: string;
  /** Only when the sender ticked the box: the browser's user-agent string. */
  device?: string;
  /** Only when the sender wrote one: how to get back to them. */
  contact?: string;
  createdAt: number;
  status: FeedbackStatus;
  /** An operator's answer, shown to the sender under their message. */
  reply?: string;
}

export const KIND_LABEL: Record<FeedbackKind, string> = { bug: 'באג', idea: 'הצעה לשיפור', other: 'אחר' };
export const STATUS_LABEL: Record<FeedbackStatus, string> = { new: 'התקבלה', seen: 'נקראה', done: 'טופלה' };

/** A Hebrew explanation of what is wrong, or null. */
export function feedbackProblem(text: string, contact = ''): string | null {
  const t = text.trim();
  if (t.length < FEEDBACK_MIN) return `כתבו לפחות ${FEEDBACK_MIN} תווים - מה קרה, או מה הייתם רוצים`;
  if (t.length > FEEDBACK_MAX) return `עד ${FEEDBACK_MAX} תווים`;
  if (contact.trim().length > CONTACT_MAX) return `פרטי הקשר ארוכים מדי`;
  return null;
}
