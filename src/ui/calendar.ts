import { israelOffsetAt20, startsAtForRound } from '../core/champ/schedule';

const TZID = 'Asia/Jerusalem';

/**
 * "Add to calendar" for the daily race.
 *
 * The race at lights out is the whole reason to come back, and nothing reminds
 * anybody of it. A calendar entry does, on every phone, without a server, a
 * permission prompt or an account: one daily recurring event with a reminder a
 * quarter of an hour before.
 *
 * The day comes from the calendar's own `startsAtForRound`, so the event
 * starts on the round it is for. The time is written in Israel local time with
 * a time-zone block, not in UTC: the race is at 20:00 in Israel all year, and a
 * daily event pinned to UTC would drift an hour at every clock change.
 */
export const RACE_EVENT_MINUTES = 30;
export const REMINDER_MINUTES = 15;

const TITLE = 'RL Arena - המרוץ היומי';
const DETAILS = 'גרנד פרי של מודלים מאומנים, בשידור חי. המוקדמות כבר נערכו והגריד נעול.';

/** `20260914T170000Z` */
function stamp(at: number): string {
  return new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * `20260914T200000` - wall-clock time in Israel. Only for times on a race
 * evening, where the UTC date and the Israeli date are the same day.
 */
function localStamp(at: number): string {
  const d = new Date(at);
  const offset = israelOffsetAt20(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return stamp(at + offset * 3_600_000).replace('Z', '');
}

/** Israel's rule (see `israelOffsetAt20`), for calendars that do not know the zone. */
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZID}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0300',
  'TZNAME:IDT',
  'DTSTART:19700327T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=FR;BYMONTHDAY=23,24,25,26,27,28,29',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0300',
  'TZOFFSETTO:+0200',
  'TZNAME:IST',
  'DTSTART:19701025T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** iCalendar text values escape backslash, semicolon, comma and newline. */
function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/**
 * RFC 5545 folds content lines at 75 octets - octets, not characters, which is
 * what matters with Hebrew in the summary. A continuation starts with a space.
 */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (size + n > limit) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

/**
 * The event, starting from `round` and repeating every day after it.
 * `url` is where the reminder takes people: the site, which opens on the race.
 */
export function raceCalendarIcs(round: number, url: string, now = Date.now()): string {
  const start = startsAtForRound(round);
  const end = start + RACE_EVENT_MINUTES * 60_000;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RL Arena//Race calendar//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...VTIMEZONE,
    'BEGIN:VEVENT',
    // Stable, so importing the file twice updates one event instead of adding a second.
    'UID:daily-race@rl-arena',
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;TZID=${TZID}:${localStamp(start)}`,
    `DTEND;TZID=${TZID}:${localStamp(end)}`,
    'RRULE:FREQ=DAILY',
    `SUMMARY:${escapeText(TITLE)}`,
    `DESCRIPTION:${escapeText(`${DETAILS}\n${url}`)}`,
    `URL:${url}`,
    `LOCATION:${escapeText(url)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(TITLE)}`,
    `TRIGGER:-PT${REMINDER_MINUTES}M`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/**
 * The same event as a Google Calendar link, for anyone whose phone hands an
 * `.ics` download to the files app instead of the calendar.
 */
export function googleCalendarUrl(round: number, url: string): string {
  const start = startsAtForRound(round);
  const end = start + RACE_EVENT_MINUTES * 60_000;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: TITLE,
    dates: `${localStamp(start)}/${localStamp(end)}`,
    ctz: TZID,
    recur: 'RRULE:FREQ=DAILY',
    details: `${DETAILS}\n${url}`,
    location: url,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Hand the `.ics` to the browser, which passes it to the calendar app. */
export function downloadRaceCalendar(round: number, url: string): void {
  const blob = new Blob([raceCalendarIcs(round, url)], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = 'rl-arena-race.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
