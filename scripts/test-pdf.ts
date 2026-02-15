import { extractText, getDocumentProxy } from "unpdf";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const PDF_PATH = join(process.cwd(), "data/QCS2024.pdf");

async function main() {
  console.log("Loading PDF...");
  const buffer = await readFile(PDF_PATH);
  console.log(`PDF size: ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`);

  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  console.log(`Total pages: ${pdf.numPages}`);

  // Extract first 20 pages to understand structure
  const { text: pageTexts } = await extractText(pdf, { mergePages: false });

  for (let i = 0; i < Math.min(30, pageTexts.length); i++) {
    console.log(`\n--- PAGE ${i + 1} ---`);
    console.log(pageTexts[i].substring(0, 500));
  }

  // Also check a few pages in the middle
  for (const pageIdx of [100, 200, 500, 1000, 2000]) {
    if (pageIdx < pageTexts.length) {
      console.log(`\n--- PAGE ${pageIdx + 1} ---`);
      console.log(pageTexts[pageIdx].substring(0, 500));
    }
  }

  await pdf.destroy();
}

main().catch(console.error);
