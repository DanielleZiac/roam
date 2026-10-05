/*
 * The vocabulary of need tags. The storefront's "Tell us about you" flow, the
 * product editor and the alert logic all use these same values.
 */
export const NEEDS = [
  { tag: "mobility", label: "Limited mobility", kind: "need" },
  { tag: "wheelchair", label: "Wheelchair user", kind: "need" },
  { tag: "walking-aid", label: "Uses a cane or walker", kind: "need" },
  { tag: "dexterity", label: "Hands and dexterity", kind: "need" },
  { tag: "deaf-hoh", label: "Deaf or hard of hearing", kind: "need" },
  { tag: "nonspeaking", label: "Nonspeaking", kind: "need" },
  { tag: "blind-low-vision", label: "Blind or low vision", kind: "need" },
  { tag: "get-around", label: "Getting around", kind: "goal" },
  { tag: "sports", label: "Sports", kind: "goal" },
  { tag: "travel", label: "Travel", kind: "goal" },
  { tag: "everyday", label: "Everyday life", kind: "goal" },
] as const;

export type NeedTag = (typeof NEEDS)[number]["tag"];

const TAGS = new Set<string>(NEEDS.map((need) => need.tag));

export function isNeedTag(value: unknown): value is NeedTag {
  return typeof value === "string" && TAGS.has(value);
}

export function needLabel(tag: string): string {
  return NEEDS.find((need) => need.tag === tag)?.label ?? tag;
}
