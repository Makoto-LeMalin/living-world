/**
 * 12 个 v0 动词的 v2 参考 profile。
 * 需求强度以阿岬（绑手+伤+烧）的自由手状态校准，使 v2 的 C 与 v0 基线对齐；
 * 换到健康/其他身体时，瓶颈分开始与 v0 的加权平均分道扬镳——这正是要观察的。
 */

import type { Verb } from "../actions.ts";
import type { ActionDemand } from "./demand.ts";

const profile = (
  label: string,
  dims: ActionDemand["dims"],
  assist: ActionDemand["assist"] = {},
  durationTicks = 1,
  noise = 0,
): ActionDemand => ({ label, dims, assist, durationTicks, noise });

export const V2_PROFILES: Record<Verb, ActionDemand> = {
  move: profile("移动", { mobility: 1.0 }, { endurance: 0.2 }, 1, 0.2),
  look: profile("看", { sight: 1.0 }),
  listen: profile("听", { hearing: 1.0 }),
  speak: profile("说", { voice: 0.993 }, { cognition: 0.1 }, 1, 0.1),
  whisper: profile("低语", { voice: 1.0 }),
  take: profile(
    "拿取",
    { grasp: 0.896, precision: 0.935, reach: 0.692 },
    { sight: 0.2 },
    1,
    0.1,
  ),
  give: profile("递出", { grasp: 1.0 }, { voice: 0.2 }),
  use: profile("使用", { precision: 0.946, force: 0.767 }, { sight: 0.2 }, 2, 0.2),
  hide: profile("藏匿", { grasp: 0.862, mobility: 0.951 }, { sight: 0.2 }, 2, 0.2),
  tend: profile(
    "处理伤口",
    { precision: 0.845, cognition: 0.929 },
    { sight: 0.3 },
    3,
    0.1,
  ),
  rest: profile("休息", {}, {}, 6, 0),
  wait: profile("等待", {}, {}, 1, 0),
};
