import test from "node:test";
import assert from "node:assert/strict";

import { runTabletNight } from "../src/scenario.ts";
import { Tracer } from "../src/trace.ts";

test("trace 覆盖身体/能力/判定/结果/日志", () => {
  const tracer = new Tracer("full", false);
  runTabletNight("42", { trace: tracer });
  const text = tracer.text();

  assert.match(text, /\[body\]/);
  assert.match(text, /\[caps\]/);
  assert.match(text, /\[check\.hard\]/);
  assert.match(text, /\[check\.capability\]/);
  assert.match(text, /\[check\.roll\]/);
  assert.match(text, /\[result\]/);
  assert.match(text, /\[log\] seq=1/);
  assert.match(text, /take-stylus-bound/);
});

test("off 级别不产生任何行", () => {
  const tracer = new Tracer("off", false);
  runTabletNight("42", { trace: tracer });
  assert.equal(tracer.text(), "");
});
