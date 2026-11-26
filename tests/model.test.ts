import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { enabledCount, snapshotSchema } from "../shared/types";

test("pool membership includes exhausted accounts and keeps instances separate", () => {
  const sample = JSON.parse(readFileSync("fixtures/normalized/overview.mock.json", "utf8"));
  const sources = snapshotSchema.array().parse(sample.snapshots);
  assert.deepEqual(sources.slice(0, 2).map(source => [enabledCount(source.accounts), source.accounts.length]), [[2, 3], [1, 1]]);
});
