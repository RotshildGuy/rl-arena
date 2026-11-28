/**
 * The bulk of the pack prizes (season 6), as data: colour variants of the
 * kinds that already draw (trails, flames, wings, rims), more decals, frames
 * and banners, and the closed lists of titles and radio quotes. `shop.ts`
 * turns these into catalogue items; the dictionaries read their words from
 * here too, so an item and its name cannot drift apart.
 *
 * No imports: the dictionaries load this, and `core/` loads the dictionaries.
 *
 * Colour names are nouns (טורקיז, ענבר...), never adjectives, so the Hebrew
 * reads right after a masculine or a feminine word alike.
 */

export type PrizeRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface Shade {
  key: string;
  hex: string;
  he: string;
  en: string;
}

/** Colours for paint-only prizes. The keys go into item ids, so they never change. */
export const SHADES: Shade[] = [
  { key: 'coral', hex: '#ff6f61', he: 'אלמוג', en: 'Coral' },
  { key: 'turquoise', hex: '#2dd4bf', he: 'טורקיז', en: 'Turquoise' },
  { key: 'amber', hex: '#f59e0b', he: 'ענבר', en: 'Amber' },
  { key: 'copper', hex: '#c06a3a', he: 'נחושת', en: 'Copper' },
  { key: 'bronze', hex: '#a46a2e', he: 'ברונזה', en: 'Bronze' },
  { key: 'platinum', hex: '#dfe4ec', he: 'פלטינה', en: 'Platinum' },
  { key: 'crimson', hex: '#c0143c', he: 'ארגמן', en: 'Crimson' },
  { key: 'indigo', hex: '#4f46e5', he: 'אינדיגו', en: 'Indigo' },
  { key: 'lavender', hex: '#b4a7f5', he: 'לבנדר', en: 'Lavender' },
  { key: 'burgundy', hex: '#7f1d3a', he: 'בורדו', en: 'Burgundy' },
  { key: 'cream', hex: '#f5ecd7', he: 'קרם', en: 'Cream' },
  { key: 'ivory', hex: '#fbf7ea', he: 'שנהב', en: 'Ivory' },
  { key: 'charcoal', hex: '#2f333d', he: 'פחם', en: 'Charcoal' },
  { key: 'graphite', hex: '#4a505e', he: 'גרפיט', en: 'Graphite' },
  { key: 'sapphire', hex: '#1e40af', he: 'ספיר', en: 'Sapphire' },
  { key: 'ruby', hex: '#be123c', he: 'אודם', en: 'Ruby' },
  { key: 'mint', hex: '#6ee7b7', he: 'מנטה', en: 'Mint' },
  { key: 'peach', hex: '#ffb38a', he: 'אפרסק', en: 'Peach' },
  { key: 'apricot', hex: '#ff9f43', he: 'משמש', en: 'Apricot' },
  { key: 'honey', hex: '#e8a33d', he: 'דבש', en: 'Honey' },
  { key: 'chocolate', hex: '#6b3f2a', he: 'שוקולד', en: 'Chocolate' },
  { key: 'coffee', hex: '#8b5e3c', he: 'קפה', en: 'Coffee' },
  { key: 'ocean', hex: '#0e7490', he: 'אוקיינוס', en: 'Ocean' },
  { key: 'ice', hex: '#bfe9ff', he: 'קרח', en: 'Ice' },
  { key: 'fog', hex: '#9aa3b5', he: 'ערפל', en: 'Fog' },
  { key: 'cherry', hex: '#d2143a', he: 'דובדבן', en: 'Cherry' },
  { key: 'raspberry', hex: '#e0115f', he: 'פטל', en: 'Raspberry' },
  { key: 'salmon', hex: '#fa8072', he: 'סלמון', en: 'Salmon' },
  { key: 'rose', hex: '#f472b6', he: 'ורד', en: 'Rose' },
  { key: 'steel', hex: '#7b8798', he: 'פלדה', en: 'Steel' },
  { key: 'sand', hex: '#d8c09a', he: 'חול', en: 'Sand' },
  { key: 'denim', hex: '#3b5b92', he: 'ג׳ינס', en: 'Denim' },
  { key: 'electric', hex: '#00b4ff', he: 'חשמל', en: 'Electric' },
  { key: 'magenta', hex: '#e11d8f', he: 'מג׳נטה', en: 'Magenta' },
  { key: 'tangerine', hex: '#ff8c1a', he: 'קלמנטינה', en: 'Tangerine' },
  { key: 'pearl', hex: '#eef0f6', he: 'פנינה', en: 'Pearl' },
  // Not on wings or rims: these read as lap times on a car (purple, green, yellow).
  { key: 'violet', hex: '#a855f7', he: 'סגול', en: 'Violet' },
  { key: 'lime', hex: '#a3e635', he: 'ליים', en: 'Lime' },
  { key: 'emerald', hex: '#10b981', he: 'אזמרגד', en: 'Emerald' },
  { key: 'lemon', hex: '#fde047', he: 'לימון', en: 'Lemon' },
];

