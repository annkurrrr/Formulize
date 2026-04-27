import fastf1
import pandas as pd

fastf1.Cache.enable_cache('cache')

session = fastf1.get_session(2023, 'Monza', 'Q')
session.load()

laps = session.laps.pick_quicklaps()

data = []

for _, lap in laps.iterrows():
    try:
        tel = lap.get_car_data().add_distance()

        row = {
            'lap_time' : lap['LapTime'].total_seconds(),
            'avg_speed' : tel['Speed'].mean(),
            'max_speed' : tel['Speed'].max(),
            'throttle_mean' : tel['Throttle'].mean(),
            'brake_mean' : tel['Brake'].mean(),
        }

        data.append(row)

    except:
        continue

df = pd.DataFrame(data)
print(df.head())
df.to_csv('data/datasets/monza_q_data.csv', index=False)