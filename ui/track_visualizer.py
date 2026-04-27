import tkinter as tk
import pandas as pd

# Load Track Data
df = pd.read_csv('data/datasets/monza_track.csv')

# Normalize coordinates
x = df['Y']
y = -df['X']

min_x, max_x = x.min(), x.max()
min_y, max_y = y.min(), y.max()

# Scale to fit window
WIDTH, HEIGHT = 800, 600
PAD = 40

span_x = max_x - min_x
span_y = max_y - min_y

scale_x = (WIDTH - 2 * PAD) / span_x
scale_y = (HEIGHT - 2 * PAD) / span_y
scale = min(scale_x, scale_y)

used_w = span_x * scale
used_h = span_y * scale

offset_x = (WIDTH - used_w) / 2
offset_y = (HEIGHT - used_h) / 2

points = [
    (
        WIDTH - (xi - min_x) * scale + offset_x,
        (yi - min_y) * scale + offset_y
    )
    for xi, yi in zip(x, y)
]

# Create Tkinter Window
root = tk.Tk()
root.title("F1 Track Visualizer")

canvas = tk.Canvas(root, width=WIDTH, height=HEIGHT, bg="black")
canvas.pack()

# Draw Track
for i in range(len(points) - 1):
    canvas.create_line(
        points[i+1][0], points[i+1][1],
        points[i+1][0], points[i+1][1],
        fill="white",
        width=8
    )

canvas.create_line(
    points[-1][0], points[-1][1],
    points[0][0], points[0][1],
    fill="white",
    width=8
)

# Draw Driver (just one point)
x0, y0 = points[0]

canvas.create_oval(
    x0 - 5, y0 - 5,
    x0 + 5, y0 + 5,
    fill="red"
)

# Run App
root.mainloop()