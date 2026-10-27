import { useEffect, useState } from "react";
import { Percent } from "lucide-react";
import type { FishSpecies } from "@/data/marineData";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

/** Every species, ranked by count, with its family and its share of all fish counted. */

function dominance(pct: number) {
  if (pct >= 65) return { label: "High dominance", text: "text-coral-soft" };
  if (pct >= 40) return { label: "Elevated dominance", text: "text-sand" };
  return { label: "No single-species dominance", text: "text-bioluminescent" };
}

export function SpeciesTable({ species }: { species: FishSpecies[] }) {
  const [family, setFamily] = useState<Record<string, string>>({});
  const names = species.map((s) => s.scientificName);
  const key = names.join("|");

  useEffect(() => {
    if (!isSupabaseConfigured || !key) return;
    supabase.from("taxa").select("species, family").in("species", key.split("|"))
      .then(({ data }) => setFamily(Object.fromEntries((data ?? []).map((t) => [t.species, t.family]))));
  }, [key]);

  const top = species[0]?.percentage ?? 0;
  const d = dominance(top);

  return (
    <section className="panel p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-display text-2xl">Species</h2>
          <p className="mt-1 text-sm text-muted-foreground">Ranked by count. The bar is each species' share of all fish counted.</p>
        </div>
        {species.length > 0 && (
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold ring-1 ring-border ${d.text}`}>
            <Percent className="h-3.5 w-3.5" aria-hidden="true" /> {d.label}
          </span>
        )}
      </div>

      {species.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No positive species counts are available for this dataset.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_3rem_3.25rem] gap-3 border-b border-border pb-2 text-[10px] uppercase tracking-wide text-muted-foreground sm:grid-cols-[1.75rem_minmax(0,1.2fr)_minmax(0,1fr)_3rem_3.25rem]">
            <span>#</span><span>Species</span><span className="hidden sm:block">Share</span>
            <span className="text-right">Count</span><span className="text-right">%</span>
          </div>
          <ol className={`divide-y divide-border/40 ${species.length > 12 ? "max-h-[30rem] overflow-y-auto overscroll-contain" : ""}`}>
            {species.map((s, i) => (
              <li key={s.id} className="grid grid-cols-[1.75rem_minmax(0,1fr)_3rem_3.25rem] items-center gap-3 py-2.5 sm:grid-cols-[1.75rem_minmax(0,1.2fr)_minmax(0,1fr)_3rem_3.25rem]">
                <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm italic">{s.scientificName}</span>
                  {family[s.scientificName] && <span className="block truncate text-xs text-muted-foreground">{family[s.scientificName]}</span>}
                </span>
                <span className="hidden h-1.5 overflow-hidden rounded-full bg-secondary sm:block">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${top ? (s.percentage / top) * 100 : 0}%` }} />
                </span>
                <span className="text-right font-mono text-sm tabular-nums">{s.count}</span>
                <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">{s.percentage}%</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 border-t border-border/40 pt-3 text-xs leading-relaxed text-muted-foreground">
            Bars are scaled to the most abundant species. Dominance comes from each species' share in this
            dataset only; repeat surveys are needed before treating it as a lasting pattern.
          </p>
        </>
      )}
    </section>
  );
}
