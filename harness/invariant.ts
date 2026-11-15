/**
 * 不变量检查的公共容器。
 *
 * 规则层只描述“什么必须成立”，这里负责计数、收集错误、合并报告；
 * 不引入任何世界类型，demo/产品可共用。
 */

export interface InvariantReport {
  ok: boolean;
  errors: string[];
  checks: number;
}

export class InvariantBuilder {
  readonly #errors: string[] = [];
  #checks = 0;

  check(condition: boolean, message: string): void {
    this.#checks++;
    if (!condition) this.#errors.push(message);
  }

  checkEqual<T>(actual: T, expected: T, message: string): void {
    this.check(actual === expected, `${message}: ${String(actual)} !== ${String(expected)}`);
  }

  report(): InvariantReport {
    return { ok: this.#errors.length === 0, errors: [...this.#errors], checks: this.#checks };
  }
}

export function combineReports(...reports: InvariantReport[]): InvariantReport {
  return {
    ok: reports.every((report) => report.ok),
    errors: reports.flatMap((report) => report.errors),
    checks: reports.reduce((sum, report) => sum + report.checks, 0),
  };
}

/** 返回重复出现的 id；调用方决定怎么报错。 */
export function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    else seen.add(id);
  }
  return [...duplicates];
}
