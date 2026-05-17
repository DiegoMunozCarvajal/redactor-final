import { extractPdf } from "./pdf";
import { extractTxt } from "./txt";
import { extractDocx } from "./docx";

const extractors: Record<string, (buffer: Buffer) => Promise<string>> = {
  pdf: extractPdf,
  txt: extractTxt,
  markdown: extractTxt,
  docx: extractDocx,
};

export async function extractText(buffer: Buffer, fileType: string): Promise<string> {
  const extractor = extractors[fileType];
  if (!extractor) {
    throw new Error(`Unsupported file type: ${fileType}`);
  }
  return extractor(buffer);
}
