/**
 * B3 完整 3 天仿真：真实 WorldDirector + 同房间角色对话 + T0–T3/群体运行时。
 *
 * 调用方负责给 client（真实 DeepSeek 或 cassette replay）。
 * 本文件不读 .env、不打印 key；trace 只保留请求/响应阶段与结构化提案。
 */

import type { ChatClient } from "../../../llm/types.ts";
import { LlmWorldDirector, type LlmDirectorTrace } from "./world/llm-director.ts";
import type { AsyncWorldDirector } from "./world/director.ts";
import { runSimulationAsync, type SimulationResult } from "./sim.ts";
import type { EventProposal } from "./types.ts";

export interface B3FullOptions {
  client: ChatClient;
  seed?: string;
  days?: number;
  dialogueInterval?: number;
  maxDialoguesPerDay?: number;
}

export interface B3FullRun {
  simulation: SimulationResult;
  directorTrace: LlmDirectorTrace[];
  proposals: EventProposal[];
  directorAttempts: number;
  directorFallbacks: number;
}

export async function runB3Full(options: B3FullOptions): Promise<B3FullRun> {
  const trace: LlmDirectorTrace[] = [];
  const proposals: EventProposal[] = [];
  let directorFallbacks = 0;

  const simulation = await runSimulationAsync({
    seed: options.seed ?? "7",
    days: options.days ?? 3,
    b3: true,
    dialogueClient: options.client,
    dialogueInterval: options.dialogueInterval ?? 12,
    maxDialoguesPerDay: options.maxDialoguesPerDay ?? 8,
    directorFactory: (world): AsyncWorldDirector => {
      const inner = new LlmWorldDirector(world, options.client, {
        onTrace: (event) => {
          trace.push(event);
          if (event.phase === "valid" && event.proposals) proposals.push(...event.proposals);
        },
      });
      return {
        async propose(context) {
          try {
            return await inner.propose(context);
          } catch (error) {
            directorFallbacks++;
            trace.push({ phase: "fallback", error: error instanceof Error ? error.message : String(error) });
            throw error;
          }
        },
      };
    },
  });

  return {
    simulation,
    directorTrace: trace,
    proposals,
    directorAttempts: simulation.budget.director,
    directorFallbacks,
  };
}
