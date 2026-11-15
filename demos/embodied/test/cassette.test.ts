import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CassetteClient, cassetteKey } from "../../../llm/cassette.ts";
import { StubClient } from "./stub-client.ts";

const REQUEST = {
  model: "deepseek-flash",
  messages: [{ role: "user" as const, content: "只回复 OK" }],
  temperature: 0,
  maxTokens: 8,
};

test("record 写盘，replay 不再调用模型", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lw-cassette-"));
  try {
    const stub = new StubClient(["OK"]);
    const recorder = new CassetteClient(stub, { mode: "record", dir });
    const first = await recorder.chat(REQUEST);
    assert.equal(first.content, "OK");
    assert.equal(stub.calls.length, 1);

    const replayer = new CassetteClient(undefined, { mode: "replay", dir });
    const second = await replayer.chat(REQUEST);
    assert.deepEqual(second, first);
    assert.equal(stub.calls.length, 1);

    const path = join(dir, `${cassetteKey(REQUEST)}.json`);
    const text = readFileSync(path, "utf8");
    assert.ok(!text.includes("DEEPSEEK_API_KEY"));
    assert.ok(!text.includes("Authorization"));
    assert.ok(!text.includes("Bearer"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("replay 未命中直接报错", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lw-cassette-"));
  try {
    const replayer = new CassetteClient(undefined, { mode: "replay", dir });
    await assert.rejects(() => replayer.chat(REQUEST));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cassetteKey 对消息顺序敏感、对键顺序不敏感", () => {
  const a = cassetteKey(REQUEST);
  const b = cassetteKey({ ...REQUEST, temperature: 0, maxTokens: 8, model: "deepseek-flash" });
  const c = cassetteKey({
    ...REQUEST,
    messages: [{ role: "user", content: "不一样" }],
  });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("off 模式直接透传", async () => {
  const stub = new StubClient(["OK"]);
  const client = new CassetteClient(stub, { mode: "off" });
  const response = await client.chat(REQUEST);
  assert.equal(response.content, "OK");
});
