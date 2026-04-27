"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { TrackSelector } from "@/components/track-selector";
import type { ReplayMode } from "@/lib/replay";
import type { TrackOption } from "@/lib/track";

type ProjectedSample = {
  tMs: number;
  x: number;
  y: number;
  speedKph: number;
};

type ProjectedDriverReplay = {
  driverCode: string;
  fullName: string;
  teamName: string;
  teamColor: string;
  lapTimeMs: number;
  finishPosition?: number | null;
  status?: string;
  positionTimeline?: { tMs: number; lapNumber: number | null; position: number | null }[];
  samples: ProjectedSample[];
};

type ReplayBoardProps = {
  years: readonly number[];
  selectedYear: number;
  selectedMode: ReplayMode;
  tracks: TrackOption[];
  selectedTrackFileName: string;
  selectedTrackName: string;
  geometry: {
    width: number;
    height: number;
    path: string;
  };
  drivers: ProjectedDriverReplay[];
};

type DriverLiveState = {
  driverCode: string;
  color: string;
  timerMs: number;
  speedKph: number;
  x: number;
  y: number;
  finished: boolean;
  lapTimeMs: number;
};

function formatLapTime(totalMs: number): string {
  const clamped = Math.max(0, Math.floor(totalMs));
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(millis).padStart(3, "0")}`;
}

function formatInterval(intervalMs: number): string {
  if (intervalMs <= 0) {
    return "LEADER";
  }

  const seconds = intervalMs / 1000;
  return `+${seconds.toFixed(3)}s`;
}

function normalizeSamples(samples: ProjectedSample[]): ProjectedSample[] {
  if (samples.length === 0) {
    return [];
  }

  const ordered = [...samples].sort((a, b) => a.tMs - b.tMs);
  const deduped: ProjectedSample[] = [];

  for (const sample of ordered) {
    if (!Number.isFinite(sample.tMs) || !Number.isFinite(sample.x) || !Number.isFinite(sample.y)) {
      continue;
    }

    if (deduped.length === 0) {
      deduped.push({ ...sample, tMs: Math.max(0, sample.tMs) });
      continue;
    }

    const prev = deduped[deduped.length - 1];
    if (sample.tMs <= prev.tMs) {
      continue;
    }

    deduped.push(sample);
  }

  if (deduped.length <= 2) {
    return deduped;
  }

  // Median-of-3 filter suppresses one-sample GPS spikes that cause visual jumps.
  const medianFiltered = deduped.map((sample, index) => {
    const prev = deduped[Math.max(0, index - 1)];
    const next = deduped[Math.min(deduped.length - 1, index + 1)];
    const median3 = (a: number, b: number, c: number) => [a, b, c].sort((x, y) => x - y)[1];

    return {
      ...sample,
      x: median3(prev.x, sample.x, next.x),
      y: median3(prev.y, sample.y, next.y),
      speedKph: median3(prev.speedKph, sample.speedKph, next.speedKph),
    };
  });

  // Resample to uniform time steps so interpolation speed is consistent frame-to-frame.
  const stepMs = 20;
  const startMs = Math.max(0, medianFiltered[0].tMs);
  const endMs = medianFiltered[medianFiltered.length - 1].tMs;
  const resampled: ProjectedSample[] = [];

  let segmentIndex = 1;

  for (let t = startMs; t <= endMs; t += stepMs) {
    while (segmentIndex < medianFiltered.length && medianFiltered[segmentIndex].tMs < t) {
      segmentIndex += 1;
    }

    if (segmentIndex >= medianFiltered.length) {
      const last = medianFiltered[medianFiltered.length - 1];
      resampled.push({ tMs: t, x: last.x, y: last.y, speedKph: last.speedKph });
      continue;
    }

    const next = medianFiltered[segmentIndex];
    const prev = medianFiltered[Math.max(0, segmentIndex - 1)];
    const span = Math.max(next.tMs - prev.tMs, 1);
    const ratio = Math.max(0, Math.min(1, (t - prev.tMs) / span));

    resampled.push({
      tMs: t,
      x: prev.x + (next.x - prev.x) * ratio,
      y: prev.y + (next.y - prev.y) * ratio,
      speedKph: prev.speedKph + (next.speedKph - prev.speedKph) * ratio,
    });
  }

  // Guarantee a sample at the end time so finish state remains stable.
  const last = medianFiltered[medianFiltered.length - 1];
  if (resampled.length === 0 || resampled[resampled.length - 1].tMs < endMs) {
    resampled.push({ tMs: endMs, x: last.x, y: last.y, speedKph: last.speedKph });
  }

  return resampled;
}

function ensureDynamicSpeed(samples: ProjectedSample[]): ProjectedSample[] {
  if (samples.length < 3) {
    return samples;
  }

  const speedValues = samples
    .map((sample) => sample.speedKph)
    .filter((value) => Number.isFinite(value));

  if (speedValues.length === 0) {
    return samples;
  }

  let minSpeed = Number.POSITIVE_INFINITY;
  let maxSpeed = Number.NEGATIVE_INFINITY;
  for (const value of speedValues) {
    if (value < minSpeed) {
      minSpeed = value;
    }
    if (value > maxSpeed) {
      maxSpeed = value;
    }
  }

  // If speed is nearly flat from source data, derive a dynamic speed profile from motion.
  if (maxSpeed - minSpeed >= 5) {
    return samples;
  }

  const rawSpeeds = samples.map((sample, index) => {
    const prev = samples[Math.max(0, index - 1)];
    const next = samples[Math.min(samples.length - 1, index + 1)];
    const dtSec = Math.max((next.tMs - prev.tMs) / 1000, 1e-3);
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const distance = Math.hypot(dx, dy);
    return distance / dtSec;
  });

  let peakRawSpeed = 1;
  for (const speed of rawSpeeds) {
    if (speed > peakRawSpeed) {
      peakRawSpeed = speed;
    }
  }

  return samples.map((sample, index) => {
    const normalized = Math.max(0, Math.min(1, rawSpeeds[index] / peakRawSpeed));
    const mappedSpeed = 70 + normalized * 270;

    return {
      ...sample,
      speedKph: mappedSpeed,
    };
  });
}

function normalizeRaceDriverTimeline(driver: ProjectedDriverReplay, globalStartMs: number): ProjectedDriverReplay {
  const shiftedSamples = driver.samples
    .map((sample) => ({
      ...sample,
      tMs: Math.max(0, sample.tMs - globalStartMs),
    }))
    .sort((a, b) => a.tMs - b.tMs);

  if (shiftedSamples.length > 0) {
    if (shiftedSamples[0].tMs > 0) {
      shiftedSamples.unshift({
        ...shiftedSamples[0],
        tMs: 0,
        speedKph: 0,
      });
    } else {
      shiftedSamples[0] = {
        ...shiftedSamples[0],
        speedKph: 0,
      };
    }
  }

  const shiftedPositionTimeline = Array.isArray(driver.positionTimeline)
    ? driver.positionTimeline
        .map((point) => ({
          ...point,
          tMs: Math.max(0, point.tMs - globalStartMs),
        }))
        .sort((a, b) => a.tMs - b.tMs)
    : [];

  const timelineDurationMs =
    shiftedSamples.length > 0 ? shiftedSamples[shiftedSamples.length - 1].tMs : 0;

  return {
    ...driver,
    // For race replay we must use telemetry timeline duration, not classification gap/time,
    // otherwise interpolation clamps too early and cars appear stuck at the start.
    lapTimeMs: Math.max(timelineDurationMs, 1),
    samples: shiftedSamples,
    positionTimeline: shiftedPositionTimeline,
  };
}

function deterministicAngleFromCode(code: string): number {
  let hash = 0;
  for (let i = 0; i < code.length; i += 1) {
    hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
  }
  return (hash / 4294967295) * Math.PI * 2;
}

function getPositionAtTime(
  timeline: { tMs: number; position: number | null }[] | undefined,
  replayMs: number,
): number | null {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return null;
  }

  let result: number | null = null;
  for (const point of timeline) {
    if (!Number.isFinite(point.tMs)) {
      continue;
    }
    if (point.tMs > replayMs) {
      break;
    }
    result = point.position ?? result;
  }

  return result;
}

function getTimingMarkAtTime(
  timeline: { tMs: number; position: number | null }[] | undefined,
  replayMs: number,
): number | null {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return null;
  }

  let lastMark: number | null = null;
  for (const point of timeline) {
    if (!Number.isFinite(point.tMs)) {
      continue;
    }
    if (point.tMs > replayMs) {
      break;
    }
    lastMark = point.tMs;
  }

  return lastMark;
}

function interpolateDriverState(samples: ProjectedSample[], replayMs: number, lapTimeMs: number) {
  if (samples.length === 0) {
    return null;
  }

  const clamped = Math.max(0, Math.min(replayMs, lapTimeMs));

  if (clamped <= samples[0].tMs) {
    const first = samples[0];
    return { x: first.x, y: first.y, speedKph: first.speedKph, timerMs: clamped };
  }

  const lastIndex = samples.length - 1;
  if (clamped >= samples[lastIndex].tMs) {
    const last = samples[lastIndex];
    return { x: last.x, y: last.y, speedKph: last.speedKph, timerMs: clamped };
  }

  let lo = 0;
  let hi = lastIndex;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (samples[mid].tMs < clamped) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const nextIndex = Math.max(1, lo);
  const prevIndex = nextIndex - 1;

  const prev = samples[prevIndex];
  const next = samples[nextIndex];
  const span = Math.max(next.tMs - prev.tMs, 1);
  const ratio = Math.max(0, Math.min(1, (clamped - prev.tMs) / span));

  return {
    x: prev.x + (next.x - prev.x) * ratio,
    y: prev.y + (next.y - prev.y) * ratio,
    speedKph: prev.speedKph + (next.speedKph - prev.speedKph) * ratio,
    timerMs: clamped,
  };
}

export function ReplayBoard({
  years,
  selectedYear,
  selectedMode,
  tracks,
  selectedTrackFileName,
  selectedTrackName,
  geometry,
  drivers,
}: ReplayBoardProps) {
  const [mode, setMode] = useState<"all" | "compare">("all");
  const [selectedDriverCodes, setSelectedDriverCodes] = useState<string[]>(
    drivers.slice(0, 3).map((driver) => driver.driverCode),
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [replayMs, setReplayMs] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const smoothedDriverStateRef = useRef<
    Record<string, { x: number; y: number; speedKph: number; timerMs: number }>
  >({});
  const previousReplayMsRef = useRef(0);

  const normalizedDrivers = useMemo(() => {
    const processed = drivers.map((driver) => {
      const normalized = normalizeSamples(driver.samples);
      return {
        ...driver,
        samples: ensureDynamicSpeed(normalized),
      };
    });

    if (selectedMode !== "race") {
      return processed;
    }

    let globalStartMs = Number.POSITIVE_INFINITY;
    for (const driver of processed) {
      if (driver.samples.length > 0 && driver.samples[0].tMs < globalStartMs) {
        globalStartMs = driver.samples[0].tMs;
      }
    }

    if (!Number.isFinite(globalStartMs)) {
      return processed;
    }

    return processed.map((driver) => normalizeRaceDriverTimeline(driver, globalStartMs));
  }, [drivers, selectedMode]);

  const maxLapTimeMs = useMemo(
    () => Math.max(...normalizedDrivers.map((driver) => driver.lapTimeMs), 1),
    [normalizedDrivers],
  );

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastFrameTimeRef.current = null;
      return;
    }

    const tick = (now: number) => {
      const prev = lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;

      let reachedEnd = false;

      if (prev !== null) {
        const rawDelta = now - prev;
        const cappedDelta = Math.min(Math.max(rawDelta, 0), 34);
        const delta = cappedDelta * playbackRate;
        setReplayMs((old) => {
          const next = old + delta;
          if (next >= maxLapTimeMs) {
            reachedEnd = true;
            return maxLapTimeMs;
          }
          return next;
        });
      }

      if (reachedEnd) {
        setIsPlaying(false);
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      lastFrameTimeRef.current = null;
    };
  }, [isPlaying, maxLapTimeMs, playbackRate]);

  const activeDrivers = useMemo(() => {
    if (mode === "all") {
      return normalizedDrivers;
    }

    const codeSet = new Set(selectedDriverCodes);
    return normalizedDrivers.filter((driver) => codeSet.has(driver.driverCode));
  }, [normalizedDrivers, mode, selectedDriverCodes]);

  useEffect(() => {
    if (replayMs < previousReplayMsRef.current) {
      smoothedDriverStateRef.current = {};
    }
    previousReplayMsRef.current = replayMs;
  }, [replayMs]);

  useEffect(() => {
    const activeCodes = new Set(activeDrivers.map((driver) => driver.driverCode));
    for (const code of Object.keys(smoothedDriverStateRef.current)) {
      if (!activeCodes.has(code)) {
        delete smoothedDriverStateRef.current[code];
      }
    }
  }, [activeDrivers]);

  const liveDrivers: DriverLiveState[] = useMemo(() => {
    const smoothingFactor = 0.22;

    return activeDrivers
      .map((driver) => {
        const state = interpolateDriverState(driver.samples, replayMs, driver.lapTimeMs);
        if (!state) {
          return null;
        }

        const previous = smoothedDriverStateRef.current[driver.driverCode];
        const smoothed = previous
          ? {
              x: previous.x + (state.x - previous.x) * smoothingFactor,
              y: previous.y + (state.y - previous.y) * smoothingFactor,
              speedKph: previous.speedKph + (state.speedKph - previous.speedKph) * smoothingFactor,
              timerMs: state.timerMs,
            }
          : {
              x: state.x,
              y: state.y,
              speedKph: state.speedKph,
              timerMs: state.timerMs,
            };

        smoothedDriverStateRef.current[driver.driverCode] = smoothed;

        return {
          driverCode: driver.driverCode,
          color: driver.teamColor,
          timerMs: smoothed.timerMs,
          speedKph: smoothed.speedKph,
          x: smoothed.x,
          y: smoothed.y,
          finished: replayMs >= driver.lapTimeMs,
          lapTimeMs: driver.lapTimeMs,
        };
      })
      .filter((driver): driver is DriverLiveState => driver !== null);
  }, [activeDrivers, replayMs]);

  const liveStateByCode = useMemo(() => {
    return new Map(liveDrivers.map((driver) => [driver.driverCode, driver]));
  }, [liveDrivers]);

  const allFinished = useMemo(() => {
    return activeDrivers.length > 0 && activeDrivers.every((driver) => replayMs >= driver.lapTimeMs);
  }, [activeDrivers, replayMs]);

  const leaderboard = useMemo(() => {
    if (activeDrivers.length === 0) {
      return [];
    }

    const hasRacePositions =
      selectedMode === "race" &&
      activeDrivers.some((driver) => Array.isArray(driver.positionTimeline) && driver.positionTimeline.length > 0);

    const baseRows = activeDrivers.map((driver) => {
      const live = liveStateByCode.get(driver.driverCode);
      const timerMs = live?.timerMs ?? Math.min(replayMs, driver.lapTimeMs);
      const progress = Math.max(0, Math.min(1, timerMs / Math.max(driver.lapTimeMs, 1)));
      const finished = timerMs >= driver.lapTimeMs - 1;
      const livePosition = hasRacePositions ? getPositionAtTime(driver.positionTimeline, replayMs) : null;
      const timingMarkMs = hasRacePositions ? getTimingMarkAtTime(driver.positionTimeline, replayMs) : null;

      return {
        driverCode: driver.driverCode,
        color: driver.teamColor,
        lapTimeMs: driver.lapTimeMs,
        timerMs,
        progress,
        finished,
        livePosition,
        timingMarkMs,
        finishPosition: driver.finishPosition ?? null,
      };
    });

    const sorted = [...baseRows].sort((a, b) => {
      if (allFinished) {
        if (a.finishPosition !== null && b.finishPosition !== null && a.finishPosition !== b.finishPosition) {
          return a.finishPosition - b.finishPosition;
        }
        return a.lapTimeMs - b.lapTimeMs;
      }

      if (hasRacePositions && a.livePosition !== null && b.livePosition !== null && a.livePosition !== b.livePosition) {
        return a.livePosition - b.livePosition;
      }

      if (a.finished !== b.finished) {
        return a.finished ? -1 : 1;
      }

      if (a.progress !== b.progress) {
        return b.progress - a.progress;
      }

      if (a.timerMs !== b.timerMs) {
        return b.timerMs - a.timerMs;
      }

      return a.lapTimeMs - b.lapTimeMs;
    });

    const leader = sorted[0];
    const leaderTimingMarkMs = leader.timingMarkMs ?? replayMs;

    return sorted.map((row, index) => {
      const carAhead = index > 0 ? sorted[index - 1] : null;
      const gapToLeaderMs = hasRacePositions && !allFinished
        ? Math.max(0, leaderTimingMarkMs - (row.timingMarkMs ?? replayMs))
        : allFinished
          ? row.lapTimeMs - leader.lapTimeMs
          : Math.max(0, row.timerMs - leader.timerMs);
      const gapToAheadMs = carAhead
        ? hasRacePositions && !allFinished
          ? Math.max(0, (carAhead.timingMarkMs ?? replayMs) - (row.timingMarkMs ?? replayMs))
          : allFinished
            ? Math.max(0, row.lapTimeMs - carAhead.lapTimeMs)
            : Math.max(0, row.timerMs - carAhead.timerMs)
        : 0;

      return {
        position: hasRacePositions && !allFinished && row.livePosition !== null ? row.livePosition : index + 1,
        driverCode: row.driverCode,
        color: row.color,
        lapTimeMs: row.lapTimeMs,
        intervalMs: gapToLeaderMs,
        displayTimeMs: allFinished ? row.lapTimeMs : row.timerMs,
        displayValue:
          selectedMode === "race" && !allFinished
            ? index === 0
              ? "LEADER"
              : formatInterval(gapToLeaderMs)
            : formatLapTime(allFinished ? row.lapTimeMs : row.timerMs),
        statusLabel:
          index === 0
            ? allFinished
              ? "WINNER"
              : "LEADER"
            : formatInterval(gapToAheadMs),
      };
    });
  }, [activeDrivers, allFinished, liveStateByCode, replayMs, selectedMode]);

  const leaderboardPositionByCode = useMemo(() => {
    return new Map(leaderboard.map((row) => [row.driverCode, row.position]));
  }, [leaderboard]);

  const markersForRender = useMemo(() => {
    const overlapThreshold = 10;
    const markers: Array<DriverLiveState & { drawX: number; drawY: number }> = liveDrivers.map((driver) => {
      const hasNearbyDriver = liveDrivers.some((other) => {
        if (other.driverCode === driver.driverCode) {
          return false;
        }

        const dx = other.x - driver.x;
        const dy = other.y - driver.y;
        return Math.hypot(dx, dy) < overlapThreshold;
      });

      if (!hasNearbyDriver) {
        return { ...driver, drawX: driver.x, drawY: driver.y };
      }

      const angle = deterministicAngleFromCode(driver.driverCode);
      const radius = 4;

      return {
        ...driver,
        drawX: driver.x + Math.cos(angle) * radius,
        drawY: driver.y + Math.sin(angle) * radius,
      };
    });

    return markers.sort(
      (a, b) =>
        (leaderboardPositionByCode.get(b.driverCode) ?? Number.MAX_SAFE_INTEGER) -
        (leaderboardPositionByCode.get(a.driverCode) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [liveDrivers, leaderboardPositionByCode]);

  const compareLiveRows = useMemo(() => {
    if (mode !== "compare") {
      return [];
    }

    return [...liveDrivers].sort(
      (a, b) =>
        (leaderboardPositionByCode.get(a.driverCode) ?? Number.MAX_SAFE_INTEGER) -
        (leaderboardPositionByCode.get(b.driverCode) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [liveDrivers, mode, leaderboardPositionByCode]);

  function toggleDriver(driverCode: string) {
    setSelectedDriverCodes((current) => {
      if (current.includes(driverCode)) {
        return current.filter((code) => code !== driverCode);
      }

      if (current.length >= 3) {
        return current;
      }

      return [...current, driverCode];
    });
  }

  return (
    <section className="grid w-full items-start gap-5 px-0 lg:grid-cols-[340px_minmax(0,1fr)_340px]">
      <aside className="self-start rounded-[1.5rem] border border-white/10 bg-black/35 p-4 shadow-[0_20px_80px_rgba(0,0,0,0.3)]">
        <h2 className="text-sm font-semibold uppercase tracking-[0.28em] text-zinc-300">Position board</h2>
        <div className="mt-4 space-y-2">
          {leaderboard.map((row) => (
            <div key={row.driverCode} className="grid grid-cols-[40px_1fr_auto] items-center gap-3 rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2">
              <div className="text-center text-lg font-semibold text-white">P{row.position}</div>
              <div className="flex items-center gap-2 text-white">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                <span className="font-semibold">{row.driverCode}</span>
              </div>
              <div className="text-right text-xs text-zinc-300">
                <div>{row.displayValue}</div>
                <div className="text-zinc-500">{row.statusLabel}</div>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <div className="self-start rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(11,12,18,0.96),rgba(5,6,10,0.98))] p-4 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-white">{selectedTrackName}</h2>
          <div className="text-xs text-zinc-400">
            {selectedYear} {selectedMode === "race" ? "Race Replay" : "Qualifying Replay"}
          </div>
        </div>
        <div className="relative overflow-hidden rounded-[1.2rem] border border-white/10 bg-black/55 p-2" style={{ minHeight: "700px" }}>
          <svg className="h-full w-full" viewBox={`0 0 ${geometry.width} ${geometry.height}`} role="img" aria-labelledby="track-title track-desc">
            <title id="track-title">{`${selectedTrackName} replay`}</title>
            <desc id="track-desc">Animated multi-driver qualifying replay with lap timers.</desc>
            <defs>
              <filter id="track-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="7" result="blur" />
                <feColorMatrix in="blur" type="matrix" values="1 0 0 0 1 0 1 0 0 1 0 0 1 0 1 0 0 0 0.45 0" />
              </filter>
            </defs>
            <rect width={geometry.width} height={geometry.height} fill="#05070c" rx="28" />
            <path d={geometry.path} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" filter="url(#track-glow)" />
            <path d={geometry.path} fill="none" stroke="#f8fafc" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
            {markersForRender.map((driver) => (
              <g key={driver.driverCode}>
                <circle cx={driver.drawX} cy={driver.drawY} r="7" fill={driver.color} stroke="#ffffff" strokeWidth="2" />
                <text x={driver.drawX + 10} y={driver.drawY - 10} fontSize="10" fontWeight="700" fill="#e5e7eb">{driver.driverCode}</text>
              </g>
            ))}
          </svg>
        </div>
      </div>

      <aside className="self-start space-y-4">
        <div className="rounded-[1.5rem] border border-white/10 bg-black/35 p-4 shadow-[0_20px_80px_rgba(0,0,0,0.3)]">
          <h2 className="text-sm font-semibold uppercase tracking-[0.28em] text-zinc-300">Track setup</h2>
          <div className="mt-3">
            <TrackSelector
              years={years}
              selectedYear={selectedYear}
              selectedSession={selectedMode}
              tracks={tracks}
              selectedTrackFileName={selectedTrackFileName}
            />
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-white/10 bg-black/35 p-4 shadow-[0_20px_80px_rgba(0,0,0,0.3)]">
          <h2 className="text-sm font-semibold uppercase tracking-[0.28em] text-zinc-300">Driver mode</h2>
          <div className="mt-3 grid gap-2 text-sm">
            <label className="flex items-center gap-2 text-zinc-200"><input type="radio" name="mode" checked={mode === "all"} onChange={() => setMode("all")} /> All drivers</label>
            <label className="flex items-center gap-2 text-zinc-200"><input type="radio" name="mode" checked={mode === "compare"} onChange={() => setMode("compare")} /> Compare up to 3 drivers</label>
          </div>
          {mode === "compare" ? (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-zinc-400">Select up to 3 drivers:</p>
              <div className="grid gap-2 pr-1">
                {normalizedDrivers.map((driver) => {
                  const checked = selectedDriverCodes.includes(driver.driverCode);
                  const disabled = !checked && selectedDriverCodes.length >= 3;
                  return (
                    <label key={driver.driverCode} className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-sm ${disabled ? "border-white/5 text-zinc-600" : "border-white/10 text-zinc-200"}`}>
                      <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleDriver(driver.driverCode)} />
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: driver.teamColor }} />
                      <span>{driver.driverCode}</span>
                    </label>
                  );
                })}
              </div>
              <div className="rounded-xl border border-cyan-400/25 bg-cyan-500/10 p-2 text-xs text-cyan-100">{selectedDriverCodes.length}/3 selected</div>
            </div>
          ) : null}
        </div>

        <div className="rounded-[1.5rem] border border-white/10 bg-black/35 p-4 shadow-[0_20px_80px_rgba(0,0,0,0.3)]">
          <h2 className="text-sm font-semibold uppercase tracking-[0.28em] text-zinc-300">Replay controls</h2>
          <div className="mt-3 grid gap-3">
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => setIsPlaying((v) => !v)} className="rounded-lg border border-white/15 bg-white/5 px-2 py-2 text-sm text-white">{isPlaying ? "Pause" : "Play"}</button>
              <button type="button" onClick={() => { setReplayMs(0); setIsPlaying(true); }} className="rounded-lg border border-white/15 bg-white/5 px-2 py-2 text-sm text-white">Restart</button>
              <select value={String(playbackRate)} onChange={(event) => setPlaybackRate(Number.parseFloat(event.target.value))} className="rounded-lg border border-white/15 bg-zinc-900/80 px-2 py-2 text-sm text-white">
                <option value="0.5">0.5x</option>
                <option value="1">1x</option>
                <option value="1.5">1.5x</option>
                <option value="2">2x</option>
              </select>
            </div>
            <input type="range" min={0} max={maxLapTimeMs} step={1} value={Math.min(replayMs, maxLapTimeMs)} onChange={(event) => setReplayMs(Number.parseInt(event.target.value, 10))} />
            <div className="text-sm text-zinc-200">
              Global replay: {formatLapTime(replayMs)} ({selectedMode === "race" ? "Race" : "Qualifying"})
            </div>
          </div>
          {mode === "compare" ? (
            <div className="mt-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">Live compare (time + speed)</h3>
              {compareLiveRows.map((driver) => (
                <div key={driver.driverCode} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-lg border border-white/10 bg-zinc-950/60 px-2 py-1">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: driver.color }} />
                  <div className="text-sm text-zinc-200"><span className="font-semibold">{driver.driverCode}</span><span className="ml-2 text-zinc-400">{formatLapTime(driver.timerMs)}</span></div>
                  <div className="text-right text-xs text-zinc-300">{driver.speedKph.toFixed(1)} km/h</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </aside>
    </section>
  );
}
