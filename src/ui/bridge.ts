import {
  DEFAULT_SETTINGS,
  EMPTY_STATS,
  SettingsSchema,
  type PageStats,
  type RuntimeMessage,
  type Settings,
} from "../shared/contracts";

export const isExtension =
  typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
const STORAGE_KEY = "no-slop-preview-settings";

export interface TabState {
  url?: string;
  hostname?: string;
  stats: PageStats;
}

export async function request<T>(message: RuntimeMessage): Promise<T> {
  if (isExtension) {
    const response = await chrome.runtime.sendMessage(message);
    if (typeof response?.error === "string" && response.error)
      throw new Error(response.error);
    return response as T;
  }
  switch (message.type) {
    case "GET_SETTINGS": {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return SettingsSchema.parse(raw ? JSON.parse(raw) : {}) as T;
      } catch {
        return structuredClone(DEFAULT_SETTINGS) as T;
      }
    }
    case "SAVE_SETTINGS": {
      const previous = await request<Settings>({ type: "GET_SETTINGS" });
      const settings = SettingsSchema.parse({
        ...previous,
        ...message.settings,
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      return settings as T;
    }
    case "GET_TAB_STATE":
      return {
        hostname: "preview.example",
        url: "https://preview.example",
        stats: EMPTY_STATS,
      } as T;
    case "HEALTH_CHECK":
      throw new Error(
        "Install the extension to test the detector connection. This preview never contacts a detector.",
      );
    case "RESTORE_PAGE":
    case "RESCAN_PAGE":
      return { ok: true } as T;
    default:
      throw new Error(
        "This action is only available in the installed extension.",
      );
  }
}
