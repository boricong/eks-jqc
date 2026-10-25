/** Read-only, system-operator document library. Paths are relative to docs/. */
export interface SystemDocumentSummary {
  id: string;
  title: string;
  description: string;
  updatedOn: string;
  sourcePath: string;
}
export interface SystemDocumentDetail extends SystemDocumentSummary {
  markdown: string;
}
