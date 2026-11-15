/**
 * WorldDirector 契约与确定性替身。
 *
 * 真实实现可以是 LLM；本阶段先用模板，保证 B0–B2 零 LLM 可回放。
 * 两者输出同一个 EventProposal，且都必须过 EventValidator。
 */

import type { EventProposal, Visibility } from "../types.ts";

export interface DirectorContext {
  tick: number;
  placeId: string;
  roomId: string;
  type: string;
  lod: "fine" | "coarse" | "cold";
  pressure: number;
  reason: string;
  /** 只允许这个自然事件类型；LLM 不能借自然事件生成 actor 事件。 */
  allowedTypes?: string[];
}

export interface WorldDirector {
  propose(context: DirectorContext): EventProposal[];
}

export interface AsyncWorldDirector {
  propose(context: DirectorContext): Promise<EventProposal[]>;
}

function idFor(context: DirectorContext): string {
  return `proposal_${context.placeId}_${context.type}_${context.tick}`;
}

export class TemplateWorldDirector implements WorldDirector {
  propose(context: DirectorContext): EventProposal[] {
    const id = idFor(context);
    const base = {
      id,
      placeId: context.placeId,
      roomId: context.roomId,
      actorIds: [],
      targetIds: [],
      timeWindow: { startTick: context.tick, endTick: context.tick + 1 },
      stakes: 0.4,
      preconditions: [] as string[],
      visibility: "place" as Visibility,
      confidence: 0.6,
      reason: context.reason,
    };

    switch (context.type) {
      case "fog":
        return [
          {
            ...base,
            type: "fog",
            direction: "河面起雾，渡船减速，路上的人开始找地方等。",
            stakes: 0.25,
            branches: {
              onSuccess: "雾持续到午后，渡船延误，客栈和码头的人变多。",
              onFailure: "雾很快散了，只留下潮湿的早晨。",
            },
            confidence: 0.7,
          },
        ];
      case "ferry_delay":
        return [
          {
            ...base,
            type: "ferry_delay",
            direction: "渡船的缆绳松了，船夫在码头边重新系船。",
            stakes: 0.35,
            branches: {
              onSuccess: "渡船晚点，旅客滞留在码头，鱼价和客栈生意受影响。",
              onFailure: "船夫很快修好，只耽误了一小会儿。",
            },
            confidence: 0.65,
          },
        ];
      case "illness":
        return [
          {
            ...base,
            type: "illness",
            direction: "有人连续咳嗽，神庙里开始有人低声议论。",
            stakes: 0.55,
            branches: {
              onSuccess: "病人增多，人群避开集市，药和粮的需求上升。",
              onFailure: "只是普通风寒，祭司让人回家休息。",
            },
            confidence: 0.55,
          },
        ];
      case "structural":
        return [
          {
            ...base,
            type: "structural",
            direction: "码头栈桥的一块木板松了，走上去会晃。",
            stakes: 0.4,
            branches: {
              onSuccess: "栈桥需要修，码头的人绕路，船夫开始找木头。",
              onFailure: "有人把木板踩回去，暂时还能用。",
            },
            confidence: 0.6,
          },
        ];
      case "fire":
        return [
          {
            ...base,
            type: "fire",
            direction: "仓库角落的油灯倒了，谷壳被引燃，烟从门缝里出来。",
            stakes: 0.8,
            branches: {
              onSuccess: "火势扩大，仓库受损，粮价和人群情绪发生变化。",
              onFailure: "火被及时扑灭，只留下烟痕。",
            },
            confidence: 0.5,
          },
        ];
      default:
        return [];
    }
  }
}
