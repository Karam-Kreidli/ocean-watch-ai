import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { SurveyHeader } from "@/components/dashboard/SurveyHeader";
import { HealthIndicator } from "@/components/dashboard/HealthIndicator";
import { BiodiversityScore } from "@/components/dashboard/BiodiversityScore";
import { SpeciesChart } from "@/components/dashboard/SpeciesChart";
import { DatasetSummary } from "@/components/dashboard/DatasetSummary";
import { SpeciesTable } from "@/components/dashboard/SpeciesTable";
import BiodiversityInsight from "@/components/dashboard/BiodiversityInsight";
import { DownloadReport } from "@/components/dashboard/DownloadReport";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import dummySpeciesCountsFixture from "@/data/dummySpeciesCounts.json";
import healthySpeciesCountsFixture from "@/data/dummySpeciesCounts.healthy.json";
import largeSpeciesCountsFixture from "@/data/dummySpeciesCounts.large.json";
import largeDominanceSpeciesCountsFixture from "@/data/dummySpeciesCounts.largeDominance.json";
import moderateSpeciesCountsFixture from "@/data/dummySpeciesCounts.moderate.json";
import singleSpeciesCountsFixture from "@/data/dummySpeciesCounts.singleSpecies.json";
import smallSpeciesCountsFixture from "@/data/dummySpeciesCounts.small.json";
import stressedSpeciesCountsFixture from "@/data/dummySpeciesCounts.stressed.json";
import {
  RICHNESS_SCORE_CAP,
  SHANNON_SCORE_CAP,
  runRuleEngine,
} from "@/lib/ruleEngine";
import type {
  Bands,
  ComputedIndices,
  CompositeStatus,
  SpeciesCounts,
} from "@/lib/ruleEngine";
import type {
  BiodiversityIndex as DashboardBiodiversityIndex,
  FishSpecies,
} from "@/data/marineData";

interface SpeciesCountsFixture {
  surveyName: string;
  totalFishCount: number;
  expectedCompositeStatus?: string;
  species: Array<{
    speciesName: string;
    speciesCount: number;
  }>;
}

interface TestFixtureOption {
  label: string;
  fileName: string;
  note: string;
  data: SpeciesCountsFixture;
}

const testFixtures: TestFixtureOption[] = [
  {
    label: "Active file",
    fileName: "dummySpeciesCounts.json",
    note: "Current dummySpeciesCounts.json",
    data: dummySpeciesCountsFixture,
  },
  {
    label: "Healthy",
    fileName: "dummySpeciesCounts.healthy.json",
    note: "Balanced 30-species sample",
    data: healthySpeciesCountsFixture,
  },
  {
    label: "Moderate",
    fileName: "dummySpeciesCounts.moderate.json",
    note: "Moderately healthy uneven sample",
    data: moderateSpeciesCountsFixture,
  },
  {
    label: "Stressed",
    fileName: "dummySpeciesCounts.stressed.json",
    note: "Stressed low-richness sample",
    data: stressedSpeciesCountsFixture,
  },
  {
    label: "Small dataset",
    fileName: "dummySpeciesCounts.small.json",
    note: "Insufficient sample-size warning",
    data: smallSpeciesCountsFixture,
  },
  {
    label: "Large dataset",
    fileName: "dummySpeciesCounts.large.json",
    note: "Large balanced 60-species sample",
    data: largeSpeciesCountsFixture,
  },
  {
    label: "Large dominance",
    fileName: "dummySpeciesCounts.largeDominance.json",
    note: "Large sample with bad distribution",
    data: largeDominanceSpeciesCountsFixture,
  },
  {
    label: "Single species",
    fileName: "dummySpeciesCounts.singleSpecies.json",
    note: "Single-taxon edge case",
    data: singleSpeciesCountsFixture,
  },
];

function toSpeciesCounts(fixture: SpeciesCountsFixture): SpeciesCounts {
  return fixture.species.reduce<SpeciesCounts>((counts, species) => {
    const count = Number(species.speciesCount);

    if (species.speciesName && Number.isFinite(count) && count > 0) {
      counts[species.speciesName] = count;
    }

    return counts;
  }, {});
}

