import "server-only";

import fs from "node:fs";
import path from "node:path";

export type TrackPoint = {
  x: number;
  y: number;
};

export type TrackGeometry = {
  width: number;
  height: number;
  padding: number;
  points: TrackPoint[];
  path: string;
  start: TrackPoint;
  transform: {
    minX: number;
    minY: number;
    scale: number;
    offsetX: number;
    offsetY: number;
  };
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
};

type RawTrackPoint = {
  X: number;
  Y: number;
};

export type TrackOption = {
  fileName: string;
  label: string;
  roundNumber: number | null;
};

export const SUPPORTED_YEARS = [2023, 2024, 2025] as const;
export type SupportedYear = (typeof SUPPORTED_YEARS)[number];

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const DEFAULT_PADDING = 40;
const DATASETS_DIR_PATH = path.resolve(process.cwd(), "..", "..", "data", "datasets");

function getTracksDirPath(year: SupportedYear): string {
  return path.join(DATASETS_DIR_PATH, String(year), "Tracks");
}

function normalizeLabel(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseTrackFileName(fileName: string): TrackOption {
  const match = fileName.match(/^(\d+)_([\s\S]+)_track\.csv$/i);
  if (!match) {
    return {
      fileName,
      label: fileName.replace(/\.csv$/i, ""),
      roundNumber: null,
    };
  }

  return {
    fileName,
    label: normalizeLabel(match[2]),
    roundNumber: Number.parseInt(match[1], 10),
  };
}

export function getAvailableTracks(year: SupportedYear): TrackOption[] {
  const tracksDirPath = getTracksDirPath(year);

  if (!fs.existsSync(tracksDirPath)) {
    return [];
  }

  const files = fs
    .readdirSync(tracksDirPath)
    .filter((fileName) => fileName.toLowerCase().endsWith(".csv"))
    .map(parseTrackFileName)
    .sort((a, b) => {
      if (a.roundNumber !== null && b.roundNumber !== null) {
        return a.roundNumber - b.roundNumber;
      }

      if (a.roundNumber !== null) {
        return -1;
      }

      if (b.roundNumber !== null) {
        return 1;
      }

      return a.label.localeCompare(b.label);
    });

  return files;
}

function readTrackRows(year: SupportedYear, fileName: string): RawTrackPoint[] {
  const trackPath = path.join(getTracksDirPath(year), fileName);
  const csv = fs.readFileSync(trackPath, "utf8").trim();
  const [, ...lines] = csv.split(/\r?\n/);

  return lines
    .map((line) => {
      const [xValue, yValue] = line.split(",");
      return {
        X: Number.parseFloat(xValue),
        Y: Number.parseFloat(yValue),
      } satisfies RawTrackPoint;
    })
    .filter((point) => Number.isFinite(point.X) && Number.isFinite(point.Y));
}

export function getTrackGeometry(
  year: SupportedYear,
  trackFileName: string,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  padding = DEFAULT_PADDING,
): TrackGeometry {
  const rows = readTrackRows(year, trackFileName);

  const xValues = rows.map((point) => point.Y);
  const yValues = rows.map((point) => -point.X);

  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);

  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);

  const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);
  const usedWidth = spanX * scale;
  const usedHeight = spanY * scale;
  const offsetX = (width - usedWidth) / 2;
  const offsetY = (height - usedHeight) / 2;

  const points = xValues.map((xValue, index) => {
    const yValue = yValues[index];

    return {
      // Mirror horizontally and keep the centered offset inside the viewport.
      x: width - ((xValue - minX) * scale + offsetX),
      y: (yValue - minY) * scale + offsetY,
    };
  });

  const pathData =
    points.length > 0
      ? [
          `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`,
          ...points.slice(1).map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
          "Z",
        ].join(" ")
      : "";

  return {
    width,
    height,
    padding,
    points,
    path: pathData,
    start: points[0] ?? { x: width / 2, y: height / 2 },
    transform: {
      minX,
      minY,
      scale,
      offsetX,
      offsetY,
    },
    bounds: {
      minX,
      maxX,
      minY,
      maxY,
    },
  };
}

export function projectTelemetryPoint(
  xWorld: number,
  yWorld: number,
  geometry: TrackGeometry,
): TrackPoint {
  const xValue = yWorld;
  const yValue = -xWorld;

  return {
    x: geometry.width - ((xValue - geometry.transform.minX) * geometry.transform.scale + geometry.transform.offsetX),
    y: (yValue - geometry.transform.minY) * geometry.transform.scale + geometry.transform.offsetY,
  };
}
