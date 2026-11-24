"""Records the team radio with Gemini TTS, voice by voice, and picks up where it stopped.

Each voice records every line of one role (the driver's lines, or the pit
wall's) in batches: one request reads a dozen lines with a pause after each,
and the audio is cut at the pauses - the way the Hasbara pipeline records a
whole episode in one request, which keeps inside the free tier's small number
of requests a day. Every cut is checked against the length of its line; a
batch that does not cut cleanly is asked for again, then line by line.

    npx tsx scripts/radioLines.ts       the lines (node_modules/.cache/radioLines.json)
    python scripts/radioGemini.py       records what is missing, in PLAN order

Clips go to public/radio/gemini/, listed in its index.json together with the
voices that have every line of their role - only those are used by the game
(src/ui/raceAudio.ts). Google appends a C2PA provenance box ("made by AI,
SynthID watermark") to the audio; it is cut off, or it plays as static.

When the API refuses (429), the script reads what ran out. A limit per minute
is waited out here. A daily one ends the run: the time it lifts (midnight in
California, when Google resets daily quotas) is written to
node_modules/.cache/radioGemini-blocked.json and the script exits with code 3,
so whoever runs it can come back then.

The key is GOOGLE_KEY in .env.local, sent in a header and never printed. The
lines are public UI text.
"""
import base64
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import wave
from zoneinfo import ZoneInfo

import numpy as np

LINES = "node_modules/.cache/radioLines.json"
OUT = "public/radio/gemini"
BLOCKED = "node_modules/.cache/radioGemini-blocked.json"
MODEL = "gemini-3.8-flash-tts"
SR = 24000
BATCH = 12
# `--max N`: stop after about N requests (to try a batch before spending the day's quota).
MAX_REQUESTS = int(sys.argv[sys.argv.index("--max") + 1]) if "--max" in sys.argv else 10**9

# The order voices are recorded in: the first driver and pit-wall voices,
# then more voices for the drivers, then more for the pit wall.
PLAN = [
    ("driver", "Puck"),
    ("team", "Charon"),
    ("driver", "Fenrir"),
    ("driver", "Sadachbia"),
    ("driver", "Achird"),
    ("driver", "Orus"),
    ("driver", "Umbriel"),
    ("driver", "Charon"),
    ("team", "Orus"),
    ("team", "Umbriel"),
    ("team", "Achird"),
    ("team", "Fenrir"),
    ("team", "Sadachbia"),
    ("team", "Puck"),
]

NOTES = {
    "driver": """# AUDIO PROFILE: A racing driver on team radio
## THE SCENE
Mid-race, inside a loud cockpit, talking to his pit wall over the radio.
### DIRECTOR'S NOTES
Style: a real racing driver, not a narrator: short of breath, fast and punchy. Match each line: thrilled after a pass, angry or shaken after a hit, tense in a fight, joyful at the finish.
Language: Hebrew, native Israeli accent, masculine.
Pacing: every line is a separate radio message. Leave a clear silence of about one second after each line.
#### TRANSCRIPT
""",
    "team": """# AUDIO PROFILE: A race engineer on the pit wall
## THE SCENE
On the pit wall during a race, talking to his driver over the team radio, headset on.
### DIRECTOR'S NOTES
Style: calm, clear and focused, supportive but brief; a little urgency when it matters, warm at the finish. Not a narrator.
Language: Hebrew, native Israeli accent, masculine.
Pacing: every line is a separate radio message. Leave a clear silence of about one second after each line.
#### TRANSCRIPT
""",
}

# What the voice misreads, spelled the way it should sound (on screen it stays as written).
SAY = {"השני": "השֵׁנִי"}


class Blocked(Exception):
    def __init__(self, kind, until, quota):
        super().__init__(f"{kind} quota {quota}, until {until}")
        self.kind, self.until, self.quota = kind, until, quota


