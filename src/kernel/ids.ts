/**
 * 世界内 ID 的格式与解析。
 *
 * ID 是事件日志的一部分，格式一旦写入就不能改：
 *   e_000001（事件）、f_00001（事实）、t_00001（痕迹）、p_00001（计划）。
 */

export function formatId(prefix: string, value: number, width: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`ID 序号必须是 >= 0 的整数，收到 ${String(value)}`);
  }
  return `${prefix}_${String(value).padStart(width, "0")}`;
}

export function parseId(id: string): { prefix: string; value: number } | undefined {
  const match = /^([a-z]+)_(\d+)$/.exec(id);
  if (!match) return undefined;
  return { prefix: match[1], value: Number(match[2]) };
}
