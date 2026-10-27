import type { State } from "@eks/contracts";
/** Make a real content change through the current API; manual clone API is retired. */
export function releaseFixture(
  s: State,
  kind: "courses" | "qualifications",
  id: string,
): [string, any] {
  const source = s[kind].find((x) => x.id === id)!;
  const latest = s[kind]
    .filter((x) => x.entityId === source.entityId && !x.deletedAt)
    .sort((a, b) => (b.version || 0) - (a.version || 0))[0]!;
  const content =
    kind === "courses"
      ? { ...latest, title: latest.title + " 개정" }
      : {
          ...latest,
          renewalLeadMonths:
            (((latest as any).renewalLeadMonths || 3) % 12) + 1,
        };
  return ["/" + kind + "/" + latest.id, content];
}
