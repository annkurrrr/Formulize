import os

import fastf1
import pandas as pd

fastf1.Cache.enable_cache('cache')
os.makedirs('data/datasets', exist_ok=True)

for year in [2023, 2024, 2025]:
	os.makedirs(f'data/datasets/{year}/Tracks', exist_ok=True)

	schedule = fastf1.get_event_schedule(year)
	rounds = schedule[schedule['RoundNumber'].notna() & (schedule['RoundNumber'] > 0)]

	print(f"\n=== Extracting season {year} ===")

	for _, event in rounds.iterrows():
		round_number = int(event['RoundNumber'])
		event_name = str(event['EventName'])

		print(f"Extracting {year} round {round_number:02d}: {event_name}")

		try:
			session = fastf1.get_session(year, round_number, 'Q')
			session.load()

			laps = session.laps.pick_quicklaps()
			if laps.empty:
				laps = session.laps

			fastest_lap = laps.pick_fastest()
			if fastest_lap is None:
				print(f"Failed: {year} round {round_number:02d} ({event_name}) -> No fastest lap found")
				continue

			pos = fastest_lap.get_pos_data()[['X', 'Y']].dropna().copy()
			if pos.empty:
				print(f"Failed: {year} round {round_number:02d} ({event_name}) -> No position data found")
				continue

			# remove duplicate consecutive points
			pos = pos[(pos[['X', 'Y']].diff().abs().sum(axis=1) > 0).fillna(True)]

			# light smoothing to reduce telemetry jitter
			pos['X'] = pos['X'].rolling(5, center=True, min_periods=1).mean()
			pos['Y'] = pos['Y'].rolling(5, center=True, min_periods=1).mean()

			track = pos.reset_index(drop=True)
			track.to_csv(
				f"data/datasets/{year}/Tracks/{round_number:02d}_{event_name.lower().replace(' ', '_').replace('-', '_').replace('.', '').replace('/', '_')}_track.csv",
				index=False,
			)

			print("Track saved!")
		except Exception as exc:
			print(f"Failed: {year} round {round_number:02d} ({event_name}) -> {exc}")