function toDashboardSpeciesData(
  fixture: SpeciesCountsFixture,
  totalCount: number
): FishSpecies[] {
  return fixture.species
    .filter((species) => {
      const count = Number(species.speciesCount);
      return species.speciesName && Number.isFinite(count) && count > 0;
    })
    .sort((a, b) => b.speciesCount - a.speciesCount)
    .map((species, index) => {
      const percentage = totalCount
        ? Math.round((species.speciesCount / totalCount) * 1000) / 10
        : 0;

      return {
        id: String(index + 1),
        name: species.speciesName,
        scientificName: species.speciesName,
        count: species.speciesCount,
        percentage,
        trend: "stable",
        category: "reef",
      };
    });
}

function bandStatus(
  band: Bands["richness"] | Bands["shannon"] | Bands["simpson"] | Bands["evenness"]
): DashboardBiodiversityIndex["status"] {
  if (band === "HIGH" || band === "VERY_HIGH") {
    return "healthy";
  }

  if (band === "MODERATE") {
    return "moderate";
  }

  return "stressed";
}

function buildDashboardIndices(
  indices: ComputedIndices,
  bands: Bands
): DashboardBiodiversityIndex[] {
  return [
    {
      name: "Species Richness",
      value: indices.S,
      maxValue: RICHNESS_SCORE_CAP,
      scaleLabel: `score cap S >= ${RICHNESS_SCORE_CAP}`,
      description: "Distinct taxa detected; composite contribution is capped after the threshold",
      status: bandStatus(bands.richness),
    },
    {
      name: "Shannon Index (H')",
      value: indices.H,
      maxValue: SHANNON_SCORE_CAP,
      scaleLabel: `score cap H' >= ${SHANNON_SCORE_CAP}`,
      description: "Richness-evenness diversity; raw H' can exceed the scoring cap",
      status: bandStatus(bands.shannon),
    },
    {
      name: "Simpson Index (1-D)",
      value: indices.D,
      maxValue: 1,
      scaleLabel: "0-1 range",
      description: "Gini-Simpson diversity: probability two individuals differ",
      status: bandStatus(bands.simpson),
    },
    {
      name: "Pielou Evenness (J')",
      value: indices.J,
      maxValue: 1,
      scaleLabel: "0-1 range",
      description: "Evenness normalized to the observed richness",
      status: bandStatus(bands.evenness),
    },
  ];
}

/** Finished pipeline runs, newest first, in the fixture shape the dashboard reads.
 * Counts are MaxN per species (species-level verdicts only). */
async function loadAnalysedVideos(): Promise<TestFixtureOption[]> {
  const { data } = await supabase
    .from("runs")
    .select("id, finished_at, datasets(name, capture_date), species_counts(species, maxn)")
    .eq("status", "done")
    .order("finished_at", { ascending: false });
  return (data ?? []).map((r) => {
    const ds = r.datasets as unknown as { name: string; capture_date: string | null } | null;
    const counts = (r.species_counts ?? []) as { species: string; maxn: number }[];
    return {
      label: ds?.name ?? "Video",
      fileName: ds?.capture_date ?? "",
      note: "Analysed by the BioReef pipeline (MaxN per species)",
      data: {
        surveyName: ds?.name ?? "Video",
        totalFishCount: counts.reduce((s, c) => s + c.maxn, 0),
        species: counts.map((c) => ({ speciesName: c.species, speciesCount: c.maxn })),
      },
    };
  });
}

