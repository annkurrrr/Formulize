import type { TrackGeometry } from "@/lib/track";

type TrackViewerProps = {
  geometry: TrackGeometry;
  selectedTrackName: string;
};

export function TrackViewer({ geometry, selectedTrackName }: TrackViewerProps) {
  return (
    <div className="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(11,12,18,0.96),rgba(5,6,10,0.98))] shadow-[0_30px_120px_rgba(0,0,0,0.55)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_42%),linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:100%_100%,48px_48px,48px_48px] opacity-30" />
      <div className="relative flex h-full flex-col p-4 sm:p-6">
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-white sm:text-2xl">
          {selectedTrackName} circuit
        </h2>

        <div className="relative flex min-h-[420px] flex-1 items-center justify-center overflow-hidden rounded-[1.25rem] border border-white/10 bg-black/55 p-2 sm:min-h-[520px]">
          <svg
            className="h-full w-full max-w-full"
            viewBox={`0 0 ${geometry.width} ${geometry.height}`}
            role="img"
            aria-labelledby="track-title track-desc"
          >
            <title id="track-title">{`${selectedTrackName} track outline`}</title>
            <desc id="track-desc">
              A closed racing line derived from the fastest lap telemetry, normalized to fit a 800
              by 600 canvas.
            </desc>
            <defs>
              <filter id="track-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="7" result="blur" />
                <feColorMatrix
                  in="blur"
                  type="matrix"
                  values="1 0 0 0 1
                          0 1 0 0 1
                          0 0 1 0 1
                          0 0 0 0.45 0"
                />
              </filter>
            </defs>
            <rect width={geometry.width} height={geometry.height} fill="#05070c" rx="28" />
            <path
              d={geometry.path}
              fill="none"
              stroke="rgba(255,255,255,0.16)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#track-glow)"
            />
            <path
              d={geometry.path}
              fill="none"
              stroke="#f8fafc"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx={geometry.start.x}
              cy={geometry.start.y}
              r="7"
              fill="#ef4444"
              stroke="#fff7ed"
              strokeWidth="3"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
