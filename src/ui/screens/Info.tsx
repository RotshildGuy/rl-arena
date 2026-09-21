import { useEffect, useState, useSyncExternalStore } from 'react';
import { useApp } from '../store';
import { getArena } from '../../storage/arena';
import { deleteMyData } from '../deleteMyData';
import { getAuthView, isLinked, providerLabel, subscribeAuth } from '../auth';
import { AccountModal } from '../components/Account';
import { GRID_SIZE, MIN_ENTRIES, RACE_LAPS } from '../../core/champ/format';
import { MAX_CARS_PER_TEAM } from '../../core/champ/card';
import { NAME_MAX } from '../../core/champ/names';
import { POINTS, FASTEST_LAP_BONUS, CLASSIFY_FRACTION } from '../../core/champ/points';
import { lockLeadText } from '../../core/champ/schedule';

/**
 * The page nobody reads until they need it: how to play, what the rules are,
 * what is stored, and how to make it all go away. Kept on one screen with a
 * switcher rather than four, because a legal page split across four routes is a
 * legal page nobody finishes.
 */
type Tab = 'how' | 'terms' | 'privacy' | 'notices';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'how', label: 'איך זה עובד' },
  { id: 'terms', label: 'תנאי שימוש' },
  { id: 'privacy', label: 'פרטיות' },
  { id: 'notices', label: 'קרדיטים' },
];

/** Where privacy and takedown requests go. */
const CONTACT = 'rotshild189@gmail.com';

