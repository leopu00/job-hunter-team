const assert = require("node:assert/strict");

const utf8Order = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const validName = (value) => typeof value === "string" && value.length > 0 && value.isWellFormed();

function exactObject(value, keys, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label}: object required`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label}: schema`);
}

function expectedCounts(snapshot) {
  exactObject(snapshot, ["version", "guard", "total", "elements"], "snapshot");
  assert.equal(snapshot.version, 1, "snapshot version");
  assert.ok(typeof snapshot.guard === "string" && snapshot.guard.length > 0, "snapshot guard");
  assert.ok(Number.isSafeInteger(snapshot.total) && snapshot.total >= 0, "snapshot total");
  assert.ok(Array.isArray(snapshot.elements), "snapshot elements");
  const counts = new Map();
  let total = 0;
  let previous;
  for (const element of snapshot.elements) {
    exactObject(element, ["name", "count"], "element");
    assert.ok(validName(element.name), "element name");
    assert.ok(Number.isSafeInteger(element.count) && element.count > 0, "element count");
    assert.ok(!counts.has(element.name), `duplicate snapshot element: ${element.name}`);
    if (previous !== undefined) assert.ok(utf8Order(previous, element.name) < 0, "snapshot UTF-8 order");
    previous = element.name;
    counts.set(element.name, element.count);
    total += element.count;
  }
  assert.equal(total, snapshot.total, "snapshot total differs from elements");
  return counts;
}

function difference(left, right) {
  return [...left]
    .map(([name, count]) => ({ name, count: count - (right.get(name) ?? 0) }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => utf8Order(a.name, b.name));
}

/** Compare exact names and safely representable integer counts; updates are explicit.
 * Empty matches are valid. Consumers also protect a nonempty `.inputs` inventory.
 */
function assertMultisetSnapshot(actual, expected) {
  const frozen = expectedCounts(expected);
  assert.notEqual(typeof actual, "string", "actual must be an iterable of names, not a string");
  assert.ok(actual != null && typeof actual[Symbol.iterator] === "function", "actual must be iterable");
  const found = new Map();
  for (const name of actual) {
    assert.ok(validName(name), "actual element name");
    found.set(name, (found.get(name) ?? 0) + 1);
  }
  const missing = difference(frozen, found);
  const extra = difference(found, frozen);
  assert.ok(missing.length === 0 && extra.length === 0,
    `${expected.guard}: source inventory changed; missing=${JSON.stringify(missing)}, extra=${JSON.stringify(extra)}. ` +
    "Inspect acquisition and update the checked-in snapshot deliberately.");
}

exports.assertMultisetSnapshot = assertMultisetSnapshot;
