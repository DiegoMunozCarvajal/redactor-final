export async function extractTxt(buffer: Buffer): Promise<string> {
  return buffer.toString("utf-8");
}
