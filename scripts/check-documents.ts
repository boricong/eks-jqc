import { DocumentLibrary } from "../server/src/documents.ts";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const library = new DocumentLibrary();
const items = await library.list();
for (const item of items) await library.read(item.id);
console.log(`문서 등록 목록과 Markdown 파일 ${items.length}개를 확인했습니다.`);

// 배포 폴더에는 .git이 없을 수 있으므로 Git 검사는 명시적으로 실행한다.
if (process.argv.includes("--git")) {
  const files = [
    "docs/document-catalog.json",
    ...items.map((item) => `docs/${item.sourcePath}`),
  ];
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", ...files], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      stdio: "pipe",
    });
    console.log(
      `문서 목록과 원문 ${files.length}개 파일의 Git 추적을 확인했습니다.`,
    );
  } catch {
    console.error(
      "문서의 Git 추적을 확인하지 못했습니다. Git 체크아웃에서 실행하고 docs/document-catalog.json과 등록된 모든 Markdown을 git add한 뒤 커밋해 주세요.",
    );
    process.exitCode = 1;
  }
}
