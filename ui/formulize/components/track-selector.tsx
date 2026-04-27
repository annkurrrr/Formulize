"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { TrackOption } from "@/lib/track";

type TrackSelectorProps = {
  years: readonly number[];
  selectedYear: number;
  tracks: TrackOption[];
  selectedTrackFileName: string;
  selectedSession: "qualifying" | "race";
};

export function TrackSelector({
  years,
  selectedYear,
  tracks,
  selectedTrackFileName,
  selectedSession,
}: TrackSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateQuery(nextYear: number, nextTrack?: string, nextSession?: "qualifying" | "race") {
    const params = new URLSearchParams(searchParams.toString());

    params.set("year", String(nextYear));

    if (nextTrack) {
      params.set("track", nextTrack);
    } else {
      params.delete("track");
    }

    if (nextSession) {
      params.set("session", nextSession);
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="grid gap-2">
      <label htmlFor="session" className="text-zinc-400">
        Session
      </label>
      <select
        id="session"
        name="session"
        value={selectedSession}
        onChange={(event) => {
          const nextSession = event.target.value === "race" ? "race" : "qualifying";
          updateQuery(selectedYear, selectedTrackFileName, nextSession);
        }}
        className="w-full rounded-xl border border-white/15 bg-zinc-900/80 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
      >
        <option value="qualifying">Qualifying lap</option>
        <option value="race">Race</option>
      </select>

      <label htmlFor="year" className="text-zinc-400">
        Year
      </label>
      <select
        id="year"
        name="year"
        value={String(selectedYear)}
        onChange={(event) => {
          const nextYear = Number.parseInt(event.target.value, 10);
          if (Number.isNaN(nextYear)) {
            return;
          }

          // Reset track so the server can pick the first valid option for the new year.
          updateQuery(nextYear);
        }}
        className="w-full rounded-xl border border-white/15 bg-zinc-900/80 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
      >
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>

      <label htmlFor="track" className="text-zinc-400">
        Track
      </label>
      <select
        id="track"
        name="track"
        value={selectedTrackFileName}
        onChange={(event) => {
          updateQuery(selectedYear, event.target.value);
        }}
        className="w-full rounded-xl border border-white/15 bg-zinc-900/80 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
      >
        {tracks.map((track) => (
          <option key={track.fileName} value={track.fileName}>
            {track.roundNumber !== null ? `${track.roundNumber}. ` : ""}
            {track.label}
          </option>
        ))}
      </select>
    </div>
  );
}
