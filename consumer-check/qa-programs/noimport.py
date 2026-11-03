try:
    from graphics import Canvas
    print("graphics available")
except ModuleNotFoundError as e:
    print("no graphics module:", e)
print("still running fine")
