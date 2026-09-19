/** Shared across tabs and persisted in session storage across MV3 worker restarts.
 * Return a delay instead of sleeping inside a service-worker message/fetch. */
export class RequestPacer {
  private serial: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly storage: Pick<typeof chrome.storage.session, 'get' | 'set'>,
    private readonly now = Date.now,
    private readonly intervalMs = 2_000,
  ) {}

  private update(endpoint: string, deferMs?: number): Promise<number> {
    const operation = this.serial.then(async () => {
      const now = this.now();
      const { detectorPacing: saved } = await this.storage.get('detectorPacing');
      const nextAt = saved && typeof saved === 'object' && 'endpoint' in saved && saved.endpoint === endpoint &&
        'nextAt' in saved && typeof saved.nextAt === 'number' && Number.isFinite(saved.nextAt)
        ? Math.min(saved.nextAt, now + 3_600_000) : 0;
      if (deferMs !== undefined) {
        await this.storage.set({ detectorPacing: { endpoint, nextAt: Math.max(nextAt, now + deferMs) } });
        return deferMs;
      }
      if (nextAt > now) return Math.ceil(nextAt - now);
      await this.storage.set({ detectorPacing: { endpoint, nextAt: now + this.intervalMs } });
      return 0;
    });
    this.serial = operation.catch(() => undefined);
    return operation;
  }

  reserve(endpoint: string): Promise<number> { return this.update(endpoint); }
  defer(endpoint: string, milliseconds: number): Promise<number> { return this.update(endpoint, milliseconds); }
}

export function retryDelay(header: string | null, now = Date.now()): number {
  const numeric = header?.trim() ? Number(header) : NaN;
  const milliseconds = Number.isFinite(numeric) ? numeric * 1000 : header ? Date.parse(header) - now : NaN;
  // Allow for whole-second server headers and clock rounding at the window edge.
  return Number.isFinite(milliseconds) && milliseconds >= 0
    ? Math.min(3_600_000, Math.max(1_000, Math.ceil(milliseconds) + 1_000)) : 61_000;
}
