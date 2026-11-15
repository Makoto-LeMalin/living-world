/**
 * 投影契约：事件 → 状态。
 *
 * 世界层实现这个接口；共享层只负责按顺序把事件交给它。
 * 投影必须是纯回放：同一事件序列得到同一状态。
 */

export interface Projection<E> {
  apply(event: E): void;
}

export function replayProjection<E>(projection: Projection<E>, events: readonly E[]): number {
  for (const event of events) projection.apply(event);
  return events.length;
}
