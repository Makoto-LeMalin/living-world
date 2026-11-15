/**
 * V3 语义保真检查（IntentVerifier）。
 *
 * 它不判断"能不能做到"——那是世界规则与判定器的事。
 * 它只问：动作文本里明确出现的通道（看/喊/抓/爬/闻/摸/意念/时间…），
 * demand 有没有覆盖？覆盖可以落在硬需求，也可以落在辅助需求。
 *
 * 词表刻意保守：只收明确动词与感官词，避免把"不吭声"误判成发声。
 */

import type { ActionDemand } from "../v2/demand.ts";
import { DIMS, type Dim } from "../v2/dimensions.ts";
import { normalizeOntologyTags } from "../ontology.ts";

interface ChannelRule {
  dim: Dim;
  pattern: RegExp;
  label: string;
}

const CHANNEL_RULES: ChannelRule[] = [
  {
    dim: "sight",
    pattern: /看|望|盯|瞧|观察|读|瞄|瞥|审视|认字|看清|反光|借.*光|光线|微光/,
    label: "视觉",
  },
  {
    dim: "hearing",
    pattern:
      /听清|听到|听见|听.*(门外|隔壁|老鼠|声音|动静|脚步|呼吸|耳语)|声音|动静|口音|脚步|呼吸声|耳语/,
    label: "听觉",
  },
  { dim: "smell", pattern: /闻|嗅|霉味|烟味|气味|香味|腥|臭/, label: "嗅觉" },
  {
    dim: "touch",
    pattern: /摸|触|皮肤|指尖|手感|质地|贴|按在|冷墙|风的方向|舌尖|嘴唇|润|尝/,
    label: "触觉",
  },
  {
    dim: "voice",
    pattern:
      /说|喊|叫|唱|骂|求|问|答|吼|唤|嘟囔|低声|哭腔|咳嗽|搭话|撒谎|暗语|气声|数数|换岗|一句话/,
    label: "发声",
  },
  {
    dim: "mobility",
    pattern: /跑|爬|跳|挪|退|冲|逃|追|趟|滚|挤|跨|蹲|站|侧身|贴墙|钻|迈|溜|行走|走过|走向|走到/,
    label: "位移",
  },
  {
    dim: "grasp",
    pattern: /抓|握|拿|提|拎|抱|扯|拽|叼|捧|攥|夹|端|托|喝掉|咬住|咬开|咬断|捏|包住/,
    label: "抓握",
  },
  {
    dim: "precision",
    pattern:
      /塞|擦|割|绑|系|解|撬|拨|写|画|刻[字痕记下上]|剥|拧|穿[针线]|折|叠|编|缠|剔|抠|对准|插入|打结|润湿|涂抹|抹|卷|包住|翻面|量|藏进|藏到|放进|铺|蘸|缝[合纫补]/,
    label: "精细操作",
  },
  {
    dim: "force",
    pattern: /推|拉|抬|搬|撞|砸|踹|掰|扛|顶|拖|甩|敲|打穿|撕|扒|勒|施加|发力|咬断|击/,
    label: "发力",
  },
  { dim: "reach", pattern: /伸|够|递|探|高窗|栏杆缝/, label: "够取" },
  {
    dim: "balance",
    pattern: /单脚|单腿|平衡|站|踩|攀|滚|踮|跨|侧身|贴墙|蹲|脚趾/,
    label: "平衡",
  },
  { dim: "breath", pattern: /屏住呼吸|屏息|憋气|喘|吹|潜水|气不够/, label: "呼吸" },
  { dim: "endurance", pattern: /坚持|持续|一直|长途|硬撑|很久|不停/, label: "持续" },
  {
    dim: "cognition",
    pattern: /判断|辨认|数|回忆|计划|骗|装|假装|忍|冷静|暗语|口音|注意|认字|学.*口音|冒充|撒谎/,
    label: "认知",
  },
];

interface TagRule {
  tag: string;
  pattern: RegExp;
  label: string;
}

