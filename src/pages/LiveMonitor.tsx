import { useState, useEffect, useRef } from "react";
import { Calendar, Clock, Download, Upload as UploadIcon, Loader2, CheckCircle2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/PageHeader";
import { Dataset, DatasetFrame, RunInfo } from "@/data/monitorDatasets";
import DatasetFrameView from "@/components/monitor/DatasetFrameView";
import ProcessingView from "@/components/monitor/ProcessingView";
import VideoCards from "@/components/monitor/VideoCards";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { uploadDataset } from "@/lib/uploadDataset";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";

// Empty stub frame so DatasetFrameView doesn't crash when frames[] is empty.
const EMPTY_FRAME: DatasetFrame = {
  id: 0,
  timestamp: "",
  detections: [],
  frameStats: { fps: 0, inferenceMs: 0, vram: 0 },
};

/** Signed links for many storage paths in one request: path -> url. */
async function signAll(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data } = await supabase.storage.from("datasets").createSignedUrls(paths, 3600);
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl]));
}

/** Latest run per dataset, with a signed URL for the annotated video once done. */
async function loadRuns(datasetIds: string[]): Promise<Record<string, RunInfo>> {
  if (datasetIds.length === 0) return {};
  const { data } = await supabase
    .from("runs")
    .select("id, dataset_id, status, progress, error, annotated_path, fish_tracked, richness")
    .in("dataset_id", datasetIds)
    .order("created_at", { ascending: false });
  const latest = new Map<string, NonNullable<typeof data>[number]>();
  for (const r of data ?? []) if (!latest.has(r.dataset_id)) latest.set(r.dataset_id, r);
  const urls = await signAll([...latest.values()]
    .filter((r) => r.status === "done" && r.annotated_path).map((r) => r.annotated_path as string));
  const out: Record<string, RunInfo> = {};
  for (const r of latest.values()) {
    out[r.dataset_id] = {
      id: r.id, status: r.status, progress: r.progress, error: r.error,
      annotatedUrl: r.annotated_path ? urls[r.annotated_path] : undefined,
      fishTracked: r.fish_tracked, richness: r.richness,
    };
  }
  return out;
}

