from graphics import Canvas
canvas = Canvas(300, 200, 'Native controls')
name = canvas.create_text_field('Name')
button = canvas.create_button('Submit controls')
gravity = canvas.create_checkbox('Gravity', True)
strength = canvas.create_slider('Strength', 0, 100, 20)
brush = canvas.create_choice('Brush', ['Sand', 'Rock'], 'Sand')
assert canvas.get_control_value(gravity) is True
assert canvas.get_control_value(strength) == 20
assert canvas.get_control_value(brush) == 'Sand'
seen = set()
while len(seen) < 6:
    event = canvas.get_event()
    if event is None: continue
    assert event.type not in ('keydown', 'keypress', 'keyup'), 'Control typing leaked into canvas keyboard events'
    if event.type == 'controlsubmit' and event.control_id == name:
        assert event.value == 'Hello'
        seen.add('return')
    if event.type == 'controlclick' and event.control_id == button: seen.add('button')
    if event.type == 'controlchange':
        if event.control_id == gravity and event.value is False: seen.add('checkbox')
        if event.control_id == strength and event.value == 100: seen.add('slider')
        if event.control_id == brush and event.value == 'Rock': seen.add('choice')
    if event.type == 'mouseup' and event.x < 0: seen.add('outside-release')
print('CONTROLS_PASS defaults return button checkbox slider choice pointer-capture focus')
