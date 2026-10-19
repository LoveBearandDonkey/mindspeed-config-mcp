import assert from "node:assert/strict";
import test from "node:test";

import {
  compareSnapshotFields,
  saveProjectSnapshot,
  snapshotsForProject,
} from "../ui/src/mcp-analysis-notebook.js";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("快照只列出当前工程，保留时间与来源元数据", () => {
  const local = storage();
  const a = { id: "a", captured_at: "2026-10-18T00:00:00Z", source: { name: "a.sh" } };
  const b = { id: "b", captured_at: "2026-10-19T00:00:00Z", source: { name: "b.sh" } };
  saveProjectSnapshot(local, "project-a", a);
  saveProjectSnapshot(local, "project-b", b);
  assert.deepEqual(snapshotsForProject(local, "project-a"), [a]);
  assert.deepEqual(snapshotsForProject(local, "project-b"), [b]);
});

test("方案比较只输出页面字段差异，不冒充源文件 diff", () => {
  const before = { config: { parallel: { tp: 2, pp: 4 }, cluster: { total_ranks: 64 } } };
  const after = { config: { parallel: { tp: 4, pp: 4 }, cluster: { total_ranks: 64 } } };
  assert.deepEqual(compareSnapshotFields(before, after), [
    { path: "parallel.tp", old_value: 2, new_value: 4 },
  ]);
});
