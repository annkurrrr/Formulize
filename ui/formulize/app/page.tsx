import { ReplayBoard } from "@/components/replay-board";
import { getReplaySession, type ReplayMode } from "@/lib/replay";
import {
  getAvailableTracks,
  getTrackGeometry,
  projectTelemetryPoint,
  SUPPORTED_YEARS,
  type SupportedYear,
} from "@/lib/track";

type HomePageProps = {
  searchParams: Promise<{ year?: string; track?: string; session?: string }>;
};

function isSupportedYear(value: number): value is SupportedYear {
  return SUPPORTED_YEARS.includes(value as SupportedYear);
}

export default async function Home({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const selectedMode: ReplayMode = params.session === "race" ? "race" : "qualifying";

  const requestedYear = Number.parseInt(params.year ?? "", 10);
  const selectedYear = isSupportedYear(requestedYear) ? requestedYear : SUPPORTED_YEARS[0];

  const tracks = getAvailableTracks(selectedYear);

  if (tracks.length === 0) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(30,41,59,0.6),transparent_30%),linear-gradient(180deg,#05070c_0%,#0b1020_100%)] text-white">
        <div className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-6 py-10">
          <div className="w-full rounded-[2rem] border border-red-500/30 bg-red-500/10 p-8 text-red-100">
            <h1 className="text-2xl font-semibold tracking-tight">No track files found</h1>
            <p className="mt-3 text-sm leading-6 text-red-100/90">
              Add CSV files to ../../data/datasets/2023/Tracks, 2024/Tracks, or 2025/Tracks and
              refresh the page.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const selectedTrack = tracks.find((track) => track.fileName === params.track) ?? tracks[0];
  const geometry = getTrackGeometry(selectedYear, selectedTrack.fileName);
  const replaySession = getReplaySession(selectedYear, selectedTrack.fileName, selectedMode);

  if (!replaySession || replaySession.drivers.length === 0) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(30,41,59,0.6),transparent_30%),linear-gradient(180deg,#05070c_0%,#0b1020_100%)] text-white">
        <div className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-6 py-10">
          <div className="w-full rounded-[2rem] border border-amber-500/30 bg-amber-500/10 p-8 text-amber-100">
            <h1 className="text-2xl font-semibold tracking-tight">Replay JSON not found</h1>
            <p className="mt-3 text-sm leading-6 text-amber-100/90">
              Generate the {selectedMode === "race" ? "race" : "qualifying"} replay JSON for
              this session in ../../data/datasets/{selectedYear}/
              {selectedMode === "race" ? "Race-Replays" : "Quali-Replays"} and refresh.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const projectedDrivers = replaySession.drivers.map((driver) => ({
    ...driver,
    samples: driver.samples.map((sample) => {
      const point = projectTelemetryPoint(sample.x, sample.y, geometry);
      return {
        ...sample,
        x: point.x,
        y: point.y,
      };
    }),
  }));

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(30,41,59,0.6),transparent_30%),linear-gradient(180deg,#05070c_0%,#0b1020_100%)] text-white">
      <div className="flex min-h-screen w-full items-start px-5 py-6 sm:px-8 lg:px-12 lg:py-8">
        <ReplayBoard
          key={`${selectedYear}:${selectedTrack.fileName}:${selectedMode}`}
          years={SUPPORTED_YEARS}
          selectedYear={selectedYear}
          selectedMode={selectedMode}
          tracks={tracks}
          selectedTrackFileName={selectedTrack.fileName}
          selectedTrackName={selectedTrack.label}
          geometry={{
            width: geometry.width,
            height: geometry.height,
            path: geometry.path,
          }}
          drivers={projectedDrivers}
        />
      </div>
    </main>
  );
}
