# מה נשאר לבעל הפרויקט לעשות

דברים שאי אפשר לעשות מהקוד: הם בקונסולה של Firebase, ב-GitHub או על מכשיר אמיתי. לפי סדר חשיבות.

## 0. הכתובת החדשה rl-arena.web.app

- [x] (נבדק 22.10: הדומיין ברשימה) בקונסולה: Authentication ← Settings ← Authorized domains ← **Add domain** ← `rl-arena.web.app`.
  בלי זה הכניסה עם Google לא עובדת בכתובת החדשה (בישנה היא ממשיכה לעבוד).

## 0.0 המרוצים עוברים לשרת - לפי הסדר הזה, באותו יום, לפני 19:55

מהרגע שהגרסה הזו באוויר, הדפדפנים מפסיקים להריץ את המרוץ ורק השרת מריץ אותו. לכן הסדר חשוב:

1. [x] (בוצע 22.10: `raceResult` פרוסה ב-`me-west1`) **לפרוס את הפונקציות:** `npm ci`, ואז `cd functions && npm install && cd ..`, ואז
   `firebase deploy --only functions`. הפריסה בונה קודם את הקובץ שמריץ את המרוץ (`npm run build:functions`).
2. [x] (בוצע 22.10, PR #7) **למזג ל-main** (האתר עולה לבד).
3. [x] (בוצע 22.10, אחרי שהאתר עלה) **לפרסם את כללי Firestore** (`firebase deploy --only firestore:rules`). הכללים החדשים כבר
   בקובץ המקומי `firestore.rules` ונבדקו באמולטור. זה הצעד שבאמת סוגר את הזיוף ומסתיר את המשקולות.
4. [ ] **(זה מה שנשאר לך)** **להריץ ב-GitHub את הפעולה Backfill replays** (Actions ← Backfill replays ← Run workflow).
   היא מקליטה צפייה חוזרת לכל מרוץ שכבר נערך. אם היא נכשלת בשגיאת הרשאה, לתת לחשבון השירות שב-
   `FIREBASE_SERVICE_ACCOUNT` את התפקיד **Cloud Datastore User** ב-IAM. מרוץ שמדווח `mismatch` יישאר
   בלי צפייה חוזרת (התוצאה והטבלאות נשארות).

## 0.1 הרשאה לחשבון השירות של הפריסה

- [ ] בקונסולה של Google Cloud: IAM ← החשבון שב-`FIREBASE_SERVICE_ACCOUNT` (בפרויקט אין
  חשבון `github-action-...`, אז זה כמעט בטוח `firebase-adminsdk-fbsvc@reinforcement-learning-ed0ed.iam.gserviceaccount.com`) ← Edit ← Add role ←
  **Service Usage Viewer**. מגרסה 15.34.1 של firebase-tools הפריסה בודקת שה-API של Hosting פעיל,
  ובלי ההרשאה הזו היא נכשלת ב-403. עד אז שתי הפעולות ב-GitHub נעולות על 15.34.0 (`firebaseToolsVersion`
  ב-`deploy.yml` וב-`preview.yml`), ואחרי הוספת ההרשאה אפשר להסיר את הנעילה.

## 1. לפני יום ראשון 25.10 (סבב 42)

- [x] (נבדק 22.10: הכלל הוא `seasons/{seasonId}/...`) **לבדוק שהכללים של `seasons` לא נעולים ל-`S1`.** מסבב 42 המרוצים נשמרים תחת `seasons/S2/...`.
  אם ב-`firestore.rules` כתוב `match /seasons/S1/...` במפורש, צריך להחליף ל-`match /seasons/{season}/...`.
  בלי זה לא יישמר אף מרוץ מיום ראשון.
- [x] (נבדק 22.10: אין `hasOnly` בכלל של `races`) **לבדוק שהכללים של כרטיס מרוץ לא מגבילים שדות.** כרטיס חדש מכיל שני שדות שלא היו קודם:
  `physics` (מסבב 42) ו-`fingerprints` (זיהוי העתקות). אם יש בכלל של `races/{raceId}` בדיקת
  `keys().hasOnly([...])`, צריך להוסיף אליה את שניהם.

## 2. כללי Firestore חדשים לפרסום (בוצע)

נבדק 22.10: הכללים הפרוסים כוללים את כל הבלוקים שלמטה, והמזהה שלך ב-`admins()`.

כל אחד מתועד גם ב-README ליד הפיצ'ר שלו. בלי הכלל הפיצ'ר פשוט לא עובד (בלי להפיל שום דבר אחר).
להוסיף בתוך `match /databases/{database}/documents`:

```
// מדדי שימור (0.1)
match /metrics/{day}/events/{id} {
  allow read: if request.auth != null && request.auth.uid in admins();
  allow create: if request.auth != null
    && id == request.auth.uid + '_' + request.resource.data.event
    && request.resource.data.uid == request.auth.uid
    && request.resource.data.day == day
    && request.resource.data.event in ['visit', 'train', 'save', 'enter', 'watch']
    && request.resource.data.keys().hasOnly(['uid', 'event', 'day']);
}

// פניות: באגים ורעיונות
match /feedback/{id} {
  allow create: if request.auth != null
    && request.resource.data.uid == request.auth.uid
    && request.resource.data.kind in ['bug', 'idea', 'other']
    && request.resource.data.status == 'new'
    && request.resource.data.text is string
    && request.resource.data.text.size() >= 10
    && request.resource.data.text.size() <= 2000
    && request.resource.data.keys().hasOnly(['uid', 'kind', 'text', 'screen', 'device', 'contact', 'createdAt', 'status']);
  allow read: if request.auth != null
    && (resource.data.uid == request.auth.uid || request.auth.uid in admins());
  allow update: if request.auth != null && request.auth.uid in admins()
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'reply']);
}

// ליגות חברים (3.2)
match /leagues/{id} {
  allow read: if request.auth != null;
  allow create: if request.auth != null
    && request.resource.data.owner == request.auth.uid
    && request.resource.data.members == [request.auth.uid]
    && request.resource.data.name is string
    && request.resource.data.name.size() >= 2 && request.resource.data.name.size() <= 32;
  allow update: if request.auth != null
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['members'])
    && request.resource.data.members.size() <= 50
    && (request.resource.data.members.toSet() == resource.data.members.toSet().union([request.auth.uid].toSet())
      || request.resource.data.members.toSet() == resource.data.members.toSet().difference([request.auth.uid].toSet()));
  allow delete: if request.auth != null && resource.data.owner == request.auth.uid;
}

// חנות (6.1-6.3)
match /shop/{uid} {
  allow read: if true;
  allow write: if request.auth != null && request.auth.uid == uid
    && request.resource.data.keys().hasOnly(['purchases', 'equipped', 'updatedAt'])
    && request.resource.data.purchases.size() <= 100;
}
```

- [x] (נבדק 22.10) **להוסיף את המזהה שלך ל-`admins()`** (אם עוד לא שם). המזהה מופיע באתר תחת מידע ← קרדיטים.
  רק כך תראה את מדדי השימור (מידע ← קרדיטים) ואת כל הפניות (עמוד "באג או רעיון?").

## 3. הסרת התראות הדחיפה (2.3)

ההתראות הוסרו מהאתר (הכפתור, הקוד בדפדפן, והפונקציות ב-`functions/index.js`). הפונקציות שכבר
פרוסות ממשיכות לשלוח עד שמוחקים אותן, ולכן:

- [x] (בוצע 22.10: שלוש הפונקציות נמחקו, ואין יותר פונקציות פרוסות) לפרוס את הפונקציות ממחשב עם firebase-tools, אחרי שהמיזוג ב-`main`:
  ```bash
  npm ci
  cd functions && npm install && cd ..
  firebase deploy --only functions
  ```
  הפריסה תשאל אם למחוק את `raceReminder`, `raceResult` ו-`feedbackReply` - לענות כן.
  (או ישירות: `firebase functions:delete raceReminder raceResult feedbackReply --region me-west1`.)
- [x] (בוצע 22.10) ב-`firestore.rules`: למחוק את הבלוק `match /pushTokens/{token}` ולפרסם.
- [ ] בקונסולה ← Firestore: למחוק את האוספים `pushTokens` ו-`pushSent`.
- [ ] ב-GitHub ← Settings ← Secrets and variables ← Actions: אפשר למחוק את `VITE_FIREBASE_VAPID_KEY`.

תוכנית Blaze נשארת - היא בשביל המרוץ בצד השרת.

- [ ] **לפרוס שוב את הפונקציות (הפקודה למעלה, כולל `npm ci`)** כדי שהשרת יריץ את המרוץ ב-20:00 גם
  כשאף אחד לא נכנס לאתר. לבדוק למחרת: בקונסולה ← Functions ← `raceResult` ← Logs, אמורה להופיע שורה
  `S2-R0xx: raced` ב-19:55 (או שום שורה, אם דפדפן הריץ את המרוץ לפני השרת).

## 4. לבדוק על מכשירים אמיתיים

את אלה בדקתי רק בדפדפן אוטומטי, לא בטלפון:

- [ ] "הוסף ליומן": שהקובץ נפתח ביומן של iPhone, והקישור ל-Google Calendar יוצר אירוע יומי ב-20:00.
- [ ] "↗ שתף" בכרטיס "מה קרה לרכב שלך": שבטלפון נפתח תפריט השיתוף עם התמונה.
- [ ] תצוגה מקדימה של קישור בוואטסאפ (וואטסאפ שומר במטמון; קישור חדש או `?v=2` עוזר לראות את החדש).
- [ ] התקנה: "הוספה למסך הבית" באייפון ובאנדרואיד, ושהאייקון נראה טוב.
- [ ] העיצוב הבהיר במסך השידור ובמסך המשחק (נשארים כהים בכוונה).

## 5. החלטות

הוחלט 22.10 (מפורט ב-ROADMAP):

- **5.1 צפייה בלי כניסה בכלל:** לא. נשאר הכפתור "קודם לצפות במרוץ האחרון".
- **5.4 אנגלית:** כן. כפתור ההגדרות מחליף את כפתור הכהה/בהיר, ובו בוחרים עיצוב ושפה.
- **4.4 מסלולים:** מאגר מסלולים גדול. בכל עונה מוגרל מתוכו סבב, והמסלולים הישנים נשמרים כדי
  שמרוצים שכבר נערכו ימשיכו להתנגן בדיוק כמו שהיו. צריך לבנות עוד מסלולים למאגר.
  בוצע (PR #6): שישה מסלולים חדשים, וההגרלה מתחילה **בעונה 3 (סבב 50, יום שני 2.11, שהוגרל לכליה).**
  **המרוץ הראשון על מסלול חדש: יום שלישי 3.11 (סבב 51, טבעת).** עונה 2 (מ-25.10) נשארת על ארבעת המסלולים
  הישנים, כי היא כבר מביאה את פיזיקה 2 ואת קבוצת הבית, וכי לשונית פתוחה עם גרסה ישנה לא מכירה
  מסלול חדש. לכן צריך לפרוס את ה-PR לפני 2.11, והכי טוב כמה ימים קודם. מי שרוצה שההגרלה תתחיל
  כבר בעונה 2: זה קבוע אחד, `TRACK_POOLS[0].fromSeason` ב-`src/core/champ/rotation.ts`
  (ואז מעדכנים את הסבבים המקובעים ב-`scripts/sanity.ts`).
- **6.2:** רוח רפאים - לא. סמל קבוצה - בעונה 2. אנימציית ניצחון - בעונה 3.
- **נהגי הבית:** נשארים חלשים יחסית בכוונה, כדי ששחקנים אמיתיים ינצחו אותם. לא מאמנים מחדש.

עוד פתוח:

- **6.4 סטאפים:** לא נעשה. דורש פרמטרים לפיזיקה של כל רכב ובדיקה שגז מלא מפסיד בכל אחד.