export function Info() {
  const { go, infoTab, openInfo } = useApp();

  return (
    <>
      <div className="toolbar">
        <div className="title">
          <div className="eyebrow">מידע</div>
          <h1 className="display">הכל על האליפות</h1>
        </div>
        <div className="actions">
          <div className="segmented">
            {TABS.map((t) => (
              <button key={t.id} className={infoTab === t.id ? 'on' : ''} onClick={() => openInfo(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <button className="ghost" onClick={() => go('championship')}>
            חזרה
          </button>
        </div>
      </div>

      <div className="prose card notched">
        {infoTab === 'how' && <HowTo />}
        {infoTab === 'terms' && <Terms />}
        {infoTab === 'privacy' && <Privacy />}
        {infoTab === 'notices' && <Notices />}
      </div>
    </>
  );
}

function HowTo() {
  return (
    <>
      <h2>בקצרה</h2>
      <p>
        אתם לא נוהגים — אתם בונים את מי שנוהג. מאמנים מודל למידת חיזוק בדפדפן, רושמים אותו
        לאליפות, ופעם ביום כל המודלים הרשומים מתחרים ביניהם בגרנד פרי.
      </p>

      <h3>1 · לאמן מודל</h3>
      <p>
        במסך <b>המוסך</b> לוחצים "אמן מודל חדש". נותנים לו שם — זה יהיה שם הנהג — ושם מתחרה,
        שהוא שם הקבוצה שלכם. בוחרים איך הוא לומד ועל איזה מסלול, ומכוונים עשרה
        <b> מחווני אופי</b> — כמה זהיר, כמה אגרסיבי, כמה ממהר. כל מחוון הוא 1 עד 10, בלי מספרים
        ובלי הגדרות טכניות. זו ההחלטה המשמעותית ביותר, והיא שקובעת איזה נהג ייצא לכם.
      </p>
      <p>
        חשוב להבין מה באמת קורה שם: <b>המודל לא מנסה לנהוג טוב — הוא מנסה לצבור נקודות.</b> אם
        העונש על פגיעה בקיר נמוך מדי, הוא יגלה שמשתלם להישען על הגדר ולדחוף לאורך כל המסלול.
        זה יעבור שערים, זה יצבור ניקוד, וזה יהיה איטי להחריד. כשהמודל מתנהג מוזר הוא לא טועה —
        הוא עשה בדיוק את מה שביקשתם. ההסבר המלא נמצא בכפתור "הסבר על אימון" במוסך.
      </p>
      <p>
        אפשר לאמן <b>כמה מודלים יחד על אותו מסלול</b> — לכל אחד רשת ומחוונים משלו, והם
        מפריעים זה לזה בדיוק כמו במרוץ. ככה מגלים אם מודל באמת מהיר או רק מהיר כשהכביש ריק.
      </p>
      <p className="muted">
        טיפ: מצב "טורבו" מכבה את הציור ומאמן הרבה יותר מהר. תנו לו כמה דקות ותראו את זמן ההקפה יורד.
      </p>

      <h3>2 · לרשום לאליפות</h3>
      <p>
        במוסך, ליד כל מודל, יש "רשום לאליפות". <b>שמירת מודל לא מכניסה אותו לטורניר</b> — צריך
        לרשום במפורש, כי רישום מעתיק את המודל למקום שכולם רואים.
      </p>
      <ul>
        <li>
          <b>הרישום נסגר {lockLeadText()} לפני כיבוי האורות.</b> מי שנרשם אחרי זה מתחרה בסבב
          הבא. עדכון של רכב שכבר רשום נכנס לתוקף עד לרגע הזינוק עצמו.
        </li>
        <li>
          אימון נוסף <b>לא</b> מתעדכן לבד. יש כפתור "עדכן רכב", והמוסך מסמן "גרסה ישנה על המסלול"
          כשיש פער.
        </li>
        <li>עדכון שומר על אותו נהג ועל אותן נקודות — קבוצה שמביאה שדרוג לא מקבלת נהג חדש.</li>
        <li>
          לכל קבוצה <b>{MAX_CARS_PER_TEAM} רכבים</b> על המסלול. כשהם תפוסים, רישום של מודל נוסף
          שואל איזה רכב יורד במקומו — מי שיורד מאבד את מקומו בסבבים הבאים, אבל הנקודות שצבר
          נשארות ברשומות והוא יכול להירשם שוב.
        </li>
        <li>צריך לפחות {MIN_ENTRIES} מודלים רשומים כדי שהמרוץ ייערך.</li>
      </ul>

      <h3>3 · יום המרוץ</h3>
      <ul>
        <li>
          <b>מוקדמות:</b> כל מודל רץ לבד על מסלול ריק. ההקפה המהירה ביותר קובעת את עמדת הזינוק.
        </li>
        <li>
          <b>מרוץ:</b> {RACE_LAPS} הקפות. עד {GRID_SIZE} מודלים מזניקים יחד; מעבר לזה היום מתחלק
          למקצים והמובילים עולים לגמר.
        </li>
        <li>
          <b>שידור:</b> במהירות רגילה בלבד, בלי אפשרות להאיץ. כולם רואים את אותו רגע באותו זמן —
          לכן כדאי להיות שם.
        </li>
        <li>
          <b>תוצאות:</b> נחשפות בתום השידור, לא לפניו.
        </li>
      </ul>

      <h3>4 · ניקוד</h3>
      <p className="mono" style={{ direction: 'ltr', textAlign: 'start' }}>
        {POINTS.join(' · ')}
      </p>
      <ul>
        <li>נקודות לעשרת הראשונים, ועוד {FASTEST_LAP_BONUS} להקפה המהירה — רק אם הנהג סיים בעשירייה.</li>
        <li>
          רכב שלא השלים לפחות {Math.round(CLASSIFY_FRACTION * 100)}% מהמרחק של המנצח אינו מסווג
          ואינו צובר נקודות (NC).
        </li>
        <li>שוויון נקודות נשבר לפי מספר הנצחונות, ואם גם אז שוויון — לפי מספר המקומות השניים, וכן הלאה.</li>
        <li>נקודות הנהגים של כל קבוצה מצטברות יחד לטבלת הקבוצות.</li>
      </ul>

      <h3>5 · לשחק בעצמכם</h3>
      <p>
        בטאב <b>לשחק</b> אפשר לנהוג מול המודלים שלכם או מול הרכבים שמתחרים באליפות. זה מגרש
        אימונים — התוצאות שם לא נכנסות לשום טבלה.
      </p>

    </>
  );
}

function Terms() {
  return (
    <>
      <h2>תנאי שימוש</h2>
      <p className="muted">עודכן לאחרונה: ספטמבר 2026</p>

      <h3>מה זה</h3>
      <p>
        זה פרויקט חובבים, ללא מטרות רווח וללא תשלום. הוא ניתן <b>כפי שהוא (AS IS)</b>, בלי
        אחריות מכל סוג — לא לזמינות, לא לתקינות, ולא להתאמה למטרה כלשהי. השימוש על אחריותכם בלבד.
      </p>

      <h3>אין התחייבות להמשכיות</h3>
      <ul>
        <li>אפשר שהשירות ייסגר, יופסק או ישתנה בכל רגע, בלי הודעה מראש.</li>
        <li>אפשר שעונה תאופס ושהחוקים ישתנו. משתמש אינו יכול לשנות תוצאה שנרשמה, אבל מפעיל האתר יכול לאפס עונה שלמה.</li>
        <li>
          <b>אין גיבוי מובטח.</b> מודל שאתם לא רוצים לאבד — ייצאו אותו לקובץ מהמוסך. זה הגיבוי
          היחיד ששורד גם סגירה של השירות עצמו.
        </li>
      </ul>

      <h3>מה אסור</h3>
      <ul>
        <li>
          שמות פוגעניים, מאיימים, גזעניים או מיניים — לא כשם מודל ולא כשם מתחרה. השמות האלה
          מופיעים לכל המשתמשים.
        </li>
        <li>התחזות לאדם, לקבוצה או לארגון אחר.</li>
        <li>שמות שמפרים סימן מסחר, זכויות יוצרים או פרטיות של אחרים.</li>
        <li>ניסיון לשבש את השירות, להעמיס עליו, או לעקוף את כללי האליפות.</li>
        <li>העלאת תוכן שאינכם רשאים להעלות.</li>
      </ul>
      <p>
        שמות מוגבלים ל-{NAME_MAX} תווים ואינם יכולים לכלול קישורים או תווים בלתי נראים. אנחנו
        רשאים להסיר כל רישום, בכל עת, ללא הודעה ולפי שיקול דעתנו.
      </p>

      <h3>תוכן שאתם מזינים</h3>
      <p>
        אתם אחראים לשמות ולמודלים שאתם מעלים, ומצהירים שיש לכם זכות להעלות אותם. בהעלאה אתם
        נותנים רשות להציג אותם באתר, להריץ אותם במרוצים ולשמור אותם כחלק מהיסטוריית האליפות.
      </p>

      <h3>היסטוריה היא לצמיתות</h3>
      <p>
        תוצאות של מרוצים שכבר נערכו הן <b>בלתי ניתנות לשינוי</b>, כולל שם המודל ושם הקבוצה
        שהופיעו בהן. גם אחרי שתמחקו את הנתונים שלכם הן נשארות. אם זה מפריע לכם — אל תשתמשו בשם אמיתי.
      </p>

      <h3>חשבון</h3>
      <ul>
        <li>
          אפשר להיכנס עם Google, עם מייל וסיסמה, או בלי חשבון כלל. אתם אחראים לשמירת פרטי
          הכניסה שלכם; אל תשתפו סיסמה עם אחרים.
        </li>
        <li>
          <b>כניסה בלי חשבון היא זהות של דפדפן.</b> ניקוי נתוני האתר, מעבר למכשיר אחר או חלון
          פרטי מנתקים אתכם ממנה בלי דרך חזרה — כולל מהרכבים והנקודות שצברתם. אפשר לקשר אליה
          חשבון בכל רגע מתוך מידע ← קרדיטים, וזה שומר על הכל.
        </li>
        <li>אנחנו רשאים להשעות או להסיר חשבון שמפר את התנאים האלה.</li>
      </ul>

      <h3>קטינים</h3>
      <p>השירות אינו מיועד לילדים מתחת לגיל 13.</p>

      <h3>דין</h3>
      <p>על תנאים אלה יחולו דיני מדינת ישראל, ולבתי המשפט בישראל תהיה סמכות השיפוט הבלעדית.</p>
    </>
  );
}

function Privacy() {
  return (
    <>
      <h2>מדיניות פרטיות</h2>
      <p className="muted">עודכן לאחרונה: ספטמבר 2026</p>

      <p>
        קצר: <b>אין כאן מעקב ואין פרסום.</b> השירות לא מבקש שם אמיתי או מספר טלפון ולא מפעיל
        כלי אנליטיקה כלשהו. <b>אפשר להשתמש בו בלי למסור שום פרט</b> — כניסה בלי חשבון היא אחת
        משלוש האפשרויות במסך הפתיחה, והיא עובדת במלואה.
      </p>

      <h3>איך נכנסים, ומה זה שומר</h3>
      <ul>
        <li>
          <b>בלי חשבון.</b> נוצר מזהה אקראי (Firebase Anonymous Auth) שחי בדפדפן הזה בלבד. הוא
          לא מקושר לשום פרט מזהה ואנחנו לא יודעים מי אתם.
        </li>
        <li>
          <b>מייל וסיסמה.</b> כתובת המייל נשמרת ב-Firebase Authentication כדי לזהות אתכם
          בכניסה הבאה ולאפשר איפוס סיסמה. הסיסמה עצמה נשמרת אצל Google בצורה מגובבת ואינה
          גלויה לנו. <b>המייל לא מופיע בשום מקום פומבי באתר</b> ולא נשלח אליו דבר מלבד איפוס
          סיסמה שביקשתם.
        </li>
        <li>
          <b>Google.</b> אם תבחרו להתחבר עם Google, נקבל ממנו את כתובת המייל, השם המוצג ותמונת
          הפרופיל אם יש — ונשתמש רק בכתובת, כדי לזהות אתכם. גם הם אינם מופיעים בשום מקום פומבי.
        </li>
        <li>
          <b>קישור חשבון קיים.</b> מי שנכנס בלי חשבון יכול לקשר אליו Google או מייל מאוחר יותר.
          הקישור שומר על אותו מזהה — שום דבר לא מועבר ולא מתחיל מחדש — ומוסיף רק את פרטי הכניסה
          שלמעלה.
        </li>
      </ul>

      <h3>מה נשמר</h3>
      <ul>
        <li>
          <b>מה שהקלדתם:</b> שם המתחרה ושם המודל. אלה שדות חופשיים — אם תכתבו בהם פרט מזהה, הוא
          יופיע לכולם.
        </li>
        <li>
          <b>המודלים שאימנתם</b> והיסטוריית האימון שלהם.
        </li>
        <li>
          <b>תוצאות מרוצים</b> שהמודלים שלכם השתתפו בהם.
        </li>
      </ul>

      <h3>מה לא נשמר</h3>
      <p className="muted">
        שם אמיתי · טלפון · מיקום · עוגיות מעקב · פרופיל פרסומי · כלי אנליטיקה. אימייל נשמר רק
        אם בחרתם להתחבר עם מייל או עם Google, ולעולם לא מוצג לאחרים.
        הגופנים באתר מוגשים מהשרת שלנו ולא מרשת חיצונית, כך שטעינת הדף לא מדווחת לאף צד שלישי.
      </p>

      <h3>איפה</h3>
      <ul>
        <li>
          <b>בדפדפן שלכם:</b> שם המתחרה נשמר ב-localStorage, והמודלים ב-IndexedDB. המחיקה שלהם
          בשליטתכם המלאה, גם דרך הגדרות הדפדפן.
        </li>
        <li>
          <b>בענן:</b> Google Firestore, באזור <b>me-west1 (תל אביב)</b>. פרטי הכניסה עצמם —
          המזהה, וכתובת המייל אם יש — יושבים ב-Firebase Authentication, שירות נפרד של Google.
        </li>
        <li>
          <b>אירוח:</b> Firebase Hosting. כמו כל שרת אינטרנט, ספק האירוח רושם בקשות ובכללן כתובות
          IP. אלה יומני שרת של Google ולא מידע שאנחנו אוספים או ניגשים אליו.
        </li>
      </ul>

      <h3>מי רואה מה</h3>
      <ul>
        <li>
          <b>מודלים שלא נרשמו לאליפות פרטיים לחלוטין.</b> כללי האבטחה נועלים אותם למזהה שיצר
          אותם, ואף משתמש אחר לא יכול לקרוא אותם.
        </li>
        <li>
          <b>מה שרשמתם לאליפות — פומבי.</b> שם המודל, שם הקבוצה והתוצאות גלויים לכל מי שנכנס
          לאתר.
        </li>
        <li>
          <b>גם המשקולות עצמן.</b> כדי שהדפדפן של כל צופה יוכל להריץ את המרוץ, הוא חייב לקבל
          את המודלים שמשתתפים בו. כלומר <b>המודל שרשמתם ניתן להורדה על ידי כל מי שנכנס לאתר</b>.
          זו לא בחירה אלא תוצאה ישירה של כך שאין כאן שרת שמריץ את המרוץ במקומכם. מי שמעדיף
          לשמור מודל לעצמו — פשוט לא ירשום אותו לאליפות.
        </li>
      </ul>

      <h3>כמה זמן</h3>
      <p>
        עד שתמחקו. אין מחיקה אוטומטית. היוצא מן הכלל הוא היסטוריית המרוצים, שנשארת לצמיתות —
        ראו "היסטוריה היא לצמיתות" בתנאי השימוש.
      </p>

      <h3>הזכויות שלכם</h3>
      <p>
        אתם יכולים למחוק את כל מה שלכם בלחיצה אחת, בטאב "קרדיטים" כאן למעלה. המחיקה מסירה את כל
        המודלים ואת כל הרישומים לאליפות, ומסירה אתכם ממרוצים עתידיים.
      </p>

      {CONTACT ? (
        <p>
          לשאלות: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </p>
      ) : (
        <p className="muted">
          לשאלות בנוגע לפרטיות ניתן לפנות למפעיל האתר.
        </p>
      )}
    </>
  );
}

function Notices() {
  const [uid, setUid] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState(false);
  const auth = useSyncExternalStore(subscribeAuth, getAuthView);
  const showToast = useApp((s) => s.showToast);
  const go = useApp((s) => s.go);

  useEffect(() => {
    // At the gate, where this page is also reachable, there is no identity to
    // ask for and the arena would wait for one that never comes. Without cloud
    // keys ('off') there is one — the local arena's — and it is worth showing.
    if (auth.phase === 'out') return;
    void getArena()
      .then((a) => a.uid())
      .then(setUid)
      .catch(() => setUid(null));
  }, [auth.phase]);

  const wipe = async () => {
    setBusy(true);
    try {
      const report = await deleteMyData();
      showToast(`נמחקו ${report.models} מודלים ו-${report.entries} רישומים`);
      go('championship');
    } catch {
      showToast('המחיקה נכשלה — נסו שוב');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <h2>הצהרות</h2>
      <p>
        <b>אין לאתר הזה שום קשר לסדרת מרוצים, קבוצה, יצרן או ארגון ספורט אמיתיים</b>, ואין בו
        חסות, שיתוף פעולה או אישור מצד גוף כזה. כל השמות, המסלולים, הקבוצות והרכבים באתר
        בדיוניים או נוצרו על ידי המשתמשים. מבנה התחרות ושיטת הניקוד הם כללי משחק מקובלים
        בענף המוטורי.
      </p>

      <h3>גופנים</h3>
      <ul>
        <li>
          <b>Heebo</b> — Copyright 2014 The Heebo Project Authors. רישיון{' '}
          <a href="/fonts/OFL-Heebo.txt">SIL Open Font License 1.1</a>.
        </li>
        <li>
          <b>JetBrains Mono</b> — Copyright 2020 The JetBrains Mono Project Authors. רישיון{' '}
          <a href="/fonts/OFL-JetBrainsMono.txt">SIL Open Font License 1.1</a>.
        </li>
      </ul>

      <h3>תוכנה</h3>
      <ul>
        <li>React ו-React DOM — רישיון MIT</li>
        <li>Zustand — רישיון MIT</li>
        <li>Vite — רישיון MIT</li>
        <li>Firebase JavaScript SDK — רישיון Apache 2.0</li>
      </ul>
      <p className="muted">
        מנוע הלמידה, הפיזיקה והרשת הנוירונית נכתבו במיוחד לפרויקט הזה. אין שימוש בספריות למידת
        מכונה חיצוניות.
      </p>

      <h3>החשבון שלי</h3>
      {auth.phase !== 'in' ? (
        <p className="muted small">אין חשבון מחובר בדפדפן הזה.</p>
      ) : isLinked(auth) ? (
        <>
          <p className="small">
            מחוברים {auth.email ? <b className="mono">{auth.email}</b> : null} דרך{' '}
            {auth.providers.map(providerLabel).join(' · ')}. אפשר להתחבר עם אותו חשבון מכל מכשיר
            ולמצוא את אותם מודלים ואותן נקודות.
          </p>
          <button className="small" onClick={() => setAccount(true)}>
            ניהול החשבון
          </button>
        </>
      ) : (
        <>
          <p className="small">
            נכנסתם בלי חשבון. הכל עובד כרגיל, אבל הזהות חיה <b>בדפדפן הזה בלבד</b>: ניקוי נתוני
            האתר או מעבר למכשיר אחר מנתקים אתכם ממנה, ומהרכבים והנקודות שלכם באליפות. קישור
            ל-Google או למייל שומר על אותו מזהה ועל הכל מתחתיו.
          </p>
          <button className="small primary" onClick={() => setAccount(true)}>
            קשר חשבון
          </button>
        </>
      )}
      {account && <AccountModal onClose={() => setAccount(false)} />}

      <h3>המזהה שלכם</h3>
      <p className="muted small">
        זה המזהה שהמודלים שלכם שמורים תחתיו. הוא אינו כולל שום פרט אישי, גם כשהחשבון מקושר.
      </p>
      <p className="mono small" style={{ overflowWrap: 'anywhere' }}>
        {uid ?? '—'}
      </p>

      <h3>מחיקת הנתונים שלי</h3>
      <p>
        מוחק את כל המודלים שאימנתם ואת כל הרישומים לאליפות, בדפדפן הזה ובענן. תוצאות של מרוצים
        שכבר נערכו נשארות — היסטוריית האליפות אינה ניתנת לשכתוב.
      </p>
      <div className="row wrap">
        {auth.phase === 'out' ? (
          <span className="muted small">כדי למחוק צריך להיות מחוברים לחשבון שהנתונים שייכים לו.</span>
        ) : confirming ? (
          <>
            <button className="danger" disabled={busy} onClick={() => void wipe()}>
              {busy ? 'מוחק…' : 'כן, למחוק הכל לצמיתות'}
            </button>
            <button className="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              ביטול
            </button>
          </>
        ) : (
          <button className="danger" onClick={() => setConfirming(true)}>
            מחק את כל הנתונים שלי
          </button>
        )}
      </div>
    </>
  );
}
