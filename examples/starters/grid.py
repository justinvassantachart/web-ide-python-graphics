"""Pure-Python grid for adapted course starters; no browser service required."""
class Grid:
    def __init__(self, width, height):
        if type(width) is not int or type(height) is not int or width < 1 or height < 1:
            raise ValueError('positive integer grid dimensions required')
        self.width, self.height = width, height
        self._values = [[None] * width for _ in range(height)]

    @classmethod
    def build(cls, values):
        if not values or not values[0] or any(len(row) != len(values[0]) for row in values):
            raise ValueError('grid rows must be nonempty and equal length')
        result = cls(len(values[0]), len(values))
        result._values = [list(row) for row in values]
        return result

    def in_bounds(self, x, y):
        return type(x) is int and type(y) is int and 0 <= x < self.width and 0 <= y < self.height

    def get(self, x, y):
        if not self.in_bounds(x, y): raise IndexError('grid coordinate out of bounds')
        return self._values[y][x]

    def set(self, x, y, value):
        if not self.in_bounds(x, y): raise IndexError('grid coordinate out of bounds')
        self._values[y][x] = value

    def __repr__(self):
        return 'Grid.build(%r)' % self._values
