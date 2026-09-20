import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/shared/contracts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("settings UI bridge", () => {
  it("surfaces background error envelopes without requiring an ok flag", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        id: "test-extension",
        sendMessage: vi
          .fn()
          .mockResolvedValue({ error: "Storage is unavailable." }),
      },
    });
    const { request } = await import("../src/ui/bridge");
    await expect(
      request({ type: "SAVE_SETTINGS", settings: { enabled: false } }),
    ).rejects.toThrow("Storage is unavailable.");
  });

  it("preserves unrelated preview preferences when a partial update is saved", async () => {
    vi.stubGlobal("chrome", undefined);
    let saved = JSON.stringify({
      ...DEFAULT_SETTINGS,
      threshold: 0.95,
      humanSlop: false,
      allowlist: ["example.com"],
    });
    vi.stubGlobal("localStorage", {
      getItem: () => saved,
      setItem: (_key: string, value: string) => {
        saved = value;
      },
    });
    const { request } = await import("../src/ui/bridge");
    await request({ type: "SAVE_SETTINGS", settings: { animations: false } });
    expect(JSON.parse(saved)).toMatchObject({
      animations: false,
      threshold: 0.95,
      humanSlop: false,
      allowlist: ["example.com"],
    });
  });

  it("never contacts a service from the local UI preview", async () => {
    vi.stubGlobal("chrome", undefined);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { request } = await import("../src/ui/bridge");
    await expect(request({ type: "HEALTH_CHECK" })).rejects.toThrow(
      "This preview never contacts a provider or detector",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("scrubs existing credentials from preview storage before returning settings", async () => {
    vi.stubGlobal("chrome", undefined);
    let saved = JSON.stringify({ ...DEFAULT_SETTINGS, openRouterKey: "old-preview-key", serviceToken: "old-service-token", consent: true });
    vi.stubGlobal("localStorage", {
      getItem: () => saved,
      setItem: (_key: string, value: string) => { saved = value; },
    });
    const { request } = await import("../src/ui/bridge");
    expect(await request({ type: "GET_SETTINGS" })).toMatchObject({ openRouterKey: "", serviceToken: "", consent: false });
    expect(saved).not.toContain("old-preview-key");
    expect(saved).not.toContain("old-service-token");
  });

  it("refuses to persist credentials or analysis consent from preview updates", async () => {
    vi.stubGlobal("chrome", undefined);
    let saved = JSON.stringify(DEFAULT_SETTINGS);
    vi.stubGlobal("localStorage", {
      getItem: () => saved,
      setItem: (_key: string, value: string) => { saved = value; },
    });
    const { request } = await import("../src/ui/bridge");
    await request({ type: "SAVE_SETTINGS", settings: { openRouterKey: "new-preview-key", serviceToken: "new-service-token", consent: true, threshold: 0.7 } });
    expect(JSON.parse(saved)).toMatchObject({ openRouterKey: "", serviceToken: "", consent: false, threshold: 0.7 });
    expect(saved).not.toContain("new-preview-key");
    expect(saved).not.toContain("new-service-token");
  });
});