const TAG_RULES: TagRule[] = [
  { tag: "psychic", pattern: /意念|念力|心灵|催眠|精神控制|自己开|自己动|眼神.*睡/, label: "心灵" },
  { tag: "temporal", pattern: /时间倒流|时间|倒流|回溯|暂停时间|快进/, label: "时间" },
  { tag: "divine", pattern: /神术|神谕|祈祷|圣光|神灵/, label: "神术" },
  { tag: "metaphysical", pattern: /月光|命运|灵魂|一句话.*死|言出法随|法则/, label: "形而上" },
  { tag: "spirit", pattern: /亡灵|鬼魂|灵体|鬼|魂/, label: "灵体" },
  { tag: "technological", pattern: /电路|机械|代码|网络|芯片|激光/, label: "技术" },
];

const TASTE_PATTERN = /尝|味道|咸|苦|甜|酸/;
const SPEECH_PATTERN = /一句话|说|喊|叫|唱|骂|求|问|答|吼|唤|嘟囔|耳语|低声|气声|搭话|撒谎|暗语/;

export interface IntentExpectation {
  dims: Dim[];
  tags: string[];
  labels: string[];
  notes: string[];
}

export function deriveIntentExpectation(text: string): IntentExpectation {
  const dims = new Set<Dim>();
  const labels: string[] = [];
  for (const rule of CHANNEL_RULES) {
    if (rule.pattern.test(text)) {
      dims.add(rule.dim);
      labels.push(rule.label);
    }
  }

  const tags = new Set<string>();
  for (const rule of TAG_RULES) {
    if (rule.pattern.test(text)) {
      tags.add(rule.tag);
      labels.push(rule.label);
    }
  }

  const notes: string[] = [];
  if (TASTE_PATTERN.test(text) && !dims.has("smell") && !dims.has("touch")) {
    dims.add("touch");
    notes.push("无独立味觉维度：暂按触觉/嗅觉代理记录");
  }

  return {
    dims: DIMS.filter((dim) => dims.has(dim)),
    tags: [...tags],
    labels,
    notes,
  };
}

export interface IntentCheck {
  actionId?: string;
  text: string;
  expectedDims: Dim[];
  coveredDims: Dim[];
  missingDims: Dim[];
  expectedTags: string[];
  actualTags: string[];
  missingTags: string[];
  unexplainedTags: string[];
  /** 纯本体动作且不含明确发声：物理通道跳过，不算漏项 */
  physicalSkipped: boolean;
  coverage: number;
  ok: boolean;
  notes: string[];
}

export function verifyIntent(
  demand: Pick<ActionDemand, "dims" | "assist" | "ontologyTags">,
  text: string,
  actionId?: string,
): IntentCheck {
  const expected = deriveIntentExpectation(text);
  const actualDims = new Set<Dim>(
    (Object.entries(demand.dims) as Array<[Dim, number]>)
      .filter(([, value]) => value > 0)
      .map(([dim]) => dim),
  );
  for (const [dim, value] of Object.entries(demand.assist ?? {}) as Array<[Dim, number]>) {
    if (value > 0) actualDims.add(dim);
  }

  const coveredDims = expected.dims.filter((dim) => actualDims.has(dim));
  let missingDims = expected.dims.filter((dim) => !actualDims.has(dim));

  const actualTags = normalizeOntologyTags(demand.ontologyTags);
  const missingTags = expected.tags.filter((tag) => !actualTags.includes(tag));
  const unexplainedTags = actualTags.filter((tag) => !expected.tags.includes(tag));

  const tagsOnly = Object.values(demand.dims).every((value) => value <= 0);
  const physicalSkipped =
    tagsOnly && expected.tags.length > 0 && !SPEECH_PATTERN.test(text);
  if (physicalSkipped) missingDims = [];

  const coverage =
    expected.dims.length === 0
      ? 1
      : physicalSkipped
        ? 1
        : coveredDims.length / expected.dims.length;

  return {
    ...(actionId === undefined ? {} : { actionId }),
    text,
    expectedDims: expected.dims,
    coveredDims,
    missingDims,
    expectedTags: expected.tags,
    actualTags,
    missingTags,
    unexplainedTags,
    physicalSkipped,
    coverage,
    ok: missingDims.length === 0 && missingTags.length === 0,
    notes: expected.notes,
  };
}
