/**
 * 本体标签的共享词表与归一化。
 *
 * 编译器只声明"动作要靠什么"，不判断是否成立；标签是否被允许由世界规则决定。
 * 这里不把词表当封闭枚举：世界可以允许自定义标签，但默认世界只认已注册标签。
 */

export const ONTOLOGY_TAGS = [
  "psychic",
  "temporal",
  "divine",
  "metaphysical",
  "spirit",
  "technological",
] as const;

export type OntologyTag = (typeof ONTOLOGY_TAGS)[number];

const TAG_PATTERN = /^[a-z][a-z0-9_-]{0,23}$/;

export function normalizeOntologyTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * 去空白、转小写、去重。非法字符不在这里吞掉：
 * 归一化后由 validateCompilerOutput / validateWorldRules 报错。
 */
export function normalizeOntologyTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];
  const out: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeOntologyTag(tag);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

export function isRegisteredOntologyTag(tag: string): tag is OntologyTag {
  return (ONTOLOGY_TAGS as readonly string[]).includes(tag);
}

export function isValidOntologyTag(tag: string): boolean {
  return TAG_PATTERN.test(tag);
}
