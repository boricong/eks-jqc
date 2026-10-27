/** Compare historical content while allowing additive v26 evidence metadata. */
export function historicalContent(value: any): any {
  if (Array.isArray(value)) return value.map(historicalContent);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            ![
              "frozenCriteria",
              "releaseVersion",
              "releaseInfo",
              "commonCourseReleases",
              "commonUpdates",
              "headReleaseId",
            ].includes(key),
        )
        .map(([key, v]) => [key, historicalContent(v)]),
    );
  return value;
}