function runLabel(run?: RunInfo): string {
  if (!run) return "";
  switch (run.status) {
    case "pending": return "Queued for analysis";
    case "processing": return `Analysing ${Math.round(run.progress * 100)}%`;
    case "done": return `Analysed · ${run.fishTracked ?? 0} fish · ${run.richness ?? 0} species`;
    case "failed": return `Analysis failed${run.error ? `: ${run.error}` : ""}`;
  }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m} min ${s.toString().padStart(2, "0")} sec`;
}

function probeVideoMetadata(url: string): Promise<{ duration: number }> {
  return new Promise((resolve) => {
    const vid = document.createElement("video");
    vid.preload = "metadata";
    vid.onloadedmetadata = () => {
      resolve({ duration: vid.duration });
      vid.src = "";
    };
    vid.onerror = () => resolve({ duration: 0 });
    vid.src = url;
  });
}

async function makeDatasetFromFile(file: File, idOverride?: string): Promise<Dataset> {
  const id = idOverride ?? `upload-${Date.now()}`;
  const name = file.name.replace(/\.[^.]+$/, "");
  const rawDate = file.lastModified ? new Date(file.lastModified) : new Date();
  const date = rawDate.toISOString().slice(0, 10);
  const videoUrl = URL.createObjectURL(file);
  const { duration } = await probeVideoMetadata(videoUrl);
  return {
    id,
    name,
    location: "Uploaded",
    date,
    totalFrames: 0,
    duration: duration > 0 ? formatDuration(duration) : "—",
    depth: "—",
    frames: [],
    videoUrl,
  };
}

const LiveMonitor = () => {
  const { user } = useAuth();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [storagePathById, setStoragePathById] = useState<Record<string, string>>({});
  const [datasetToDelete, setDatasetToDelete] = useState<Dataset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [currentFrameIdx, setCurrentFrameIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [viewMode] = useState<"raw" | "waternet">("waternet");
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [hasVideo, setHasVideo] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<"idle" | "uploading" | "finalizing" | "done">("idle");
  const [uploadFileName, setUploadFileName] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blobUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    const urls = blobUrlsRef.current;
    return () => { urls.forEach(URL.revokeObjectURL); };
  }, []);

  // Load the user's saved datasets from Supabase whenever they're authenticated.
  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("datasets")
        .select("id, name, location, capture_date, duration_seconds, storage_path")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error || !data || cancelled) return;

      const loaded: Dataset[] = [];
      const pathByLoadedId: Record<string, string> = {};
      const urls = await signAll(data.map((row) => row.storage_path).filter(Boolean));
      for (const row of data) {
        const url = row.storage_path ? urls[row.storage_path] : undefined;
        if (!url) continue;

        loaded.push({
          id: row.id,
          name: row.name,
          location: row.location ?? "Uploaded",
          date: row.capture_date ?? "—",
          totalFrames: 0,
          duration: row.duration_seconds ? formatDuration(row.duration_seconds) : "—",
          depth: "—",
          frames: [],
          videoUrl: url,
        });
        pathByLoadedId[row.id] = row.storage_path;
      }

      const runs = await loadRuns(loaded.map((d) => d.id));
      for (const d of loaded) d.run = runs[d.id];

      if (cancelled) return;

      setDatasets((prev) => {
        const existingIds = new Set(prev.map((d) => d.id));
        const fresh = loaded.filter((d) => !existingIds.has(d.id));
        return [...fresh, ...prev];
      });
      setStoragePathById((m) => ({ ...m, ...pathByLoadedId }));

      if (loaded.length > 0) {
        setHasVideo(true);
        setSelectedDatasetId((curr) => {
          if (curr && loaded.some((d) => d.id === curr)) return curr;
          return loaded[0].id;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Poll run status while any saved video is still queued or being analysed.
  const unfinished = datasets
    .filter((d) => storagePathById[d.id] && (!d.run || d.run.status === "pending" || d.run.status === "processing"))
    .map((d) => d.id)
    .join(",");
  useEffect(() => {
    if (!user || !unfinished) return;
    const timer = setInterval(async () => {
      const runs = await loadRuns(unfinished.split(","));
      setDatasets((prev) => prev.map((d) => {
        const r = runs[d.id];
        if (!r) return d;
        if (r.status === "done" && d.run?.status !== "done")
          toast({ title: `"${d.name}" is ready`, description: `${r.fishTracked ?? 0} fish tracked, ${r.richness ?? 0} species.` });
        if (r.status === "failed" && d.run?.status !== "failed")
          toast({ title: `"${d.name}" couldn't be analysed`, description: r.error ?? undefined, variant: "destructive" });
        return { ...d, run: r };
      }));
    }, 4000);
    return () => clearInterval(timer);
  }, [user, unfinished]);

  const dataset = datasets.find((d) => d.id === selectedDatasetId);
  const frame = dataset?.frames[currentFrameIdx] ?? EMPTY_FRAME;
  const annotatedUrl = dataset?.run?.annotatedUrl;
  const shownVideoUrl = annotatedUrl && !showOriginal ? annotatedUrl : dataset?.videoUrl;

  useEffect(() => {
    if (!dataset || !isPlaying || dataset.videoUrl) return;
    const interval = setInterval(() => {
      setCurrentFrameIdx((prev) => {
        if (prev >= dataset.frames.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 2000 / playbackSpeed);
    return () => clearInterval(interval);
  }, [isPlaying, dataset, playbackSpeed]);

  const handleDatasetChange = (id: string) => {
    setSelectedDatasetId(id);
    setCurrentFrameIdx(0);
    setIsPlaying(false);
  };

  const handleSeek = (index: number) => {
    setCurrentFrameIdx(index);
    setIsPlaying(false);
  };

  const activateDataset = (newDataset: Dataset) => {
    if (newDataset.videoUrl) blobUrlsRef.current.push(newDataset.videoUrl);
    setDatasets((prev) => [newDataset, ...prev]);
    setSelectedDatasetId(newDataset.id);
    setCurrentFrameIdx(0);
    setIsPlaying(false);
    setPlaybackSpeed(1);
  };

  const handleFileSelect = async (file: File) => {
    setProcessing(true);
    setUploadFileName(file.name);
    setUploadProgress(0);
    setUploadStage("uploading");

    try {
      let datasetId: string | undefined;
      let storagePath: string | undefined;

      if (user) {
        const result = await uploadDataset({
          file,
          userId: user.id,
          onProgress: (pct) => setUploadProgress(pct),
        });
        datasetId = result.datasetId;
        storagePath = result.storagePath;
        setUploadStage("finalizing");
      } else {
        for (let p = 0; p <= 100; p += 10) {
          setUploadProgress(p);
          await new Promise((r) => setTimeout(r, 60));
        }
      }

      const newDataset = await makeDatasetFromFile(file, datasetId);
      if (storagePath) {
        setStoragePathById((m) => ({ ...m, [newDataset.id]: storagePath! }));
      }
      activateDataset(newDataset);
      setUploadStage("done");
      setHasVideo(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast({ title: "Upload failed", description: msg, variant: "destructive" });
      setUploadStage("idle");
    } finally {
      setProcessing(false);
    }
  };

  const handleDelete = async () => {
    if (!datasetToDelete) return;
    setDeleting(true);

    try {
      const id = datasetToDelete.id;
      const path = storagePathById[id];

      // If this dataset is backed by Supabase, remove the storage object + DB row
      if (path && user) {
        // the original plus every annotated video the worker made for it
        const { data: runs } = await supabase
          .from("runs").select("annotated_path").eq("dataset_id", id);
        const paths = [path, ...(runs ?? []).map((r) => r.annotated_path).filter(Boolean)];
        const { error: storageErr } = await supabase
          .storage.from("datasets").remove(paths);
        if (storageErr) throw new Error(storageErr.message);

        const { error: dbErr } = await supabase
          .from("datasets").delete().eq("id", id);
        if (dbErr) throw new Error(dbErr.message);
      }

      // Drop from local state
      const remaining = datasets.filter((d) => d.id !== id);
      setDatasets(remaining);
      setStoragePathById((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });

      // If we deleted the active dataset, pick another or fall back to upload UI
      if (selectedDatasetId === id) {
        if (remaining.length > 0) {
          setSelectedDatasetId(remaining[0].id);
          setCurrentFrameIdx(0);
          setIsPlaying(false);
        } else {
          setSelectedDatasetId("");
          setHasVideo(false);
        }
      }

      // Free the in-memory blob URL if any
      if (datasetToDelete.videoUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(datasetToDelete.videoUrl);
      }

      toast({ title: "Video deleted" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      toast({ title: "Delete failed", description: msg, variant: "destructive" });
    } finally {
      setDeleting(false);
      setDatasetToDelete(null);
    }
  };

  // Signed in: same path as the first upload (saved + queued for analysis).
  const handleExplorerUpload = async (file: File) => {
    if (user) return handleFileSelect(file);
    activateDataset(await makeDatasetFromFile(file));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  };

  // Empty state: upload UI
  if (!hasVideo || !dataset) {
    return (
      <div className="min-h-screen pt-16">
        <div className="stagger mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
          <PageHeader title="Data Explorer">
            Upload survey video. The model finds, tracks and names the fish, then sends back an annotated copy.
          </PageHeader>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`panel cursor-pointer border-dashed p-12 text-center transition-colors duration-300 ${
              dragOver ? "border-primary bg-primary/5" : "hover:border-primary/50"
            } ${processing ? "pointer-events-none opacity-60" : ""}`}
            onClick={() => !processing && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="video/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileSelect(f);
              }}
            />

            {processing ? (
              <div className="space-y-4 max-w-md mx-auto">
                <div className="flex items-center justify-center gap-2">
                  {uploadStage === "finalizing" ? (
                    <Loader2 className="w-5 h-5 text-primary animate-spin" />
                  ) : uploadStage === "done" ? (
                    <CheckCircle2 className="w-5 h-5 text-primary" />
                  ) : (
                    <UploadIcon className="w-5 h-5 text-primary" />
                  )}
                  <p className="text-base font-medium">
                    {uploadStage === "finalizing"
                      ? "Finalizing..."
                      : uploadStage === "done"
                      ? "Upload complete"
                      : "Uploading video"}
                  </p>
                </div>
                {uploadFileName && (
                  <p className="text-xs text-muted-foreground truncate">{uploadFileName}</p>
                )}
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  {uploadProgress.toFixed(0)}%
                  {!user && " (only in this tab; log in to save it to your account)"}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <UploadIcon className="mx-auto h-8 w-8 text-primary" />
                <div>
                  <p className="font-display text-2xl">Drop a video here</p>
                  <p className="mt-1 text-sm text-muted-foreground">or click to choose a file. MP4, AVI or MOV.</p>
                </div>
              </div>
            )}
          </div>

          <p className="text-center text-sm text-muted-foreground">
            No footage?{" "}
            <a href="/bioreef-sample.mp4" download className="inline-flex items-center gap-1 text-primary hover:underline">
              <Download className="h-3.5 w-3.5" /> Download a 45-second sample
            </a>
            {" "}from the OzFish dataset (AIMS, CC BY 3.0 AU), then drop it above.
          </p>
        </div>
      </div>
    );
  }

  // Video loaded: explorer UI
  const run = dataset.run;
  // saved but not analysed yet; right after upload the run row may not have been polled yet
  const analysing = !!storagePathById[dataset.id] && (!run || run.status === "pending" || run.status === "processing");
  return (
    <div className="min-h-screen pt-16">
      <div className="stagger mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
        <PageHeader title="Data Explorer" />

        <VideoCards
          datasets={datasets}
          selectedId={selectedDatasetId}
          savedIds={new Set(Object.keys(storagePathById))}
          onSelect={handleDatasetChange}
          onUpload={() => fileInputRef.current?.click()}
        />
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="video/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleExplorerUpload(f);
          }}
        />

        {/* the selected video: name, date, length, status and actions */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border pb-4 text-sm text-muted-foreground">
          <p className="min-w-0 max-w-full truncate font-display text-2xl text-foreground">{dataset.name}</p>
          <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> {dataset.date}</span>
          <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {dataset.duration}</span>
          {/* while analysing, the progress view below carries the status */}
          {run && !analysing && (
            <span
              className={`flex items-center gap-1.5 ${run.status === "failed" ? "text-destructive" : "text-foreground"}`}
              title={run.error ?? undefined}
            >
              {run.status === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
              <span className="max-w-[18rem] truncate">{runLabel(run)}</span>
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {annotatedUrl && (
              <Button size="sm" variant="outline" onClick={() => setShowOriginal(!showOriginal)}>
                {showOriginal ? "Show AI result" : "Show original"}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setDatasetToDelete(dataset)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>

        {/* Delete confirmation */}
        <AlertDialog open={!!datasetToDelete} onOpenChange={(open) => !open && setDatasetToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this video?</AlertDialogTitle>
              <AlertDialogDescription>
                "{datasetToDelete?.name}" will be permanently removed
                {storagePathById[datasetToDelete?.id ?? ""] ? " from your account and cloud storage" : " from this session"}.
                This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); handleDelete(); }}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Full-width frame viewer, or the progress view while the worker runs */}
        {analysing ? (
          <ProcessingView
            run={run ?? { id: "", status: "pending", progress: 0, error: null, fishTracked: null, richness: null }}
            videoUrl={dataset.videoUrl}
            name={dataset.name}
          />
        ) : (
        <DatasetFrameView
          frame={frame}
          currentIndex={currentFrameIdx}
          totalFrames={dataset.frames.length}
          viewMode={viewMode}
          isPlaying={isPlaying}
          playbackSpeed={playbackSpeed}
          onPlayPause={() => setIsPlaying(!isPlaying)}
          onSeek={handleSeek}
          onSpeedChange={setPlaybackSpeed}
          videoUrl={shownVideoUrl}
        />
        )}
      </div>
    </div>
  );
};

export default LiveMonitor;
