"""The turtle-style adapter (not stdlib turtle)."""
from graphics.turtle import Turtle

t = Turtle(width=420, height=420)
t.pencolor("rebeccapurple")
t.pensize(2)
for i in range(120):
    t.forward(5 + i * 2)
    t.left(61)
    t.pause(5)
