import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { Dataset } from "@/data/monitorDatasets";

/**
 * The person's videos, newest first: a short row of cards (swipeable on a phone), and
 * "Show all" for a grid of every video. Stills load only once a card is on screen.
 */

const ROW = 4;

function status(d: Dataset, saved: boolean): { label: string; dot: string } {
  const run = d.run;
  if (!saved) return { label: "Not saved", dot: "bg-muted-foreground" };
  if (!run || run.status === "pending") return { label: "Queued", dot: "bg-sand" };
  if (run.status === "processing") return { label: `Analysing ${Math.round(run.progress * 100)}%`, dot: "bg-sand animate-pulse" };
  if (run.status === "failed") return { label: "Failed", dot: "bg-coral-soft" };
  return { label: "Analysed", dot: "bg-bioluminescent" };
}

/** A still from the video, fetched only when the card scrolls into view. */
function Still({ url }: { url: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVisible(true); io.disconnect(); }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // #t=1 makes the browser paint a frame from one second in as the still
  return <video ref={ref} src={visible ? `${url}#t=1` : undefined} preload="metadata" muted playsInline tabIndex={-1}
                className="pointer-events-none h-full w-full object-cover" />;
}

function Card({ d, saved, selected, onSelect, className }: {
  d: Dataset; saved: boolean; selected: boolean; onSelect: () => void; className: string;
}) {
  const s = status(d, saved);
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected}
            className={`group text-left transition-opacity ${selected ? "" : "opacity-75 hover:opacity-100"} ${className}`}>
      <div className={`relative aspect-video overflow-hidden rounded-lg bg-ocean-deep ${selected ? "ring-2 ring-primary" : "ring-1 ring-border"}`}>
        {d.videoUrl && <Still url={d.videoUrl} />}
        <span className="absolute left-1.5 top-1.5 flex items-center gap-1.5 rounded-full bg-background/85 px-2 py-0.5 text-[10px] text-foreground backdrop-blur-sm">
          <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />{s.label}
        </span>
      </div>
      <p className="mt-2 truncate text-sm text-foreground">{d.name}</p>
      <p className="text-xs text-muted-foreground">{d.date}</p>
    </button>
  );
}

function UploadCard({ onUpload, className }: { onUpload: () => void; className: string }) {
  return (
    <button type="button" onClick={onUpload}
            className={`flex aspect-video flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary ${className}`}>
      <Plus className="h-5 w-5" /> Upload a video
    </button>
  );
}

export default function VideoCards({ datasets, selectedId, savedIds, onSelect, onUpload }: {
  datasets: Dataset[]; selectedId: string; savedIds: Set<string>;
  onSelect: (id: string) => void; onUpload: () => void;
}) {
  const [all, setAll] = useState(false);

  // the short row: the newest few, with the selected video swapped in if it's older
  let row = datasets.slice(0, ROW);
  const picked = datasets.find((d) => d.id === selectedId);
  if (picked && !row.includes(picked)) row = [...row.slice(0, ROW - 1), picked];

  const card = (d: Dataset, className: string) => (
    <Card key={d.id} d={d} saved={savedIds.has(d.id)} selected={d.id === selectedId} className={className}
          onSelect={() => { onSelect(d.id); setAll(false); }} />
  );

  return (
    <div className="space-y-3">
      {all ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
          <UploadCard onUpload={onUpload} className="w-full" />
          {datasets.map((d) => card(d, "w-full"))}
        </div>
      ) : (
        <div className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:scroll-px-0 sm:px-0">
          {row.map((d) => card(d, "w-44 shrink-0 snap-start"))}
          <UploadCard onUpload={onUpload} className="w-44 shrink-0 snap-start" />
        </div>
      )}
      {datasets.length > ROW && (
        <button type="button" onClick={() => setAll(!all)} className="text-sm text-primary hover:underline">
          {all ? "Show fewer" : `Show all ${datasets.length} videos`}
        </button>
      )}
    </div>
  );
}
