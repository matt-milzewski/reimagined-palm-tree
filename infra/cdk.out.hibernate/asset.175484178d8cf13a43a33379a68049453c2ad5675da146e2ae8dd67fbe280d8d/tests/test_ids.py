from common.ids import new_id


def test_new_id_unique():
    first = new_id()
    second = new_id()
    assert first != second
    assert len(first) > 10
