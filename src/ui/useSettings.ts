import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, type Settings } from "../shared/contracts";
import { isExtension, request } from "./bridge";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(
    structuredClone(DEFAULT_SETTINGS),
  );
  const latest = useRef(settings);
  const confirmed = useRef(settings);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState("");
  const [error, setError] = useState("");
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const revision = useRef(0);
  useEffect(() => {
    request<Settings>({ type: "GET_SETTINGS" })
      .then((value) => {
        latest.current = value;
        confirmed.current = value;
        setSettings(value);
        setLoaded(true);
      })
      .catch((reason) => {
        setError(reason.message);
        setLoaded(true);
      });
  }, []);
  const update = (patch: Partial<Settings>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setSettings(next);
    setSaveState("Saving…");
    setError("");
    const currentRevision = ++revision.current;
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        try {
          const saved = await request<Settings>({
            type: "SAVE_SETTINGS",
            settings: patch,
          });
          confirmed.current = saved;
          if (currentRevision === revision.current) {
            latest.current = saved;
            setSettings(saved);
            setSaveState(
              isExtension ? "Changes saved" : "Saved in this preview",
            );
          }
          return true;
        } catch (reason) {
          if (currentRevision === revision.current) {
            latest.current = confirmed.current;
            setSettings(confirmed.current);
            setSaveState("");
            setError(
              reason instanceof Error
                ? reason.message
                : "Could not save changes. Try again.",
            );
          }
          return false;
        }
      });
    return queue.current;
  };
  return { settings, update, loaded, saveState, error };
}
