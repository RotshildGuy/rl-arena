import { decodeWeights } from '../core/nn/serialize';
import { getGame } from '../core/games/registry';
import { getStore, newModelId, type ModelRecord } from '../storage';

/**
 * Models as files.
 *
 * The terms say there is no guaranteed backup, and that was true: a model lived
 * in one browser and in one Firestore document and nowhere else. A file the
 * owner holds is the only backup that survives the service itself.
 *
 * The format is the stored record verbatim, wrapped with a version so a future
 * change can be recognised rather than guessed at.
 */
const FORMAT = 'rl-arena.model';
const VERSION = 1;

interface ModelFile {
  format: typeof FORMAT;
  version: number;
  exportedAt: number;
  model: ModelRecord;
}

export class ModelFileError extends Error {}

function filename(name: string): string {
  const safe = name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'model';
  return `${safe}.rlmodel.json`;
}

export async function exportModel(id: string): Promise<string> {
  const store = await getStore();
  const model = await store.load(id);
  if (!model) throw new ModelFileError('לא הצלחתי לטעון את המודל');

  const payload: ModelFile = { format: FORMAT, version: VERSION, exportedAt: Date.now(), model };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename(model.name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a tick to start before the blob goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return a.download;
}

/**
 * Everything here is checked. A model file is untrusted input — it arrives from
 * a disk, possibly from someone else — and a malformed one must fail with a
 * sentence rather than a stack trace, or worse, a model that races as garbage.
 */
function validate(raw: unknown): ModelRecord {
  if (typeof raw !== 'object' || raw === null) throw new ModelFileError('הקובץ אינו קובץ מודל');
  const file = raw as Partial<ModelFile>;
  if (file.format !== FORMAT) throw new ModelFileError('הקובץ אינו קובץ מודל של RL Arena');
  if (typeof file.version !== 'number' || file.version > VERSION) {
    throw new ModelFileError('הקובץ נוצר בגרסה חדשה יותר של האתר');
  }

  const m = file.model as Partial<ModelRecord> | undefined;
  if (!m || typeof m !== 'object') throw new ModelFileError('הקובץ אינו מכיל מודל');
  if (typeof m.name !== 'string' || typeof m.gameId !== 'string') {
    throw new ModelFileError('פרטי המודל חסרים בקובץ');
  }

  let game;
  try {
    game = getGame(m.gameId);
  } catch {
    throw new ModelFileError(`המודל שייך למשחק שאינו קיים באתר (${m.gameId})`);
  }

  const arch = m.arch;
  if (
    !arch ||
    typeof arch.obsSize !== 'number' ||
    typeof arch.nActions !== 'number' ||
    !Array.isArray(arch.hidden)
  ) {
    throw new ModelFileError('הארכיטקטורה בקובץ אינה תקינה');
  }
  if (arch.obsSize !== game.spec.obsSize || arch.nActions !== game.spec.actions.length) {
    throw new ModelFileError('המודל אומן על פריסת תצפית שאינה תואמת לגרסה הנוכחית');
  }
  if (typeof m.weightsB64 !== 'string' || m.weightsB64.length === 0) {
    throw new ModelFileError('המשקולות חסרות בקובץ');
  }

  // The decisive check: the weights must decode to exactly the parameter count
  // the declared architecture implies. Anything else races as noise.
  const sizes = [arch.obsSize, ...arch.hidden, arch.nActions];
  let expected = 0;
  for (let i = 0; i < sizes.length - 1; i++) expected += sizes[i] * sizes[i + 1] + sizes[i + 1];
  let actual: number;
  try {
    actual = decodeWeights(m.weightsB64).length;
  } catch {
    throw new ModelFileError('לא הצלחתי לקרוא את המשקולות מהקובץ');
  }
  if (actual !== expected) {
    throw new ModelFileError(`המשקולות אינן תואמות לארכיטקטורה (${actual} במקום ${expected})`);
  }

  return m as ModelRecord;
}

/**
 * Import always creates a new model rather than overwriting one. A file dropped
 * in twice gives two models, which is recoverable; a file that silently replaced
 * an afternoon of training would not be.
 */
export async function importModel(file: File): Promise<ModelRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new ModelFileError('הקובץ אינו JSON תקין');
  }

  const model = validate(parsed);
  const store = await getStore();
  const saved: ModelRecord = {
    ...model,
    id: newModelId(),
    name: model.name,
    createdAt: model.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  await store.save(saved);
  return saved;
}
