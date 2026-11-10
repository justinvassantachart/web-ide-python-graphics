"""Adapted browser shell for Baby Graphics. Replace draw_graph with student work.

This original shell uses labeled native text fields and Return handlers rather
than Tk. Student drawing functions receive the ordinary graphics Canvas.
"""
from graphics import Canvas

canvas = Canvas(600, 400, 'Baby Graphics')

def draw_graph(canvas, first, second):
    canvas.clear()
    canvas.create_line(40, 350, 560, 350, fill='navy', width=2)
    canvas.create_text(40, 340, first + ' / ' + second, anchor='sw')

def submit(event):
    draw_graph(canvas, canvas.get_text_field_text(first), canvas.get_text_field_text(second))

first = canvas.create_text_field('First name', callback=submit)
second = canvas.create_text_field('Second name', callback=submit)
canvas.create_button('Draw', callback=submit)
canvas.mainloop()