def key():
    for line in open(".env.local", encoding="utf-8"):
        if line.strip().startswith("GOOGLE_KEY"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("GOOGLE_KEY not found in .env.local")


def next_pacific_midnight():
    now = dt.datetime.now(ZoneInfo("America/Los_Angeles"))
    nxt = (now + dt.timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
    return nxt.astimezone(dt.timezone.utc)


def classify(body):
    """What a 429 says ran out: ('minute', seconds) or ('day', utc time), and the quota id."""
    try:
        err = json.loads(body)["error"]
    except Exception:
        return "unknown", None, "?"
    quota, delay = "?", None
    for d in err.get("details", []):
        if d.get("@type", "").endswith("QuotaFailure"):
            ids = [v.get("quotaId", "") for v in d.get("violations", [])]
            quota = ",".join(ids) or "?"
        if d.get("@type", "").endswith("RetryInfo"):
            m = re.match(r"([\d.]+)s", d.get("retryDelay", ""))
            delay = float(m.group(1)) if m else None
    if "PerDay" in quota:
        return "day", next_pacific_midnight(), quota
    if "PerHour" in quota:
        return "hour", dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=delay or 3600), quota
    return "minute", delay or 60, quota


def synth(voice, prompt):
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
        },
    }
    for attempt in range(6):
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "x-goog-api-key": key()},
        )
        try:
            data = json.load(urllib.request.urlopen(req, timeout=300))
            return base64.b64decode(data["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", "replace")
            if e.code == 429:
                kind, until, quota = classify(text)
                if kind == "minute":
                    print(f"  per-minute limit ({quota}), waiting {until:.0f}s", flush=True)
                    time.sleep(until + 2)
                    continue
                raise Blocked(kind, until, quota)
            if e.code >= 500:
                time.sleep(10 * (attempt + 1))
                continue
            raise
        except (KeyError, IndexError, urllib.error.URLError, TimeoutError):
            time.sleep(10 * (attempt + 1))
    raise RuntimeError("no audio after retries")


def audio(pcm):
    """The samples, without the C2PA box Google appends after them."""
    i = pcm.find(b"jumb")
    if i >= 4:
        pcm = pcm[: (i - 4) & ~1]
    return np.frombuffer(pcm[: len(pcm) & ~1], np.int16).astype(np.float32) / 32768


def loudness(a, hop):
    n = len(a) // hop
    return np.sqrt((a[: n * hop].reshape(n, hop) ** 2).mean(1))


def split(a, texts):
    """Cut a batch into its lines at the pauses, or None when it does not add up."""
    hop = SR // 100
    on = loudness(a, hop) > 0.01
    idx = np.flatnonzero(on)
    if len(idx) == 0:
        return None
    gaps = [(p + 1, q) for p, q in zip(idx[:-1], idx[1:]) if q - p >= 25]  # at least 0.25 s of quiet
    need = len(texts) - 1
    if len(gaps) < need:
        return None
    # The longest pauses are the ones between lines (asked for: about a second).
    cuts = sorted(sorted(gaps, key=lambda g: g[1] - g[0], reverse=True)[:need])
    edges = [idx[0]] + [x for g in cuts for x in g] + [idx[-1] + 1]
    out = []
    for k, text in enumerate(texts):
        s, e = edges[2 * k], edges[2 * k + 1]
        seconds = (e - s) / 100
        per_char = seconds / max(1, len(text))
        if not (0.025 <= per_char <= 0.22):
            return None
        out.append(a[max(0, s * hop - int(0.08 * SR)): min(len(a), e * hop + int(0.15 * SR))])
    return out


def write_mp3(a, path):
    fade = min(len(a), int(0.02 * SR))
    a = a.copy()
    a[:fade] *= np.linspace(0, 1, fade)
    a[-fade:] *= np.linspace(1, 0, fade)
    pcm = (a * 32767).clip(-32768, 32767).astype(np.int16).tobytes()
    tmp = path + ".wav"
    with wave.open(tmp, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-ac", "1", "-b:a", "48k", path], check=True)
    os.remove(tmp)


def clip_name(voice, who, text):
    return hashlib.sha1(f"{voice}|{who}|{text}".encode("utf-8")).hexdigest()[:12] + ".mp3"


def save_index(index, lines):
    roles = {"driver": [l["text"] for l in lines if l["who"] == "driver"], "team": [l["text"] for l in lines if l["who"] == "team"]}
    complete = {who: [] for who in roles}
    for who, voice in PLAN:
        if voice not in complete[who] and all(f"{voice}|{who}|{t}" in index for t in roles[who]):
            complete[who].append(voice)
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"voices": complete, "clips": index}, f, ensure_ascii=False, indent=0, sort_keys=True)
    return complete


def main():
    lines = json.load(open(LINES, encoding="utf-8"))
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "index.json")
    index = json.load(open(path, encoding="utf-8"))["clips"] if os.path.exists(path) else {}
    index = {k: v for k, v in index.items() if os.path.exists(os.path.join(OUT, v))}
    requests = 0
    try:
        for who, voice in PLAN:
            todo = [l["text"] for l in lines if l["who"] == who and f"{voice}|{who}|{l['text']}" not in index]
            if not todo:
                continue
            print(f"{voice} as {who}: {len(todo)} lines to record", flush=True)
            for b in range(0, len(todo), BATCH):
                if requests >= MAX_REQUESTS:
                    print(f"stopping at --max {MAX_REQUESTS}", flush=True)
                    return
                batch = todo[b: b + BATCH]
                pieces = None
                for _ in range(2):
                    prompt = NOTES[who] + "\n\n".join(spoken(t) for t in batch)
                    requests += 1
                    pieces = split(audio(synth(voice, prompt)), batch)
                    if pieces:
                        break
                    print(f"  batch of {len(batch)} did not cut cleanly, asking again", flush=True)
                if not pieces:
                    print("  recording that batch line by line", flush=True)
                    pieces = []
                    for t in batch:
                        requests += 1
                        a = audio(synth(voice, NOTES[who] + spoken(t)))
                        on = np.flatnonzero(loudness(a, SR // 100) > 0.01)
                        pieces.append(a[max(0, on[0] * 240 - 2000): (on[-1] + 1) * 240 + 3600] if len(on) else a)
                for t, a in zip(batch, pieces):
                    name = clip_name(voice, who, t)
                    write_mp3(a, os.path.join(OUT, name))
                    index[f"{voice}|{who}|{t}"] = name
                complete = save_index(index, lines)
                print(f"  {min(b + BATCH, len(todo))}/{len(todo)} done ({requests} requests so far)", flush=True)
            print(f"{voice} as {who}: complete. Voices ready: {complete}", flush=True)
    except Blocked as e:
        save_index(index, lines)
        os.makedirs(os.path.dirname(BLOCKED), exist_ok=True)
        until = e.until.isoformat() if isinstance(e.until, dt.datetime) else str(e.until)
        json.dump({"kind": e.kind, "quota": e.quota, "until": until, "requests": requests}, open(BLOCKED, "w"))
        print(f"BLOCKED {e.kind} quota {e.quota} until {until} after {requests} requests", flush=True)
        sys.exit(3)
    if os.path.exists(BLOCKED):
        os.remove(BLOCKED)
    print(f"all voices done, {requests} requests", flush=True)


def spoken(text):
    for word, said in SAY.items():
        text = text.replace(word, said)
    return text


main()
