# מה נשאר לבעל הפרויקט לעשות

דברים שאי אפשר לעשות מהקוד: הם בקונסולה של Firebase, ב-GitHub או על מכשיר אמיתי. לפי סדר חשיבות.

## 0. הכתובת החדשה rl-arena.web.app

- [ ] בקונסולה: Authentication ← Settings ← Authorized domains ← **Add domain** ← `rl-arena.web.app`.
  בלי זה הכניסה עם Google לא עובדת בכתובת החדשה (בישנה היא ממשיכה לעבוד).

## 1. לפני יום ראשון 25.10 (סבב 42)

- [ ] **לבדוק שהכללים של `seasons` לא נעולים ל-`S1`.** מסבב 42 המרוצים נשמרים תחת `seasons/S2/...`.
  אם ב-`firestore.rules` כתוב `match /seasons/S1/...` במפורש, צריך להחליף ל-`match /seasons/{season}/...`.
  בלי זה לא יישמר אף מרוץ מיום ראשון.
- [ ] **לבדוק שהכללים של כרטיס מרוץ לא מגבילים שדות.** כרטיס חדש מכיל שני שדות שלא היו קודם:
  `physics` (מסבב 42) ו-`fingerprints` (זיהוי העתקות). אם יש בכלל של `races/{raceId}` בדיקת
  `keys().hasOnly([...])`, צריך להוסיף אליה את שניהם.

## 2. כללי Firestore חדשים לפרסום

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

// התראות (2.3)
match /pushTokens/{token} {
  allow create, update: if request.auth != null
    && request.resource.data.uid == request.auth.uid
    && request.resource.data.token == token;
  allow delete: if request.auth != null && resource.data.uid == request.auth.uid;
}

// חנות (6.1-6.3)
match /shop/{uid} {
  allow read: if true;
  allow write: if request.auth != null && request.auth.uid == uid
    && request.resource.data.keys().hasOnly(['purchases', 'equipped', 'updatedAt'])
    && request.resource.data.purchases.size() <= 100;
}
```

- [ ] **להוסיף את המזהה שלך ל-`admins()`** (אם עוד לא שם). המזהה מופיע באתר תחת מידע ← קרדיטים.
  רק כך תראה את מדדי השימור (מידע ← קרדיטים) ואת כל הפניות (עמוד "באג או רעיון?").

## 3. התראות דחיפה (2.3)

הקוד כבר באתר, והכפתור מוסתר עד שהשלבים האלה נעשים:

- [ ] לעבור לתוכנית **Blaze** (תשלום לפי שימוש). פונקציות מתוזמנות לא רצות בתוכנית החינמית.
  בכמויות של האתר הזה העלות צפויה להיות אפס או סנטים בודדים בחודש.
- [ ] בקונסולה: Project settings ← Cloud Messaging ← Web Push certificates ← **Generate key pair**.
- [ ] ב-GitHub: Settings ← Secrets and variables ← Actions ← Variables, להוסיף
  `VITE_FIREBASE_VAPID_KEY` (המפתח מהשלב הקודם) ולוודא שקיים `VITE_FIREBASE_MESSAGING_SENDER_ID`.
- [ ] לפרוס את הפונקציות ממחשב עם firebase-tools:
  ```bash
  cd functions && npm install && cd ..
  firebase deploy --only functions
  ```
  הפונקציות מוגדרות לאזור `me-west1` (תל אביב). אם הפריסה מתלוננת על האזור, להחליף את
  `REGION` ב-`functions/index.js` ל-`europe-west1`.
- [ ] לבדוק באנדרואיד: להפעיל התראות באתר, לסגור אותו, ולחכות ל-19:45.
- [x] (בוצע 21.10) **אם הפונקציות כבר פרוסות:** לפרוס אותן שוב (אותה פקודה), כדי שתתווסף `feedbackReply` - ההתראה
  לשולח כשפנייה שלו מקבלת תשובה או שינוי סטטוס. לבדוק: לשלוח פנייה מהטלפון, לענות עליה מהמחשב.

## 4. לבדוק על מכשירים אמיתיים

את אלה בדקתי רק בדפדפן אוטומטי, לא בטלפון:

- [ ] "הוסף ליומן": שהקובץ נפתח ביומן של iPhone, והקישור ל-Google Calendar יוצר אירוע יומי ב-20:00.
- [ ] "↗ שתף" בכרטיס "מה קרה לרכב שלך": שבטלפון נפתח תפריט השיתוף עם התמונה.
- [ ] תצוגה מקדימה של קישור בוואטסאפ (וואטסאפ שומר במטמון; קישור חדש או `?v=2` עוזר לראות את החדש).
- [ ] התקנה: "הוספה למסך הבית" באייפון ובאנדרואיד, ושהאייקון נראה טוב.
- [ ] העיצוב הבהיר במסך השידור ובמסך המשחק (נשארים כהים בכוונה).

## 5. החלטות שנשארו פתוחות

מה מהתוכנית לא נעשה, ולמה:

- **5.1 צפייה בלי כניסה בכלל:** נעשה חלקית. יש כפתור "קודם לצפות במרוץ האחרון" שנכנס בלי חשבון
  ופותח את השידור. צפייה לגמרי בלי זהות דורשת לבדוק שהכללים מתירים קריאה בלי `request.auth`,
  ולשנות את מסך הכניסה כך שלא יעמוד לפני הכל.
- **5.4 אנגלית:** לא נעשה. כל המחרוזות כתובות ישירות בקוד, והעברה לקובץ תרגום היא עבודה גדולה.
- **4.4 מסלולים חדשים ואתגר שבועי:** לא נעשה. מסלול חדש משנה את סבב המסלולים, ולכן צריך להחליט
  מאיזה סבב הוא נכנס, כדי לא לשנות מרוצים שכבר נערכו.
- **6.2, חלק:** סמל קבוצה, אנימציית ניצחון ו"רוח רפאים" עוד לא נבנו.
- **6.4 סטאפים:** לא נעשה. דורש פרמטרים לפיזיקה של כל רכב ובדיקה שגז מלא מפסיד בכל אחד.
- **נהגי הבית:** אומנו כאן ב-GA. הם מסיימים את רוב המרוצים, אבל במסלול הטכני הם עדיין פורשים
  הרבה בתנועה. אפשר לאמן אותם מחדש: `npx tsx scripts/trainHouse.ts house-4 aggressive 300`.
