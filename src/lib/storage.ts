import { signal, type Signal } from "@preact/signals";
import {
  pack,
  unpack,
  type State,
  STATE_KEY,
  SHARD_PREFIX,
  MAX_SHARDS,
} from "./encoding";

const LS_PREFIX = "lebedev-places:";
const DEBOUNCE_MS = 300;
const MAX_RETRY = 3;
const BACKOFF_MS = [500, 2000, 5000];

export type SaveStatus = "idle" | "saving" | "error" | "saved";

export interface StorageAdapter {
  load(cityCount: number): Promise<State>;
  save(state: State): Promise<void>;
  readonly status: Signal<SaveStatus>;
  readonly inTelegram: boolean;
}

/* ------------------------------------------------------------------ */
/*  Promise wrappers for the Telegram CloudStorage callback API.       */
/* ------------------------------------------------------------------ */

function csGet(cs: TelegramCloudStorage, key: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    cs.getItem(key, (err, value) => {
      if (err) reject(err);
      else resolve(value || undefined);
    });
  });
}

function csGetMany(
  cs: TelegramCloudStorage,
  keys: string[],
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    cs.getItems(keys, (err, values) => {
      if (err) reject(err);
      else resolve(values ?? {});
    });
  });
}

function csSet(cs: TelegramCloudStorage, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    cs.setItem(key, value, (err, ok) => {
      if (err) reject(err);
      else if (ok === false) reject(new Error("setItem returned false"));
      else resolve();
    });
  });
}

function csRemoveMany(cs: TelegramCloudStorage, keys: string[]): Promise<void> {
  return new Promise((resolve) => {
    if (keys.length === 0) return resolve();
    cs.removeItems(keys, () => resolve());
  });
}

/* ------------------------------------------------------------------ */
/*  Shared debounced + retried writer.                                 */
/* ------------------------------------------------------------------ */

class DebouncedWriter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: State | null = null;
  private inFlight: Promise<void> | null = null;
  constructor(
    private write: (s: State) => Promise<void>,
    private onStatus: (s: SaveStatus) => void,
  ) {}

  schedule(state: State) {
    this.pending = state;
    this.onStatus("saving");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending) return;
    const snapshot = this.pending;
    this.pending = null;
    this.inFlight = this.runWithRetry(snapshot);
    try {
      await this.inFlight;
      // If something new came in while we were writing, schedule another flush.
      if (this.pending) this.schedule(this.pending);
      else this.onStatus("saved");
    } catch {
      this.onStatus("error");
    } finally {
      this.inFlight = null;
    }
  }

  private async runWithRetry(state: State) {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      try {
        await this.write(state);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_RETRY - 1) {
          await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
        }
      }
    }
    throw lastErr;
  }
}

/* ------------------------------------------------------------------ */
/*  Telegram CloudStorage adapter.                                     */
/* ------------------------------------------------------------------ */

class CloudStorageAdapter implements StorageAdapter {
  readonly status = signal<SaveStatus>("idle");
  readonly inTelegram = true;
  private writer: DebouncedWriter;
  private cs: TelegramCloudStorage;

  constructor(cs: TelegramCloudStorage) {
    this.cs = cs;
    this.writer = new DebouncedWriter(
      (s) => this.flushNow(s),
      (st) => (this.status.value = st),
    );
  }

  async load(cityCount: number): Promise<State> {
    try {
      const stateRaw = await csGet(this.cs, STATE_KEY);
      if (!stateRaw) return unpack(cityCount, undefined);
      // Optimistically fetch all possible shards in one call (cheap when empty).
      const shardKeys = Array.from({ length: MAX_SHARDS }, (_, i) => SHARD_PREFIX + i);
      const shardValues = await csGetMany(this.cs, shardKeys);
      return unpack(cityCount, stateRaw, (i) => shardValues[SHARD_PREFIX + i]);
    } catch {
      return unpack(cityCount, undefined);
    }
  }

  save(state: State): Promise<void> {
    this.writer.schedule(state);
    return Promise.resolve();
  }

  private async flushNow(state: State) {
    const packed = pack(state);
    await csSet(this.cs, STATE_KEY, packed.state);
    for (let i = 0; i < packed.shards.length; i++) {
      await csSet(this.cs, SHARD_PREFIX + i, packed.shards[i]!);
    }
    // Clean up unused shard keys when state shrinks back into single-key mode.
    if (packed.shards.length < MAX_SHARDS) {
      const stale = Array.from(
        { length: MAX_SHARDS - packed.shards.length },
        (_, i) => SHARD_PREFIX + (packed.shards.length + i),
      );
      await csRemoveMany(this.cs, stale);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  LocalStorage fallback (used outside Telegram, e.g. local dev).     */
/* ------------------------------------------------------------------ */

class LocalStorageAdapter implements StorageAdapter {
  readonly status = signal<SaveStatus>("idle");
  readonly inTelegram = false;
  private writer: DebouncedWriter;

  constructor() {
    this.writer = new DebouncedWriter(
      (s) => this.flushNow(s),
      (st) => (this.status.value = st),
    );
  }

  async load(cityCount: number): Promise<State> {
    try {
      const stateRaw = localStorage.getItem(LS_PREFIX + STATE_KEY) ?? undefined;
      if (!stateRaw) return unpack(cityCount, undefined);
      const shardLoader = (i: number) =>
        localStorage.getItem(LS_PREFIX + SHARD_PREFIX + i) ?? undefined;
      return unpack(cityCount, stateRaw, shardLoader);
    } catch {
      return unpack(cityCount, undefined);
    }
  }

  save(state: State): Promise<void> {
    this.writer.schedule(state);
    return Promise.resolve();
  }

  private async flushNow(state: State) {
    const packed = pack(state);
    localStorage.setItem(LS_PREFIX + STATE_KEY, packed.state);
    for (let i = 0; i < packed.shards.length; i++) {
      localStorage.setItem(LS_PREFIX + SHARD_PREFIX + i, packed.shards[i]!);
    }
    for (let i = packed.shards.length; i < MAX_SHARDS; i++) {
      localStorage.removeItem(LS_PREFIX + SHARD_PREFIX + i);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Factory.                                                           */
/* ------------------------------------------------------------------ */

export function createStorage(): StorageAdapter {
  const tg = globalThis.window?.Telegram?.WebApp;
  // The standalone telegram-web-app.js exposes a CloudStorage *stub* in any
  // browser, so the mere presence of the object is not proof we're inside a
  // real Telegram client — its setItem will then fail every call. Signed
  // initData is only populated by an actual Telegram client.
  const inTelegram = !!(tg && tg.initData && tg.initData.length > 0);
  if (inTelegram && tg.CloudStorage) return new CloudStorageAdapter(tg.CloudStorage);
  return new LocalStorageAdapter();
}
