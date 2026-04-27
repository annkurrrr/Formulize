import json
import os
from dataclasses import dataclass
from typing import Any

import fastf1
import pandas as pd

fastf1.Cache.enable_cache("cache")
os.makedirs("data/datasets", exist_ok=True)

TEAM_COLORS = {
    "Red Bull Racing": "#3671C6",
    "Mercedes": "#00D4BE",
    "McLaren": "#FF8700",
    "Ferrari": "#DC0000",
    "Aston Martin": "#006F62",
    "RB": "#6692FF",
    "Haas F1 Team": "#FFFFFF",
    "Alpine": "#0093D0",
    "Williams": "#005AFF",
    "Sauber": "#52E252",
}

YEARS = [2023, 2024, 2025]


@dataclass
class DriverMeta:
    full_name: str
    team_name: str
    team_color: str
    driver_number: str


def slugify_event_name(event_name: str) -> str:
    return (
        event_name.lower()
        .replace(" ", "_")
        .replace("-", "_")
        .replace(".", "")
        .replace("/", "_")
    )


def td_to_ms(value: Any) -> int | None:
    if value is None or pd.isna(value):
        return None
    return int(value.total_seconds() * 1000)


def safe_int(value: Any) -> int | None:
    if value is None or pd.isna(value):
        return None
    return int(value)


def safe_float(value: Any, default: float = 0.0) -> float:
    if value is None or pd.isna(value):
        return default
    return float(value)


def build_driver_meta_lookup(session: fastf1.core.Session) -> dict[str, DriverMeta]:
    lookup: dict[str, DriverMeta] = {}

    for _, row in session.results.iterrows():
        driver_code = str(row.get("Abbreviation", "")).strip()
        if not driver_code:
            continue

        team_name = str(row.get("TeamName", "Unknown"))
        lookup[driver_code] = DriverMeta(
            full_name=str(row.get("FullName", driver_code)),
            team_name=team_name,
            team_color=TEAM_COLORS.get(team_name, "#CCCCCC"),
            driver_number=str(row.get("DriverNumber", "")),
        )

    return lookup


def build_driver_result_lookup(session: fastf1.core.Session) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}

    for _, row in session.results.iterrows():
        driver_code = str(row.get("Abbreviation", "")).strip()
        if not driver_code:
            continue

        lookup[driver_code] = {
            "finishPosition": safe_int(row.get("Position")),
            "status": str(row.get("Status", "")),
            "points": safe_float(row.get("Points"), 0.0),
            "classifiedTimeMs": td_to_ms(row.get("Time")),
        }

    return lookup


