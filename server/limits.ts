import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class ServiceError extends Error {
  constructor(public readonly publicMessage: string, public readonly statusCode = 503) { super(publicMessage); }
}

/** A finite queue shared by all callers, including every item in a batch. */
export class WorkGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly capacity: number, private readonly maxPending: number) {}
  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (this.active >= this.capacity) {
      if (this.waiting.length >= this.maxPending) throw new ServiceError('Detector is busy. Please try again shortly.', 429);
      await new Promise<void>((resolve, reject) => {
        const ready = () => { signal?.removeEventListener('abort', abort); resolve(); };
        const abort = () => {
          const position = this.waiting.indexOf(ready);
          if (position !== -1) this.waiting.splice(position, 1);
          reject(new ServiceError('Inspection timed out while waiting. Content was kept.'));
        };
        this.waiting.push(ready);
        signal?.addEventListener('abort', abort, { once: true });
      });
    } else this.active++;
    try { signal?.throwIfAborted(); return await operation(); }
    finally {
      const next = this.waiting.shift();
      if (next) next(); else this.active--;
    }
  }
}

/** Reserve before calling a paid provider. Persisted across restarts, single process. */
export class DailyBudget {
  private day = '';
  private used = 0;
  constructor(private readonly limit: number, private readonly file = '', private readonly now = () => new Date()) {
    if (file) {
      try {
        const saved: unknown = JSON.parse(readFileSync(file, 'utf8'));
        if (!saved || typeof saved !== 'object' || !('day' in saved) || !('used' in saved) || typeof saved.day !== 'string' || typeof saved.used !== 'number' || !Number.isSafeInteger(saved.used) || saved.used < 0) throw new Error('Invalid budget file');
        this.day = saved.day; this.used = saved.used;
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error('Cannot safely read the daily budget ledger. Check BUDGET_FILE.');
      }
    }
  }
  reserve(): void {
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) { this.day = today; this.used = 0; }
    if (this.used >= this.limit) throw new ServiceError('The detector has reached its daily allowance. Please try again tomorrow.', 429);
    this.used++;
    if (this.file) {
      try {
        mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
        const temporary = `${this.file}.${process.pid}.tmp`;
        writeFileSync(temporary, JSON.stringify({ day: this.day, used: this.used }), { mode: 0o600 });
        renameSync(temporary, this.file);
      } catch { throw new ServiceError('The detector could not reserve its usage allowance.'); }
    }
  }
}

export class ExpiringCache<T> {
  private readonly data = new Map<string, { value: T; expires: number }>();
  constructor(private readonly maxEntries: number, private readonly ttlMs: number) {}
  get(key: string): T | undefined {
    const found = this.data.get(key);
    if (!found) return;
    if (found.expires <= Date.now()) { this.data.delete(key); return; }
    this.data.delete(key); this.data.set(key, found);
    return structuredClone(found.value);
  }
  set(key: string, value: T): void {
    this.data.delete(key);
    while (this.data.size >= this.maxEntries) this.data.delete(this.data.keys().next().value!);
    this.data.set(key, { value: structuredClone(value), expires: Date.now() + this.ttlMs });
  }
}
