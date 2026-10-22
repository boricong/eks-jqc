import { type OrganizationDocument, type State } from "@eks/contracts";
import { validateState } from "./integrity.ts";
import { demand } from "./errors.ts";

// The normal migration command only validates the current schema. The paired
// business/organization upgrade is an explicit preserving maintenance operation.
export function migrateState(
  input: unknown,
  organizations: OrganizationDocument,
): State {
  const source = input as { schemaVersion?: number };
  demand(
    source?.schemaVersion === 13,
    422,
    "업무 스키마12는 data:migrate-planning, 업무 스키마11은 data:migrate-templates, 업무 스키마10은 data:migrate-catalog-editing, 업무 스키마9는 data:migrate-assessment-flow를 사용하세요. 구형 데이터는 자동 이관하지 않습니다. 스키마7은 data:migrate-administration, 업무6·조직1은 data:migrate-policies의 명시적 보존 이관이 필요합니다.",
  );
  return validateState(input, organizations);
}
