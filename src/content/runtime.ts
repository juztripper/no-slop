import type { RuntimeMessage } from '../shared/contracts';
import type { RuntimeBridge } from './controller';

export function isInvalidatedContext(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /extension context invalidated/i.test(message);
}

/** Reloading an extension leaves its old content scripts in open tabs. Treat
 * their lost runtime as terminal, including synchronous Chrome API throws. */
export function createRuntimeBridge(runtime: Pick<typeof chrome.runtime, 'id' | 'sendMessage'>, onDisconnect: () => void): RuntimeBridge & { isConnected(): boolean } {
  let disconnected = false;
  const disconnect = () => {
    if (disconnected) return;
    disconnected = true;
    onDisconnect();
  };
  const isConnected = () => {
    if (disconnected) return false;
    try { if (runtime.id) return true; } catch { /* Invalidated API objects can throw on access. */ }
    disconnect();
    return false;
  };
  return {
    isConnected,
    async send(message: RuntimeMessage): Promise<unknown> {
      if (!isConnected()) throw new Error('Extension context invalidated.');
      try {
        return await runtime.sendMessage(message);
      } catch (error) {
        if (isInvalidatedContext(error) || !isConnected()) disconnect();
        throw error;
      }
    },
  };
}
