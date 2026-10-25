import { DocumentLibrary } from "../server/src/documents.ts";

const library = new DocumentLibrary();
const items = await library.list();
for (const item of items) await library.read(item.id);
console.log(`문서 등록 목록과 Markdown 파일 ${items.length}개를 확인했습니다.`);
