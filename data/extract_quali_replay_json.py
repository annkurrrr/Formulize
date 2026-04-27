import json
import os

import fastf1
import pandas as pd

fastf1.Cache.enable_cache('cache')
os.makedirs('data/datasets', exist_ok=True)

# Standard F1 team color mapping (hex)
TEAM_COLORS = {
	'Red Bull Racing': '#3671C6',
	'Mercedes': '#00D4BE',
	'McLaren': '#FF8700',
	'Ferrari': '#DC0000',
	'Aston Martin': '#006F62',
	'RB': '#6692FF',
	'Haas F1 Team': '#FFFFFF',
	'Alpine': '#0093D0',
	'Williams': '#005AFF',
	'Sauber': '#52E252',
}

for year in [2023, 2024, 2025]:
	os.makedirs(f'data/datasets/{year}/Quali-Replays', exist_ok=True)

	schedule = fastf1.get_event_schedule(year)
	rounds = schedule[schedule['RoundNumber'].notna() & (schedule['RoundNumber'] > 0)]

	print(f"\n=== Building qualifying replay JSON for {year} ===")

	for _, event in rounds.iterrows():
		round_number = int(event['RoundNumber'])
		event_name = str(event['EventName'])
		event_slug = event_name.lower().replace(' ', '_').replace('-', '_').replace('.', '').replace('/', '_')

		print(f"Extracting {year} round {round_number:02d}: {event_name}")

		try:
			session = fastf1.get_session(year, round_number, 'Q')
			session.load()

			# Build driver metadata lookup from session.results
			driver_info = {}
			for _, driver_row in session.results.iterrows():
				driver_num = int(driver_row['DriverNumber'])
				driver_code = driver_row['Abbreviation']
				full_name = driver_row['FullName']
				team_name = driver_row['TeamName']
				team_color = TEAM_COLORS.get(team_name, '#CCCCCC')
				driver_info[driver_code] = {
					'fullName': full_name,
					'teamName': team_name,
					'teamColor': team_color,
				}

			driver_rows = []
			driver_codes = [code for code in session.laps['Driver'].dropna().unique().tolist() if code]

			for driver_code in driver_codes:
				driver_laps = session.laps.pick_drivers(driver_code).pick_quicklaps()
				if driver_laps.empty:
					driver_laps = session.laps.pick_drivers(driver_code)

				if driver_laps.empty:
					continue

				fastest_lap = driver_laps.pick_fastest()
				if fastest_lap is None or pd.isna(fastest_lap['LapTime']):
					continue

				lap_time_ms = int(fastest_lap['LapTime'].total_seconds() * 1000)

				# Get position data (X, Y coordinates only)
				pos = fastest_lap.get_pos_data()[['Time', 'X', 'Y']].dropna().copy()
				if pos.empty:
					continue

				# Get car data for speed
				car_data = fastest_lap.get_car_data()[['SessionTime', 'Speed']].dropna().copy()
				if car_data.empty:
					car_data = pd.DataFrame({'SessionTime': pos['Time'], 'Speed': 0.0})
				else:
					# Merge position and car data on time using nearest match
					pos = pd.merge_asof(
						pos.sort_values('Time'),
						car_data.set_index('SessionTime').reset_index().rename(columns={'SessionTime': 'Time'}),
						on='Time',
						direction='nearest'
					)
					pos['Speed'] = pos['Speed'].fillna(0.0)

				# remove duplicate consecutive points to keep payload lean
				pos = pos[
					(pos[['X', 'Y']].diff().abs().sum(axis=1) > 0).fillna(True)
				]

				# normalize timestamp to milliseconds from lap start
				pos['tMs'] = (pos['Time'] - pos['Time'].iloc[0]).dt.total_seconds() * 1000
				pos = pos[pos['tMs'] <= lap_time_ms]
				if pos.empty:
					continue

				samples = [
					{
						'tMs': int(row['tMs']),
						'x': float(row['X']),
						'y': float(row['Y']),
						'speedKph': float(row['Speed']) if 'Speed' in row.index else 0.0,
					}
					for _, row in pos.iterrows()
				]

				# Get driver metadata from lookup
				meta = driver_info.get(driver_code, {
					'fullName': driver_code,
					'teamName': 'Unknown',
					'teamColor': '#CCCCCC',
				})

				driver_rows.append(
					{
						'driverCode': driver_code,
						'fullName': meta['fullName'],
						'teamName': meta['teamName'],
						'teamColor': meta['teamColor'],
						'lapTimeMs': lap_time_ms,
						'samples': samples,
					}
				)

			driver_rows = sorted(driver_rows, key=lambda driver: driver['lapTimeMs'])

			payload = {
				'year': year,
				'eventName': event_name,
				'session': 'Q',
				'generatedAt': pd.Timestamp.utcnow().isoformat(),
				'drivers': driver_rows,
			}

			output_path = (
				f"data/datasets/{year}/Quali-Replays/"
				f"{round_number:02d}_{event_slug}_quali_replay.json"
			)

			with open(output_path, 'w', encoding='utf-8') as outfile:
				json.dump(payload, outfile, ensure_ascii=False)

			print(f"Replay JSON saved: {output_path}")
		except Exception as exc:
			print(f"Failed: {year} round {round_number:02d} ({event_name}) -> {exc}")
