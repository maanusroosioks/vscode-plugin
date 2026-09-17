import pytest

from calculator import add, divide

# def test_decoy(): this is a comment, not a declaration


def helper(value):
    return value * 2


def test_add_returns_sum():
    assert add(2, 3) == 5


@pytest.mark.parametrize(
    "a,b,expected",
    [
        (10, 2, 5),
        (9, 3, 3),
    ],
)
def test_divide_returns_quotient(a, b, expected):
    assert divide(a, b) == expected


def test_uses_a_nested_helper():
    def inner(value):
        return value + 1

    assert inner(add(1, 1)) == 3


def test_empty_body():
    pass


def test_only_a_docstring():
    """Should have asserted something."""


@pytest.mark.skip(reason="not implemented yet")
def test_skipped_outright():
    assert add(1, 1) == 2


async def test_async_add():
    assert add(4, 4) == 8


def test_one_liner(): assert add(0, 0) == 0


def test_brace_in_a_string():
    assert "{" + "}" == "{}"


class TestMath:
    def test_add(self):
        self.assertEqual = None
        assert add(1, 1) == 2

    def test_divide_by_zero(self):
        with pytest.raises(ZeroDivisionError):
            divide(1, 0)


@pytest.mark.skip(reason="whole class parked")
class TestParked:
    def test_add(self):
        assert add(3, 3) == 6