def compute_stints(laps_df: pd.DataFrame, lap_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if laps_df.empty:
        return []

    stints: list[dict[str, Any]] = []
    stint_groups = laps_df[laps_df["Stint"].notna()].groupby("Stint", sort=True)

    for stint_value, stint_df in stint_groups:
        stint_number = int(stint_value)
        stint_df = stint_df.sort_values("LapNumber")

        lap_numbers = [safe_int(v) for v in stint_df["LapNumber"].tolist()]
        lap_numbers = [lap for lap in lap_numbers if lap is not None]
        if not lap_numbers:
            continue

        compounds = [str(v) for v in stint_df["Compound"].dropna().tolist() if str(v)]
        compound = compounds[0] if compounds else "UNKNOWN"

        tyre_life_values = [safe_int(v) for v in stint_df["TyreLife"].tolist()]
        tyre_life_values = [v for v in tyre_life_values if v is not None]
        tyre_life_start = tyre_life_values[0] if tyre_life_values else None
        tyre_life_end = tyre_life_values[-1] if tyre_life_values else None

        lap_time_values = [td_to_ms(v) for v in stint_df["LapTime"].tolist()]
        lap_time_values = [v for v in lap_time_values if v is not None]

        degradation_delta_ms = None
        if len(lap_time_values) >= 4:
            first_window = lap_time_values[: min(3, len(lap_time_values))]
            last_window = lap_time_values[-min(3, len(lap_time_values)) :]
            degradation_delta_ms = int(sum(last_window) / len(last_window) - sum(first_window) / len(first_window))

        lap_row_lookup = {row["lapNumber"]: row for row in lap_rows if row.get("lapNumber") is not None}
        start_lap = lap_numbers[0]
        end_lap = lap_numbers[-1]

        stints.append(
            {
                "stint": stint_number,
                "compound": compound,
                "startLap": start_lap,
                "endLap": end_lap,
                "startTMs": lap_row_lookup.get(start_lap, {}).get("lapStartMs"),
                "endTMs": lap_row_lookup.get(end_lap, {}).get("lapEndMs"),
                "tyreLifeStart": tyre_life_start,
                "tyreLifeEnd": tyre_life_end,
                "degradationLapTimeDeltaMs": degradation_delta_ms,
            }
        )

    return stints


def build_driver_payload(
    driver_code: str,
    session: fastf1.core.Session,
    meta: DriverMeta,
    result_lookup: dict[str, Any],
) -> dict[str, Any] | None:
    driver_laps = session.laps.pick_drivers(driver_code).copy()
    if driver_laps.empty:
        return None

    driver_laps = driver_laps[driver_laps["LapStartTime"].notna()].sort_values("LapNumber")
    if driver_laps.empty:
        return None

    samples: list[dict[str, Any]] = []
    lap_rows: list[dict[str, Any]] = []
    position_timeline: list[dict[str, Any]] = []
    overtakes: list[dict[str, Any]] = []

    previous_position: int | None = None

    for _, lap in driver_laps.iterrows():
        lap_number = safe_int(lap.get("LapNumber"))
        if lap_number is None:
            continue

        lap_start_ms = td_to_ms(lap.get("LapStartTime"))
        lap_end_ms = td_to_ms(lap.get("Time"))
        lap_time_ms = td_to_ms(lap.get("LapTime"))
        position = safe_int(lap.get("Position"))
        stint = safe_int(lap.get("Stint"))
        tyre_life_laps = safe_int(lap.get("TyreLife"))
        compound = str(lap.get("Compound", "UNKNOWN"))

        lap_rows.append(
            {
                "lapNumber": lap_number,
                "lapStartMs": lap_start_ms,
                "lapEndMs": lap_end_ms,
                "lapTimeMs": lap_time_ms,
                "position": position,
                "stint": stint,
                "compound": compound,
                "tyreLifeLaps": tyre_life_laps,
            }
        )

        if position is not None and lap_end_ms is not None:
            position_timeline.append(
                {
                    "tMs": lap_end_ms,
                    "lapNumber": lap_number,
                    "position": position,
                }
            )

            if previous_position is not None and position != previous_position:
                overtakes.append(
                    {
                        "tMs": lap_end_ms,
                        "lapNumber": lap_number,
                        "fromPosition": previous_position,
                        "toPosition": position,
                    }
                )

            previous_position = position

        try:
            pos = lap.get_pos_data()[["Time", "X", "Y"]].dropna().copy()
        except Exception:
            pos = pd.DataFrame()

        if pos.empty or lap_start_ms is None:
            continue

        try:
            car_data = lap.get_car_data()[["SessionTime", "Speed"]].dropna().copy()
        except Exception:
            car_data = pd.DataFrame()

        if car_data.empty:
            pos["Speed"] = 0.0
        else:
            pos = pd.merge_asof(
                pos.sort_values("Time"),
                car_data.rename(columns={"SessionTime": "Time"}).sort_values("Time"),
                on="Time",
                direction="nearest",
            )
            pos["Speed"] = pos["Speed"].fillna(0.0)

        local_start = pos["Time"].iloc[0]
        pos["globalTMs"] = lap_start_ms + (
            (pos["Time"] - local_start).dt.total_seconds() * 1000
        )

        if lap_end_ms is not None:
            pos = pos[pos["globalTMs"] <= lap_end_ms]

        if pos.empty:
            continue

        pos = pos[(pos[["X", "Y"]].diff().abs().sum(axis=1) > 0).fillna(True)]

        for _, row in pos.iterrows():
            samples.append(
                {
                    "tMs": int(row["globalTMs"]),
                    "x": float(row["X"]),
                    "y": float(row["Y"]),
                    "speedKph": safe_float(row.get("Speed", 0.0), 0.0),
                    "lapNumber": lap_number,
                    "compound": compound,
                    "tyreLifeLaps": tyre_life_laps,
                }
            )

    if not samples:
        return None

    samples_df = pd.DataFrame(samples).sort_values("tMs")
    samples_df = samples_df.drop_duplicates(subset=["tMs"], keep="last")

    normalized_samples = [
        {
            "tMs": int(row["tMs"]),
            "x": float(row["x"]),
            "y": float(row["y"]),
            "speedKph": float(row["speedKph"]),
            "lapNumber": safe_int(row.get("lapNumber")),
            "compound": str(row.get("compound", "UNKNOWN")),
            "tyreLifeLaps": safe_int(row.get("tyreLifeLaps")),
        }
        for _, row in samples_df.iterrows()
    ]

    race_time_ms = result_lookup.get("classifiedTimeMs")
    if race_time_ms is None:
        race_time_ms = max(sample["tMs"] for sample in normalized_samples)

    stints = compute_stints(driver_laps, lap_rows)

    return {
        "driverCode": driver_code,
        "fullName": meta.full_name,
        "teamName": meta.team_name,
        "teamColor": meta.team_color,
        "driverNumber": meta.driver_number,
        "finishPosition": result_lookup.get("finishPosition"),
        "status": result_lookup.get("status", ""),
        "points": result_lookup.get("points", 0.0),
        "raceTimeMs": race_time_ms,
        "samples": normalized_samples,
        "positionTimeline": position_timeline,
        "laps": lap_rows,
        "stints": stints,
        "overtakes": overtakes,
    }


def build_race_replay_payload(year: int, round_number: int, event_name: str) -> dict[str, Any] | None:
    session = fastf1.get_session(year, round_number, "R")
    session.load()

    driver_meta = build_driver_meta_lookup(session)
    driver_results = build_driver_result_lookup(session)

    driver_codes = [code for code in session.laps["Driver"].dropna().unique().tolist() if code]
    drivers: list[dict[str, Any]] = []

    for driver_code in driver_codes:
        meta = driver_meta.get(
            driver_code,
            DriverMeta(
                full_name=driver_code,
                team_name="Unknown",
                team_color="#CCCCCC",
                driver_number="",
            ),
        )

        result_lookup = driver_results.get(driver_code, {})
        payload = build_driver_payload(driver_code, session, meta, result_lookup)
        if payload is not None:
            drivers.append(payload)

    if not drivers:
        return None

    drivers.sort(
        key=lambda row: (
            row.get("finishPosition") if row.get("finishPosition") is not None else 999,
            row.get("raceTimeMs") if row.get("raceTimeMs") is not None else 10**12,
        )
    )

    return {
        "year": year,
        "eventName": event_name,
        "session": "R",
        "generatedAt": pd.Timestamp.utcnow().isoformat(),
        "drivers": drivers,
    }


def main() -> None:
    for year in YEARS:
        output_dir = f"data/datasets/{year}/Race-Replays"
        os.makedirs(output_dir, exist_ok=True)

        schedule = fastf1.get_event_schedule(year)
        rounds = schedule[schedule["RoundNumber"].notna() & (schedule["RoundNumber"] > 0)]

        print(f"\n=== Building race replay JSON for {year} ===")

        for _, event in rounds.iterrows():
            round_number = int(event["RoundNumber"])
            event_name = str(event["EventName"])
            event_slug = slugify_event_name(event_name)

            print(f"Extracting {year} round {round_number:02d}: {event_name}")

            try:
                payload = build_race_replay_payload(year, round_number, event_name)
                if payload is None:
                    print(f"Skipped: {year} round {round_number:02d} ({event_name}) -> no data")
                    continue

                output_path = (
                    f"data/datasets/{year}/Race-Replays/"
                    f"{round_number:02d}_{event_slug}_race_replay.json"
                )

                with open(output_path, "w", encoding="utf-8") as outfile:
                    json.dump(payload, outfile, ensure_ascii=False)

                print(f"Replay JSON saved: {output_path}")
            except Exception as exc:
                print(f"Failed: {year} round {round_number:02d} ({event_name}) -> {exc}")


if __name__ == "__main__":
    main()
