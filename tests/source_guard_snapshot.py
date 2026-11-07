"""Exact, explicitly updated multisets for source guards (test support only).

Acquisition belongs to each language's reader. An empty matches snapshot is
valid, but its consumer must also freeze a nonempty ``.inputs`` inventory.
"""

from collections import Counter


def _snapshot_counts(expected):
    assert isinstance(expected, dict), "snapshot must be an object"
    assert set(expected) == {"version", "guard", "total", "elements"}, "snapshot schema"
    assert type(expected["version"]) is int and expected["version"] == 1, "snapshot version"
    assert isinstance(expected["guard"], str) and expected["guard"], "snapshot guard"
    assert type(expected["total"]) is int and expected["total"] >= 0, "snapshot total"
    assert isinstance(expected["elements"], list), "snapshot elements"
    names, counts = [], {}
    for element in expected["elements"]:
        assert isinstance(element, dict) and set(element) == {"name", "count"}, "element schema"
        name, count = element["name"], element["count"]
        assert isinstance(name, str) and name, "element name"
        assert type(count) is int and count > 0, "element count"
        assert name not in counts, f"duplicate snapshot element: {name}"
        names.append(name)
        counts[name] = count
    assert names == sorted(names, key=lambda name: name.encode("utf-8")), "snapshot UTF-8 order"
    assert sum(counts.values()) == expected["total"], "snapshot total differs from elements"
    return Counter(counts)


def assert_multiset_snapshot(actual, expected):
    """Compare names AND multiplicities; never refresh a snapshot implicitly."""
    frozen = _snapshot_counts(expected)
    assert not isinstance(actual, (str, bytes)), "actual must be an iterable of names"
    names = list(actual)
    assert all(isinstance(name, str) and name for name in names), "actual element name"
    found = Counter(names)
    missing, extra = frozen - found, found - frozen
    assert not missing and not extra, (
        f"{expected['guard']}: source inventory changed; "
        f"missing={dict(missing)}, extra={dict(extra)}. "
        "Inspect acquisition and update the checked-in snapshot deliberately."
    )
