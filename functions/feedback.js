/*
 * What to tell somebody when their feedback message changes: an answer was
 * written, or its status moved. Pure, so `npm run sanity` checks it; the
 * trigger in index.js only reads the before and after and sends the result.
 */
const STATUS_TEXT = { seen: 'נקראה', done: 'טופלה' };

function preview(text, max = 80) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** { title, body } for the sender, or null when nothing worth telling changed. */
function feedbackChange(before, after) {
  if (!before || !after) return null;
  const replied = (after.reply || '').trim() && (after.reply || '').trim() !== (before.reply || '').trim();
  const moved = after.status !== before.status && STATUS_TEXT[after.status];
  if (!replied && !moved) return null;
  const about = preview(after.text, 40);
  if (replied) {
    return { title: 'קיבלת תשובה לפנייה שלך', body: `${preview(after.reply)}${about ? ` · על: "${about}"` : ''}` };
  }
  return { title: `הפנייה שלך ${STATUS_TEXT[after.status]}`, body: about ? `"${about}"` : 'אפשר לראות את הפרטים בעמוד הפניות.' };
}

module.exports = { feedbackChange };