/** Shades kept off the car itself (wings, rims), so they never look like a lap time. */
export const TIMING_SHADES = new Set(['violet', 'lime', 'emerald', 'lemon']);

/** A shade's rarity, by its place: the plain ones are common, the metals and gems rarer. */
const SHADE_RARITY: Record<string, PrizeRarity> = {
  platinum: 'epic', sapphire: 'epic', ruby: 'epic', pearl: 'epic', electric: 'epic', bronze: 'rare', copper: 'rare',
  crimson: 'rare', indigo: 'rare', lavender: 'rare', burgundy: 'rare', magenta: 'rare', ocean: 'rare', ice: 'rare',
  steel: 'rare', violet: 'rare', emerald: 'rare',
};
export function shadeRarity(key: string): PrizeRarity {
  return SHADE_RARITY[key] ?? 'common';
}

/** A colour as a trail: see-through, so the track shows under it. */
export function trailValue(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.6)`;
}

/** Flame pairs, "core|outer". */
export const FLAMES: Array<{ key: string; value: string; he: string; en: string; rarity: PrizeRarity }> = [
  { key: 'red', value: '#ffd0c0|#ff2e4d', he: 'להבת אש אדומה', en: 'Red fire flame', rarity: 'common' },
  { key: 'yellow', value: '#fff6c0|#ffb020', he: 'להבת שמש', en: 'Sun flame', rarity: 'common' },
  { key: 'white', value: '#ffffff|#c8d0de', he: 'להבת שלג', en: 'Snow flame', rarity: 'common' },
  { key: 'teal', value: '#d0fff6|#14b8a6', he: 'להבת טורקיז', en: 'Turquoise flame', rarity: 'common' },
  { key: 'coral', value: '#ffe0d8|#ff6f61', he: 'להבת אלמוג', en: 'Coral flame', rarity: 'common' },
  { key: 'amber', value: '#fff0c8|#f59e0b', he: 'להבת ענבר', en: 'Amber flame', rarity: 'common' },
  { key: 'sky', value: '#e6f6ff|#38bdf8', he: 'להבת שמיים', en: 'Sky flame', rarity: 'common' },
  { key: 'rose', value: '#ffe4f1|#f472b6', he: 'להבת ורד', en: 'Rose flame', rarity: 'common' },
  { key: 'copper', value: '#ffe2cc|#c06a3a', he: 'להבת נחושת', en: 'Copper flame', rarity: 'common' },
  { key: 'peach', value: '#fff0e6|#ffb38a', he: 'להבת אפרסק', en: 'Peach flame', rarity: 'common' },
  { key: 'mint', value: '#ecfff6|#6ee7b7', he: 'להבת מנטה', en: 'Mint flame', rarity: 'common' },
  { key: 'lime', value: '#f4ffd6|#a3e635', he: 'להבת ליים', en: 'Lime flame', rarity: 'common' },
  { key: 'ice', value: '#ffffff|#bfe9ff', he: 'להבת קרח', en: 'Ice flame', rarity: 'common' },
  { key: 'tangerine', value: '#fff1dc|#ff8c1a', he: 'להבת קלמנטינה', en: 'Tangerine flame', rarity: 'common' },
  { key: 'violet', value: '#f3e8ff|#a855f7', he: 'להבה סגולה', en: 'Violet flame', rarity: 'rare' },
  { key: 'green', value: '#e6ffe6|#22c55e', he: 'להבה ירוקה', en: 'Green flame', rarity: 'rare' },
  { key: 'indigo', value: '#e6e4ff|#4f46e5', he: 'להבת אינדיגו', en: 'Indigo flame', rarity: 'rare' },
  { key: 'crimson', value: '#ffd6de|#c0143c', he: 'להבת ארגמן', en: 'Crimson flame', rarity: 'rare' },
  { key: 'magenta', value: '#ffe0f2|#e11d8f', he: 'להבת מג׳נטה', en: 'Magenta flame', rarity: 'rare' },
  { key: 'sunset', value: '#ffe08a|#ff2e4d', he: 'להבת שקיעה', en: 'Sunset flame', rarity: 'rare' },
  { key: 'ocean', value: '#c8f4ff|#0e7490', he: 'להבת אוקיינוס', en: 'Ocean flame', rarity: 'rare' },
  { key: 'gold', value: '#fffbe6|#e6b422', he: 'להבת זהב', en: 'Gold flame', rarity: 'rare' },
  { key: 'toxic', value: '#ffffff|#84cc16', he: 'להבה רעילה', en: 'Toxic flame', rarity: 'rare' },
  { key: 'twilight', value: '#ffd6f0|#4f46e5', he: 'להבת דמדומים', en: 'Twilight flame', rarity: 'epic' },
  { key: 'dragon', value: '#ffe08a|#b3122e', he: 'להבת דרקון', en: 'Dragon flame', rarity: 'epic' },
  { key: 'frost', value: '#ffffff|#00b4ff', he: 'להבת כפור', en: 'Frost flame', rarity: 'epic' },
  { key: 'neon', value: '#ffffff|#ff2ea6', he: 'להבת ניאון', en: 'Neon flame', rarity: 'epic' },
  { key: 'ghost', value: '#ffffff|#eef0f6', he: 'להבת רפאים', en: 'Ghost flame', rarity: 'epic' },
  { key: 'solar', value: '#ffffff|#ff9f1a', he: 'להבה סולארית', en: 'Solar flame', rarity: 'epic' },
  { key: 'void', value: '#c8b6ff|#1a1033', he: 'להבת חלל', en: 'Void flame', rarity: 'legendary' },
];

/** Shades for trails (all of them) and for wings and rims (not the timing ones). */
export const TRAIL_SHADES = SHADES.map((s) => s.key);
export const CAR_SHADES = SHADES.filter((s) => !TIMING_SHADES.has(s.key)).map((s) => s.key);

/** More decals: emblem symbols that the sidepods did not carry yet. */
export const DECALS: Array<{ key: string; he: string; en: string; rarity: PrizeRarity }> = [
  { key: 'chevron', he: 'מדבקת חץ כפול', en: 'Chevron decal', rarity: 'common' },
  { key: 'arrow', he: 'מדבקת חץ', en: 'Arrow decal', rarity: 'common' },
  { key: 'heart', he: 'מדבקת לב', en: 'Heart decal', rarity: 'common' },
  { key: 'drop', he: 'מדבקת טיפה', en: 'Drop decal', rarity: 'common' },
  { key: 'mountain', he: 'מדבקת הר', en: 'Mountain decal', rarity: 'rare' },
  { key: 'wheel', he: 'מדבקת גלגל', en: 'Wheel decal', rarity: 'rare' },
];

/** More frames round a driver's place. No green, purple or yellow: the timing tower is where they sit. */
export const FRAMES: Array<{ key: string; he: string; en: string; rarity: PrizeRarity }> = [
  { key: 'copper', he: 'מסגרת נחושת', en: 'Copper frame', rarity: 'common' },
  { key: 'steel', he: 'מסגרת פלדה', en: 'Steel frame', rarity: 'common' },
  { key: 'carbon', he: 'מסגרת קרבון', en: 'Carbon frame', rarity: 'common' },
  { key: 'ruby', he: 'מסגרת אודם', en: 'Ruby frame', rarity: 'rare' },
  { key: 'sapphire', he: 'מסגרת ספיר', en: 'Sapphire frame', rarity: 'rare' },
  { key: 'ice', he: 'מסגרת קרח', en: 'Ice frame', rarity: 'rare' },
  { key: 'platinum', he: 'מסגרת פלטינה', en: 'Platinum frame', rarity: 'epic' },
  { key: 'fire', he: 'מסגרת אש', en: 'Fire frame', rarity: 'legendary' },
];

/** More banners behind the driver's card on the podium. */
export const BANNERS: Array<{ key: string; he: string; en: string; rarity: PrizeRarity }> = [
  { key: 'ocean', he: 'אוקיינוס', en: 'Ocean', rarity: 'common' },
  { key: 'midnight', he: 'חצות', en: 'Midnight', rarity: 'common' },
  { key: 'stripes', he: 'פסי מרוץ', en: 'Racing stripes', rarity: 'common' },
  { key: 'desert', he: 'מדבר', en: 'Desert', rarity: 'common' },
  { key: 'lava', he: 'לבה', en: 'Lava', rarity: 'rare' },
  { key: 'sakura', he: 'פריחה', en: 'Blossom', rarity: 'rare' },
  { key: 'storm', he: 'סערה', en: 'Storm', rarity: 'rare' },
  { key: 'chrome', he: 'כרום', en: 'Chrome', rarity: 'epic' },
  { key: 'neon', he: 'ניאון', en: 'Neon', rarity: 'epic' },
  { key: 'galaxy', he: 'גלקסיה', en: 'Galaxy', rarity: 'legendary' },
];

/** A line under the team's name: a closed list, so there is nothing to moderate. */
export const TITLES: Array<{ key: string; he: string; en: string; rarity: PrizeRarity }> = [
  { key: 'rookie', he: 'טירון מבטיח', en: 'Promising rookie', rarity: 'common' },
  { key: 'steady', he: 'יד יציבה', en: 'Steady hands', rarity: 'common' },
  { key: 'apex', he: 'צייד הקודקודים', en: 'Apex hunter', rarity: 'common' },
  { key: 'pitlane', he: 'כוכב הפיטליין', en: 'Pit lane star', rarity: 'common' },
  { key: 'qualifier', he: 'מלך המקצים', en: 'Qualifying king', rarity: 'common' },
  { key: 'smooth', he: 'חלק כמו משי', en: 'Smooth as silk', rarity: 'common' },
  { key: 'tactician', he: 'הטקטיקן', en: 'The tactician', rarity: 'common' },
  { key: 'tyres', he: 'לוחש לצמיגים', en: 'Tyre whisperer', rarity: 'common' },
  { key: 'clean', he: 'נקי מקירות', en: 'Wall-free', rarity: 'common' },
  { key: 'climber', he: 'מטפס המקומות', en: 'Place climber', rarity: 'common' },
  { key: 'calm', he: 'קר רוח', en: 'Cool head', rarity: 'common' },
  { key: 'engineer', he: 'המהנדס', en: 'The engineer', rarity: 'common' },
  { key: 'dreamer', he: 'חולם על פודיום', en: 'Podium dreamer', rarity: 'common' },
  { key: 'learner', he: 'לומד מהר', en: 'Quick learner', rarity: 'common' },
  { key: 'sunday', he: 'נהג של שבת', en: 'Weekend driver', rarity: 'common' },
  { key: 'gentle', he: 'ג׳נטלמן במסלול', en: 'Gentleman racer', rarity: 'common' },
  { key: 'lines', he: 'אמן הקווים', en: 'Master of lines', rarity: 'common' },
  { key: 'patient', he: 'סבלני עד הסוף', en: 'Patient to the end', rarity: 'common' },
  { key: 'fan', he: 'אהוב הקהל', en: 'Crowd favourite', rarity: 'common' },
  { key: 'grip', he: 'מלך האחיזה', en: 'King of grip', rarity: 'common' },
  { key: 'overtaker', he: 'מומחה עקיפות', en: 'Overtaking expert', rarity: 'rare' },
  { key: 'rain', he: 'רוקד בגשם', en: 'Rain dancer', rarity: 'rare' },
  { key: 'comeback', he: 'מלך הקאמבק', en: 'Comeback king', rarity: 'rare' },
  { key: 'polesitter', he: 'אוהב פול', en: 'Pole lover', rarity: 'rare' },
  { key: 'lap', he: 'צייד ההקפה המהירה', en: 'Fastest lap hunter', rarity: 'rare' },
  { key: 'neural', he: 'מוח עצבי', en: 'Neural mind', rarity: 'rare' },
  { key: 'reward', he: 'אדון התגמולים', en: 'Reward master', rarity: 'rare' },
  { key: 'defender', he: 'חומה בצורה', en: 'Rock-solid defender', rarity: 'rare' },
  { key: 'slipstream', he: 'רוכב הסליפסטרים', en: 'Slipstream rider', rarity: 'rare' },
  { key: 'marathon', he: 'רץ למרחקים', en: 'Long-distance runner', rarity: 'rare' },
  { key: 'sniper', he: 'צלף הבלימות', en: 'Braking sniper', rarity: 'rare' },
  { key: 'professor', he: 'הפרופסור', en: 'The professor', rarity: 'epic' },
  { key: 'machine', he: 'מכונת ניצחונות', en: 'Winning machine', rarity: 'epic' },
  { key: 'storm', he: 'סערה במסלול', en: 'Storm on track', rarity: 'epic' },
  { key: 'maestro', he: 'המאסטרו', en: 'The maestro', rarity: 'epic' },
  { key: 'unstoppable', he: 'בלתי ניתן לעצירה', en: 'Unstoppable', rarity: 'epic' },
  { key: 'champion', he: 'אלוף בהתהוות', en: 'Champion in the making', rarity: 'epic' },
  { key: 'goat', he: 'הגדול מכולם', en: 'Greatest of all time', rarity: 'legendary' },
  { key: 'immortal', he: 'בן אלמוות', en: 'Immortal', rarity: 'legendary' },
];

/** What the driver says on the radio after a win: a closed list. */
export const QUOTES: Array<{ key: string; he: string; en: string; rarity: PrizeRarity }> = [
  { key: 'yes', he: 'כן! כן! כן!', en: 'Yes! Yes! Yes!', rarity: 'common' },
  { key: 'car', he: 'איזה רכב, איזה רכב!', en: 'What a car, what a car!', rarity: 'common' },
  { key: 'thanks', he: 'תודה, חבר׳ה!', en: 'Thank you, guys!', rarity: 'common' },
  { key: 'simply', he: 'פשוט ככה.', en: 'Just like that.', rarity: 'common' },
  { key: 'wow', he: 'וואו, איזה מרוץ!', en: 'Wow, what a race!', rarity: 'common' },
  { key: 'home', he: 'מביאים אותה הביתה!', en: 'Bringing it home!', rarity: 'common' },
  { key: 'tyres', he: 'הצמיגים החזיקו עד הסוף!', en: 'The tyres held to the end!', rarity: 'common' },
  { key: 'fun', he: 'היה כיף, היה כיף!', en: 'That was fun, that was fun!', rarity: 'common' },
  { key: 'again', he: 'עוד פעם? בשמחה!', en: 'Again? Happily!', rarity: 'common' },
  { key: 'plan', he: 'התוכנית עבדה בדיוק!', en: 'The plan worked perfectly!', rarity: 'common' },
  { key: 'love', he: 'אני אוהב את הרכב הזה!', en: 'I love this car!', rarity: 'common' },
  { key: 'step', he: 'צעד אחרי צעד.', en: 'Step by step.', rarity: 'common' },
  { key: 'hard', he: 'זה לא היה קל, אבל עשינו את זה!', en: 'Not easy, but we did it!', rarity: 'common' },
  { key: 'faster', he: 'הלוואי והיו עוד הקפות!', en: 'I wish there were more laps!', rarity: 'common' },
  { key: 'mom', he: 'אמא, ראית?', en: 'Mum, did you see?', rarity: 'common' },
  { key: 'lights', he: 'מכיבוי האורות ידעתי.', en: 'I knew it from lights out.', rarity: 'common' },
  { key: 'breathe', he: 'רגע, תנו לנשום...', en: 'Hang on, let me breathe...', rarity: 'common' },
  { key: 'dream', he: 'זה חלום שמתגשם!', en: 'A dream come true!', rarity: 'common' },
  { key: 'perfect', he: 'מרוץ מושלם!', en: 'A perfect race!', rarity: 'rare' },
  { key: 'reward', he: 'כל התגמולים השתלמו!', en: 'Every reward paid off!', rarity: 'rare' },
  { key: 'training', he: 'כל האימונים בשביל הרגע הזה.', en: 'All that training for this moment.', rarity: 'rare' },
  { key: 'gap', he: 'מה הפער? לא משנה, ניצחנו!', en: "What's the gap? Never mind, we won!", rarity: 'rare' },
  { key: 'mirrors', he: 'לא ראיתי אף אחד במראות.', en: 'Saw nobody in my mirrors.', rarity: 'rare' },
  { key: 'rain', he: 'שיבוא גשם, לא אכפת לי!', en: 'Let it rain, I do not mind!', rarity: 'rare' },
  { key: 'neurons', he: 'כל נוירון עבד היום!', en: 'Every neuron fired today!', rarity: 'rare' },
  { key: 'whoo', he: 'יוהוווו!', en: 'Woohoooo!', rarity: 'rare' },
  { key: 'box', he: 'בוקס, בוקס... סתם, ניצחנו!', en: 'Box, box... just kidding, we won!', rarity: 'rare' },
  { key: 'history', he: 'עשינו היסטוריה!', en: 'We made history!', rarity: 'epic' },
  { key: 'speechless', he: 'אין לי מילים. אין לי מילים!', en: 'No words. I have no words!', rarity: 'epic' },
  { key: 'stars', he: 'היום הכוכבים הסתדרו.', en: 'Today the stars lined up.', rarity: 'epic' },
  { key: 'legend', he: 'ככה נולדת אגדה.', en: 'That is how a legend is born.', rarity: 'legendary' },
];

export interface PrizeRow {
  id: string;
  kind: 'trail' | 'flame' | 'wing' | 'rim' | 'decal' | 'frame' | 'banner' | 'title' | 'quote';
  value: string;
  rarity: PrizeRarity;
  he: string;
  en: string;
}

/** Every prize in this file, as catalogue rows with their words. */
export function prizeRows(): PrizeRow[] {
  const rows: PrizeRow[] = [];
  const shade = (k: string) => SHADES.find((s) => s.key === k)!;
  for (const k of TRAIL_SHADES) {
    const s = shade(k);
    rows.push({ id: `trail-${k}`, kind: 'trail', value: trailValue(s.hex), rarity: shadeRarity(k), he: `שובל ${s.he}`, en: `${s.en} trail` });
  }
  for (const f of FLAMES) rows.push({ id: `flame-${f.key}`, kind: 'flame', value: f.value, rarity: f.rarity, he: f.he, en: f.en });
  for (const k of CAR_SHADES) {
    const s = shade(k);
    rows.push({ id: `wing-${k}`, kind: 'wing', value: s.hex, rarity: shadeRarity(k), he: `כנפיים ${s.he}`, en: `${s.en} wings` });
  }
  for (const k of CAR_SHADES) {
    const s = shade(k);
    rows.push({ id: `rim-${k}`, kind: 'rim', value: s.hex, rarity: shadeRarity(k), he: `חישוקי ${s.he}`, en: `${s.en} rims` });
  }
  for (const d of DECALS) rows.push({ id: `decal-${d.key}`, kind: 'decal', value: d.key, rarity: d.rarity, he: d.he, en: d.en });
  for (const f of FRAMES) rows.push({ id: `frame-${f.key}`, kind: 'frame', value: f.key, rarity: f.rarity, he: f.he, en: f.en });
  for (const b of BANNERS) rows.push({ id: `banner-${b.key}`, kind: 'banner', value: b.key, rarity: b.rarity, he: b.he, en: b.en });
  for (const x of TITLES) rows.push({ id: `title-${x.key}`, kind: 'title', value: '', rarity: x.rarity, he: x.he, en: x.en });
  for (const x of QUOTES) rows.push({ id: `quote-${x.key}`, kind: 'quote', value: '', rarity: x.rarity, he: x.he, en: x.en });
  return rows;
}

/** The names of these prizes in one language, for the dictionaries. */
export function prizeWords(lang: 'he' | 'en'): Record<string, string> {
  return Object.fromEntries(prizeRows().map((r) => [r.id, r[lang]]));
}
