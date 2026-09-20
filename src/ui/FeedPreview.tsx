import { useEffect, useRef, useState } from "react";
import { Badge, Button } from "@radix-ui/themes";
import { RotateCcw, Youtube } from "lucide-react";
import type { Settings } from "../shared/contracts";
import { presentCandidate } from "../content/presentation";

export function VideoArt({ kind }: { kind: "repair" | "bait" | "garden" }) {
  if (kind === "repair")
    return (
      <svg
        viewBox="0 0 160 98"
        role="img"
        aria-label="Illustrated repair bench"
      >
        <rect width="160" height="98" fill="#D5D7DB" />
        <rect x="0" y="71" width="160" height="27" fill="#797F89" />
        <rect x="32" y="34" width="87" height="43" rx="6" fill="#273D46" />
        <rect x="38" y="39" width="38" height="28" rx="3" fill="#B3C3B3" />
        <circle cx="91" cy="51" r="9" fill="#192D35" />
        <circle cx="91" cy="51" r="5" fill="#CED2C4" />
        <path
          d="M52 34 65 16h37l9 18"
          fill="none"
          stroke="#273D46"
          strokeWidth="4"
        />
        <path
          d="m15 32 10 47m-10-47 3-8 5 7"
          stroke="#BB7156"
          strokeWidth="6"
        />
        <rect x="129" y="45" width="7" height="31" rx="3" fill="#DAD5BA" />
      </svg>
    );
  if (kind === "garden")
    return (
      <svg
        viewBox="0 0 160 98"
        role="img"
        aria-label="Illustrated green garden"
      >
        <rect width="160" height="98" fill="#CBD7C1" />
        <path d="M0 70 35 43l49 10 22-22 54 22v45H0" fill="#799879" />
        <path d="M0 87 45 71l64 9 51-13v31H0" fill="#4D745D" />
        <path
          d="M42 72V34m0 18c-21-1-21-19-21-19 17-3 21 10 21 10m0 19c21-1 23-19 23-19-17-3-23 10-23 10m70 33V36m0 18c-19 0-23-16-23-16 17-5 23 7 23 7m0 25c21-1 23-19 23-19-17-3-23 10-23 10"
          fill="#3F6652"
          stroke="#355B49"
          strokeWidth="3"
        />
      </svg>
    );
  return (
    <svg
      viewBox="0 0 160 98"
      role="img"
      aria-label="Illustrated clickbait thumbnail"
    >
      <rect width="160" height="98" fill="#F5D954" />
      <path d="m85 0-9 31 21 5-19 24 29 4-18 34h71V0Z" fill="#ED584A" />
      <text
        x="10"
        y="38"
        fill="#34232B"
        fontSize="24"
        fontWeight="900"
        fontFamily="Arial, sans-serif"
      >
        $10,000
      </text>
      <text
        x="10"
        y="60"
        fill="#34232B"
        fontSize="14"
        fontWeight="900"
        fontFamily="Arial, sans-serif"
      >
        WHILE YOU SLEEP?!
      </text>
      <path
        d="m118 76 23-3-4 13m4-13-20 19"
        fill="none"
        stroke="white"
        strokeWidth="5"
      />
    </svg>
  );
}

export function FeedPreview({ settings }: { settings: Settings }) {
  const [processed, setProcessed] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const example = useRef<HTMLDivElement>(null);
  const replayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active =
    settings.enabled &&
    settings.aiSlop &&
    processed &&
    !revealed &&
    settings.threshold <= 0.96;
  useEffect(() => {
    if (!active || !example.current) return;
    const presentation = presentCandidate({
      element: example.current, fingerprint: 'example-slop', preserveContext: false,
      item: { id: 'example-slop', platform: 'youtube', kind: 'video', title: 'Example result', text: '' },
    }, {
      id: 'example-slop', category: 'ai-slop', confidence: .96,
      reasons: ['Mass-produced promises with no useful supporting detail.'],
      signals: { lowQuality: .99, synthetic: .99, clickbait: .99 },
      evidence: { text: true, thumbnail: false, destination: false }, model: 'illustration-only',
    }, settings, () => setRevealed(true), window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    return () => presentation.restore();
  }, [active, settings.mode, settings.animations]);
  useEffect(() => () => clearTimeout(replayTimer.current), []);
  const run = () => {
    clearTimeout(replayTimer.current);
    setRevealed(false);
    setProcessed(false);
    replayTimer.current = setTimeout(() => {
      setProcessed(true);
    }, 350);
  };
  return (
    <section
      className="preview-panel"
      aria-label="Illustrative filter preview"
    >
      <div className="preview-top">
        <span>
          <Youtube size={18} /> A little less noise
        </span>
        <Badge className="demo-pill" color="gray" variant="surface" size="1">Example feed</Badge>
      </div>
      <div className="preview-feed">
        <div className="feed-row">
          <div className="thumbnail">
            <VideoArt kind="repair" />
            <span>18:24</span>
          </div>
          <div className="feed-copy">
            <h4>I fixed my grandfather’s 1974 radio</h4>
            <p>Bench Notes</p>
            <span>A careful repair, start to finish.</span>
          </div>
        </div>
        <div ref={example} className="feed-item-shell">
          <div className="feed-row bait-row">
            <div className="thumbnail">
              <VideoArt kind="bait" />
              <span>08:02</span>
            </div>
            <div className="feed-copy">
              <h4>This AI trick makes $10,000 a day (do NOTHING)</h4>
              <p>Instant Fortune</p>
              <span>Mass-produced, empty promises.</span>
            </div>
          </div>
        </div>
        <div className="feed-row">
          <div className="thumbnail">
            <VideoArt kind="garden" />
            <span>12:46</span>
          </div>
          <div className="feed-copy">
            <h4>What a year of growing a tiny garden taught me</h4>
            <p>Small Outside</p>
            <span>The real work, including the mistakes.</span>
          </div>
        </div>
      </div>
      <div className="preview-bottom">
        <span>
          {active
            ? settings.mode === "hide"
              ? "One complete result removed."
              : "A softer stop. You stay in control."
            : "All example results are visible."}
        </span>
        <Button size="1" variant="ghost" color="gray" onClick={run}>
          <RotateCcw size={13} /> Replay
        </Button>
      </div>
      <p className="preview-disclaimer">
        Illustration only. These examples are pre-labeled; no detector is
        running.
      </p>
    </section>
  );
}