const Dashboard = () => {
  const { user } = useAuth();
  const [analysed, setAnalysed] = useState<TestFixtureOption[]>([]);
  useEffect(() => {
    if (!user) return;
    loadAnalysedVideos().then(setAnalysed);
  }, [user]);
  const options = useMemo(() => [...analysed, ...testFixtures], [analysed]);

  const [fixtureIndex, setFixtureIndex] = useState(0);
  const selectedFixture = options[Math.min(fixtureIndex, options.length - 1)];
  const activeDataset = selectedFixture.data;

  const dashboardSpeciesCounts = useMemo(
    () => toSpeciesCounts(activeDataset),
    [activeDataset]
  );
  const computedFixtureTotal = useMemo(
    () =>
      Object.values(dashboardSpeciesCounts).reduce(
        (sum, count) => sum + count,
        0
      ),
    [dashboardSpeciesCounts]
  );
  const hasFixtureTotalMismatch =
    computedFixtureTotal !== activeDataset.totalFishCount;
  const ruleEngineOutput = useMemo(
    () => runRuleEngine(dashboardSpeciesCounts),
    [dashboardSpeciesCounts]
  );
  const dashboardSpeciesData = useMemo(
    () => toDashboardSpeciesData(activeDataset, computedFixtureTotal),
    [activeDataset, computedFixtureTotal]
  );
  const dashboardIndices = ruleEngineOutput
    ? buildDashboardIndices(ruleEngineOutput.indices, ruleEngineOutput.bands)
    : [];
  const dashboardCompositeScore = ruleEngineOutput?.indices.compositeScore ?? 0;
  const dashboardCompositeStatus: CompositeStatus =
    ruleEngineOutput?.compositeStatus ?? "CRITICAL";

  return (
    <div className="min-h-screen pt-16">
      {/* survey picker: sticks under the navbar while the page scrolls */}
      <div className="sticky top-16 z-30 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div className="hidden min-w-0 md:block">
            <p className="truncate text-sm text-foreground">{selectedFixture.label}</p>
            <p className="truncate text-xs text-muted-foreground">{selectedFixture.note}</p>
          </div>
          <Select value={String(fixtureIndex)} onValueChange={(value) => setFixtureIndex(Number(value))}>
            <SelectTrigger id="fixture-select" aria-label="Survey" className="h-9 w-full border-border bg-secondary md:w-80">
              <SelectValue placeholder="Choose a survey" />
            </SelectTrigger>
            <SelectContent>
              {options.map((fixture, index) => (
                <SelectItem key={`${fixture.label}-${index}`} value={String(index)}>
                  {fixture.label}{fixture.fileName ? ` · ${fixture.fileName}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="stagger mx-auto max-w-7xl space-y-10 px-4 py-10 sm:px-6 lg:px-8">
        <SurveyHeader
          totalSpecies={ruleEngineOutput?.indices.S}
          totalIndividuals={ruleEngineOutput?.indices.totalCount}
          ecosystemStatus={dashboardCompositeStatus}
        />

        <section>
          <h2 className="mb-4 font-display text-3xl">Biodiversity indices</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {dashboardIndices.map((idx) => (
              <HealthIndicator key={idx.name} index={idx} />
            ))}
            <BiodiversityScore
              score={dashboardCompositeScore}
              status={dashboardCompositeStatus}
            />
          </div>
        </section>

        {ruleEngineOutput && (
          <DatasetSummary
            species={dashboardSpeciesData}
            indices={ruleEngineOutput.indices}
            sampleSize={ruleEngineOutput.bands.sampleSize}
            patternCount={ruleEngineOutput.patterns.length}
          />
        )}

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
          <SpeciesChart species={dashboardSpeciesData} />
          <SpeciesTable species={dashboardSpeciesData} />
        </section>

        <section>
          <BiodiversityInsight speciesCounts={dashboardSpeciesCounts} />
          {hasFixtureTotalMismatch && (
            <p className="mt-2 text-xs text-destructive">
              Dummy fixture total mismatch: declared {activeDataset.totalFishCount},
              computed {computedFixtureTotal}.
            </p>
          )}
        </section>

        <section>
          <DownloadReport
            surveyName={activeDataset.surveyName}
            species={dashboardSpeciesData}
            output={ruleEngineOutput}
          />
        </section>

        <footer className="border-t border-border/60 py-6 text-xs text-muted-foreground">
          Indices are computed from the species counts. The written interpretation comes from a fixed rule set, not a language model.
        </footer>
      </div>
    </div>
  );
};

export default Dashboard;
