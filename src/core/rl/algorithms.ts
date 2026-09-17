export type AlgorithmId = 'dqn' | 'ga';

/**
 * How a model learns, in words anybody can choose between.
 *
 * The technical name is kept, but it is not what the button says: "DQN" tells a
 * newcomer nothing about what will happen to their car, while "לומד תוך כדי
 * נסיעה" does. The labels also keep the dashboard honest — a generation is not
 * an episode, and the two methods count progress differently.
 */
export interface AlgorithmInfo {
  id: AlgorithmId;
  /** What the picker shows. */
  name: string;
  /** The textbook name, shown quietly beside it. */
  technical: string;
  /** One line under the picker. */
  blurb: string;
  /** Unit of one entry on the progress chart. */
  episodeLabel: string;
  /** Plural of the same, for stat tiles. */
  episodesLabel: string;
  /** What "how hard it is still experimenting" is called here. */
  exploreLabel: string;
}

export const ALGORITHMS: Record<AlgorithmId, AlgorithmInfo> = {
  dqn: {
    id: 'dqn',
    name: 'לומד תוך כדי נסיעה',
    technical: 'DQN',
    blurb:
      'רכב אחד שמתקן את עצמו אחרי כל טעות, צעד אחר צעד. לומד מהר ממעט ניסיון, אבל כל צעד דורש חישוב כבד — עדיף על מחשב.',
    episodeLabel: 'ניסיון',
    episodesLabel: 'ניסיונות',
    exploreLabel: 'סקרנות',
  },
  ga: {
    id: 'ga',
    name: 'דור אחרי דור',
    technical: 'אלגוריתם גנטי',
    blurb:
      'קבוצה שלמה של נהגים מתחרה, הטובים שורדים ויוצרים גרסאות מוטציה של עצמם. צריך הרבה יותר נסיעות, אבל כל נסיעה זולה — מומלץ בנייד.',
    episodeLabel: 'דור',
    episodesLabel: 'דורות',
    exploreLabel: 'עוצמת מוטציה',
  },
};
