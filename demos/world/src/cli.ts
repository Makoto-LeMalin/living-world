/**
 * 世界 demo CLI。
 *
 *   node demos/world/src/cli.ts build --seed 7
 *   node demos/world/src/cli.ts sim --seed 7 --days 3
 *   node demos/world/src/cli.ts chronicle --seed 7
 *   node demos/world/src/cli.ts ask --npc merchant --q "这里发生过什么？"
 *   node demos/world/src/cli.ts inspect --npc guard
 *   node demos/world/src/cli.ts metrics --seed 7
 *   node demos/world/src/cli.ts report
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { buildWorld, defaultConfig, loadCanon } from "./world/canon.ts";
import { World } from "./world/world.ts";
import { checkCanonInvariants, checkWorldInvariants } from "./world/invariants.ts";
import { runSimulation, runSimulationAsync, type SimulationResult } from "./sim.ts";
import { ask, chronicle, describeEvent, inspect, metricsSnapshot } from "./query.ts";
import { diffSummary } from "./rules/return.ts";
import { runValidation, writeValidationReport } from "./run.ts";
import { runB3Validation, writeB3Report, B3_FULL_CASSETTE_DIR } from "./b3-run.ts";
import { runB3Full } from "./b3-full.ts";
import { npcTick } from "./agents/runtime.ts";
import { focusDialogue } from "./agents/dialogue.ts";
import { LlmWorldDirector, type LlmDirectorTrace } from "./world/llm-director.ts";
import { TemplateWorldDirector } from "./world/director.ts";
import { createDeepSeekClient } from "../../../llm/deepseek.ts";
import { CassetteClient, cassetteModeFromEnv, type CassetteMode } from "../../../llm/cassette.ts";
import type { ChatClient } from "../../../llm/types.ts";

if (existsSync(".env")) process.loadEnvFile(".env");

interface Args {
  positionals: string[];
  flags: Record<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function str(args: Args, key: string, fallback?: string): string | undefined {
  const value = args.flags[key];
  return typeof value === "string" ? value : fallback;
}

function num(args: Args, key: string, fallback: number): number {
  const value = str(args, key);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${key} 需要数字`);
  return parsed;
}

function has(args: Args, key: string): boolean {
  return args.flags[key] === true || args.flags[key] === "true";
}

function llmMode(args: Args): CassetteMode {
  if (has(args, "replay")) return "replay";
  if (has(args, "record")) return "record";
  return cassetteModeFromEnv();
}

function llmClient(args: Args): ChatClient {
  const mode = llmMode(args);
  const inner = mode === "replay" ? undefined : createDeepSeekClient();
  return new CassetteClient(inner, { mode, dir: ".cassette/world" });
}

function npcId(value: string): string {
  const aliases: Record<string, string> = {
    merchant: "npc_merchant",
    guard: "npc_guard",
    child: "npc_child",
    priest: "npc_priest",
    ferryman: "npc_ferryman",
    innkeeper: "npc_innkeeper",
    beggar: "npc_beggar",
    thief: "npc_thief",
    drunk: "npc_drunk",
    widow: "npc_widow",
  };
  return aliases[value] ?? value;
}

function build(seed: string): void {
  const canon = loadCanon();
  const canonReport = checkCanonInvariants(canon);
  const world = new World(buildWorld(canon, defaultConfig(seed)));
  const report = checkWorldInvariants(world);
  console.log(`canon: ${canon.id} / ${canon.rooms.length} rooms / ${canon.characters.length} NPC / ${canon.crowds.length} crowds`);
  console.log(`canon invariants: ${canonReport.ok ? "ok" : "FAIL"} (${canonReport.checks} checks)`);
  console.log(`world invariants: ${report.ok ? "ok" : "FAIL"} (${report.checks} checks)`);
  if (!canonReport.ok) console.log(canonReport.errors.join("\n"));
  if (!report.ok) console.log(report.errors.join("\n"));
  console.log(`prices: ${Object.entries(world.state.prices).map(([key, value]) => `${key}=${value}`).join(", ")}`);
  console.log(`plans: ${world.state.plans.map((plan) => `${plan.id}(${plan.type})`).join(", ")}`);
}

async function simulation(
  seed: string,
  days: number,
  asJson: boolean,
  llm: boolean,
  args: Args,
): Promise<SimulationResult> {
  if (!llm) {
    return printSimulation(runSimulation({ seed, days }), seed, days, asJson);
  }
  let client: ChatClient;
  try {
    client = llmClient(args);
  } catch (error) {
    console.error(`LLM 不可用，回退模板导演: ${error instanceof Error ? error.message : String(error)}`);
    return printSimulation(runSimulation({ seed, days }), seed, days, asJson);
  }
  const trace: LlmDirectorTrace[] = [];
  const result = await runSimulationAsync({
    seed,
    days,
    directorFactory: (world) =>
      new LlmWorldDirector(world, client, {
        onTrace: (event) => trace.push(event),
      }),
  });
  if (!asJson) {
    console.log(`director trace: ${trace.map((event) => event.phase).join(" → ")}`);
  }
  return printSimulation(result, seed, days, asJson);
}

function printSimulation(result: SimulationResult, seed: string, days: number, asJson: boolean): SimulationResult {
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          seed,
          days,
          theft: result.theft,
          fireEventId: result.fireEventId,
          schedule: result.schedule,
          budget: result.budget,
          invariants: result.invariants,
          plansTerminal: result.plansTerminal,
          errors: result.errors,
          returnDiff: result.returnDiff,
          queries: result.queries,
          eventsBySource: result.eventsBySource,
          theftChain: result.theftChain,
          fireChain: result.fireChain,
        },
        null,
        2,
      ),
    );
    return result;
  }

  console.log(`\nseed ${seed} / ${days} 天`);
  console.log(`events: ${result.world.state.metrics.events} / sources ${JSON.stringify(result.eventsBySource)}`);
  console.log(`theft: ${result.theft ? `${result.theft.success ? "succeeded" : "failed"} p=${result.theft.chance.toFixed(3)} roll=${result.theft.roll.toFixed(3)}` : "none"}`);
  const lawEvents = result.world.state.eventLog.filter((event) =>
    ["Investigated", "WitnessStatement", "Accused", "Jailed"].includes(event.type),
  );
  for (const event of lawEvents) console.log(`law: ${event.tick} ${event.type} ${describeEvent(result.world, event)}`);
  console.log(`fire chain: ${result.fireChain.length} events`);
  console.log(`schedule: adhered=${result.schedule.adhered} transit=${result.schedule.transit} excused=${result.schedule.excused} violations=${result.schedule.violations} ratio=${(result.schedule.ratio * 100).toFixed(2)}%`);
  console.log(`budget: director=${result.budget.director} character=${result.budget.character} total=${result.budget.total}`);
  console.log(`invariants: ${result.invariants.ok ? "ok" : "FAIL"} (${result.invariants.checks} checks); plans terminal=${result.plansTerminal}`);
  if (!result.invariants.ok) console.log(result.invariants.errors.join("\n"));
  if (result.returnDiff) {
    console.log(`return: ${diffSummary(result.returnDiff)}`);
    for (const change of result.returnDiff.changed) console.log(`  changed ${change.id}: ${change.summary} [${change.eventIds.join(",")}]`);
    for (const echo of result.returnDiff.echoes) console.log(`  echo ${echo.factId}: ${echo.verdict} — ${echo.note}`);
  }
  for (const [key, answer] of Object.entries(result.queries)) {
    console.log(`\nask ${key}: ${answer.answer}`);
    console.log(`  claims=${answer.claims.join(",")} confidence=${answer.confidence} unknown=${answer.unknown}`);
  }
  if (result.errors.length > 0) console.log(`errors: ${result.errors.join("; ")}`);
  return result;
}

function writeChronicle(seed: string, days: number, out: string, includeRoutine: boolean): void {
  const result = runSimulation({ seed, days });
  const lines = [
    "# 渡口集编年史",
    "",
    `seed=${seed} days=${days} events=${result.world.state.metrics.events}`,
    ...chronicle(result.world, { includeRoutine }),
    "",
    "## 返回差分",
    "",
    result.returnDiff ? diffSummary(result.returnDiff) : "无",
    "",
    "## D4 问话",
    "",
    ...Object.entries(result.queries).map(([id, answer]) => `- ${id}: ${answer.answer}`),
    "",
  ];
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.join("\n"), "utf8");
  console.log(`wrote ${out} (${lines.length} lines)`);
}

function advanceToD4(world: World): void {
  world.state.tick = 432;
  for (const character of world.state.characters) {
    npcTick(world, character, 432);
  }
}

async function talk(args: Args): Promise<void> {
  const seed = str(args, "seed", "7") as string;
  const days = num(args, "days", 3);
  const result = runSimulation({ seed, days });
  const world = result.world;
  advanceToD4(world);
  const npc = npcId(str(args, "npc", "npc_merchant") as string);
  const question = str(args, "q", "这里发生过什么？") as string;
  const useLlm = has(args, "llm") || has(args, "record") || has(args, "replay");
  let client: ChatClient | undefined;
  if (useLlm) {
    try {
      client = llmClient(args);
    } catch (error) {
      console.error(`LLM 不可用，回退模板: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const trace: string[] = [];
  const answer = await focusDialogue(world, npc, question, {
    client,
    onTrace: (event) => trace.push(event.phase),
  });
  console.log(JSON.stringify({ ...answer, trace }, null, 2));
}

async function director(args: Args): Promise<void> {
  const seed = str(args, "seed", "7") as string;
  const world = new World(buildWorld(loadCanon(), defaultConfig(seed)));
  const context = {
    tick: 6,
    placeId: "wharf",
    roomId: "wharf",
    type: "structural",
    lod: "fine" as const,
    pressure: 1.2,
    reason: "CLI director probe",
    allowedTypes: ["structural"],
  };
  const useLlm = has(args, "llm") || has(args, "record") || has(args, "replay");
  const trace: string[] = [];
  if (!useLlm) {
    console.log(JSON.stringify({ proposals: new TemplateWorldDirector().propose(context), trace }, null, 2));
    return;
  }
  try {
    const client = llmClient(args);
    const director = new LlmWorldDirector(world, client, {
      onTrace: (event) => trace.push(event.phase),
    });
    const proposals = await director.propose(context);
    console.log(JSON.stringify({ proposals, trace }, null, 2));
  } catch (error) {
    console.error(`LLM director 不可用，回退模板: ${error instanceof Error ? error.message : String(error)}`);
    console.log(JSON.stringify({ proposals: new TemplateWorldDirector().propose(context), trace }, null, 2));
  }
}

function copyCassettes(from: string, to: string): number {
  if (!existsSync(from)) return 0;
  mkdirSync(to, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(from).filter((entry) => entry.endsWith(".json"))) {
    copyFileSync(join(from, name), join(to, name));
    copied++;
  }
  return copied;
}

async function b3(args: Args): Promise<void> {
  const seed = str(args, "seed", "7") as string;
  const days = num(args, "days", 3);
  const record = has(args, "record");
  const replay = has(args, "replay") || !record;
  const liveDir = ".cassette/world-b3-live";
  let cassette: CassetteClient;
  if (record) {
    cassette = new CassetteClient(createDeepSeekClient(), { mode: "record", dir: liveDir });
  } else {
    cassette = new CassetteClient(undefined, { mode: "replay", dir: B3_FULL_CASSETTE_DIR });
  }
  const run = await runB3Full({ client: cassette, seed, days });
  let copied = 0;
  if (record) copied = copyCassettes(liveDir, B3_FULL_CASSETTE_DIR);
  const runtime = run.simulation.runtime;
  console.log(
    JSON.stringify(
      {
        mode: replay ? "replay" : "record",
        seed,
        days,
        events: run.simulation.world.state.metrics.events,
        director: {
          attempts: run.directorAttempts,
          proposals: run.proposals.length,
          fallbacks: run.directorFallbacks,
          types: run.proposals.map((proposal) => proposal.type),
        },
        dialogue: {
          calls: runtime?.dialogueCalls ?? 0,
          scenes: runtime?.dialogues.length ?? 0,
          npcs: [...new Set((runtime?.dialogues ?? []).map((dialogue) => dialogue.npcId))],
          byLod: runtime?.dialogueByLod ?? {},
        },
        budget: run.simulation.budget,
        tiers: {
          changes: run.simulation.world.state.metrics.tierChanges,
          promotions: run.simulation.world.state.metrics.promotions,
          demotions: run.simulation.world.state.metrics.demotions,
        },
        crowd: {
          actions: runtime?.crowdActions ?? 0,
        },
        invariants: run.simulation.invariants.ok,
        errors: run.simulation.errors,
        copiedCassettes: copied,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positionals[0] ?? "sim";
  const seed = str(args, "seed", "7") as string;
  const days = num(args, "days", 3);

  switch (command) {
    case "build":
      build(seed);
      break;
    case "sim":
      await simulation(seed, days, has(args, "json"), has(args, "llm") || has(args, "record") || has(args, "replay"), args);
      break;
    case "chronicle":
      writeChronicle(seed, days, str(args, "out", "reports/world-chronicle.md") as string, has(args, "all"));
      break;
    case "talk":
      await talk(args);
      break;
    case "director":
      await director(args);
      break;
    case "b3":
      await b3(args);
      break;
    case "ask": {
      const result = runSimulation({ seed, days });
      const npc = npcId(str(args, "npc", "npc_merchant") as string);
      const question = str(args, "q", "这里发生过什么？") as string;
      const answer = ask(result.world, npc, question);
      console.log(JSON.stringify(answer, null, 2));
      break;
    }
    case "inspect": {
      const result = runSimulation({ seed, days });
      const npc = npcId(str(args, "npc", "npc_guard") as string);
      console.log(JSON.stringify(inspect(result.world, npc), null, 2));
      break;
    }
    case "metrics": {
      const result = runSimulation({ seed, days });
      console.log(JSON.stringify(metricsSnapshot(result.world), null, 2));
      break;
    }
    case "report": {
      const validation = runValidation({ seeds: 20, days: 3 });
      writeValidationReport(validation);
      console.log(`gates ${validation.gates.filter((gate) => gate.pass).length}/${validation.gates.length}`);
      for (const gate of validation.gates) console.log(`${gate.pass ? "PASS" : "FAIL"} ${gate.id} ${gate.name}: ${gate.detail}`);
      const b3 = await runB3Validation();
      writeB3Report(b3);
      console.log(`B3 gates ${b3.gates.filter((gate) => gate.pass).length}/${b3.gates.length}`);
      for (const gate of b3.gates) console.log(`${gate.pass ? "PASS" : "FAIL"} ${gate.id} ${gate.name}: ${gate.detail}`);
      break;
    }
    default:
      console.log(`未知命令: ${command}`);
      console.log("可用: build | sim | b3 | talk | director | chronicle | ask | inspect | metrics | report");
      process.exitCode = 1;
  }

  if (existsSync(".env")) {
    // CLI 不打印 .env；key 只用于 llmClient。
  }
}

await main();
