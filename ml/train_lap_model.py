import fastf1
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor

# Load dataset from CSV
df = pd.read_csv('data/datasets/monza_q_data.csv')

# Now you want to predict lap times(Target) based on features(avg_speed, max_speed etc)

# Features(x)
x = df[['avg_speed', 'max_speed', 'throttle_mean', 'brake_mean']]

# target(y)
y = df['lap_time']

# Split the dataset into training and testing sets
x_train, x_test, y_train, y_test = train_test_split(x, y)

# Train model using Random Forest Regressor
model = RandomForestRegressor()
model.fit(x_train, y_train)

# Tell that the model is trained
print("Model trained")

#Test the prediction of the model
preds = model.predict(x_test[:10])

print('Actual times:', y_test[:10].values)
print('Predicted times:', preds)