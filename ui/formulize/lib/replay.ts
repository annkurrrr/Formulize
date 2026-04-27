import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { SupportedYear } from "@/lib/track";

export type ReplayMode = "qualifying" | "race";

export type ReplaySample = {
  tMs: number;
  x: number;
  y: number;
  speedKph: number;
  lapNumber?: number;
  compound?: string;
};

export type PositionTimelinePoint = {
  tMs: number;
  lapNumber: number | null;
  position: number | null;
};

export type DriverReplay = {
  driverCode: string;
  fullName: string;
  teamName: string;
  teamColor: string;
  lapTimeMs: number;
  finishPosition?: number | null;
  status?: string;
  positionTimeline?: PositionTimelinePoint[];
  samples: ReplaySample[];
};

export type ReplaySession = {
  year: number;
  eventName: string;
  session: "Q" | "R";
  generatedAt: string;
  drivers: DriverReplay[];
};

type RawDriverReplay = DriverReplay & {
  raceTimeMs?: number;
};

type RawReplaySession = Omit<ReplaySession, "drivers"> & {
  drivers: RawDriverReplay[];
};

const DATASETS_DIR_PATH = path.resolve(process.cwd(), "..", "..", "data", "datasets");

function normalizeColor(color: string): string {
  if (!color) {
    return "#e5e7eb";
  }

  return color.startsWith("#") ? color : `#${color}`;
}

function getReplayDirPath(year: SupportedYear, mode: ReplayMode): string {
  return path.join(
    DATASETS_DIR_PATH,
    String(year),
    mode === "race" ? "Race-Replays" : "Quali-Replays",
  );
}

function getReplayFileName(trackFileName: string, mode: ReplayMode): string {
  return trackFileName.replace(
    /_track\.csv$/i,
    mode === "race" ? "_race_replay.json" : "_quali_replay.json",
  );
}

export function getReplaySession(
  year: SupportedYear,
  trackFileName: string,
  mode: ReplayMode,
): ReplaySession | null {
  const replayPath = path.join(getReplayDirPath(year, mode), getReplayFileName(trackFileName, mode));

  if (!fs.existsSync(replayPath)) {
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(replayPath, "utf8")) as RawReplaySession;

  return {
    ...parsed,
    drivers: parsed.drivers
      .filter((driver) => Array.isArray(driver.samples) && driver.samples.length > 1)
      .map((driver) => ({
        ...driver,
        lapTimeMs:
          Number.isFinite(driver.lapTimeMs) && driver.lapTimeMs > 0
            ? driver.lapTimeMs
            : Number.isFinite(driver.raceTimeMs) && (driver.raceTimeMs ?? 0) > 0
              ? (driver.raceTimeMs as number)
              : 0,
        teamColor: normalizeColor(driver.teamColor),
        positionTimeline: Array.isArray(driver.positionTimeline)
          ? driver.positionTimeline.filter((point) => Number.isFinite(point.tMs))
          : [],
        samples: driver.samples.filter(
          (sample) =>
            Number.isFinite(sample.tMs) &&
            Number.isFinite(sample.x) &&
            Number.isFinite(sample.y) &&
            Number.isFinite(sample.speedKph),
        ),
      }))
      .sort((a, b) => a.lapTimeMs - b.lapTimeMs),
  };
}
