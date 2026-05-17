type PdfTextItem = {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
};

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfJsWorkerModule = typeof import("pdfjs-dist/legacy/build/pdf.worker.mjs");

async function loadPdfRuntime(): Promise<PdfJsModule> {
  const [pdfjs, workerModule] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ]);

  const globalWithPdfWorker = globalThis as typeof globalThis & {
    pdfjsWorker?: PdfJsWorkerModule;
  };

  globalWithPdfWorker.pdfjsWorker = workerModule;

  return pdfjs;
}

async function extractPageText(page: {
  getTextContent: (options: Record<string, unknown>) => Promise<{
    items: unknown[];
  }>;
}) {
  const textContent = await page.getTextContent({
    normalizeWhitespace: true,
    disableCombineTextItems: false,
  });

  let pageText = "";
  let lastY: number | null = null;

  for (const rawItem of textContent.items) {
    const item = rawItem as PdfTextItem;
    const fragment = item.str?.trim();
    if (!fragment) continue;

    const currentY = item.transform?.[5] ?? null;
    if (pageText) {
      if (item.hasEOL || (lastY !== null && currentY !== null && currentY !== lastY)) {
        pageText += "\n";
      } else {
        pageText += " ";
      }
    }

    pageText += fragment;
    lastY = currentY;
  }

  return pageText.trim();
}

export async function extractPdf(buffer: Buffer): Promise<string> {
  const pdfjs = await loadPdfRuntime();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    stopAtErrors: false,
    verbosity: 0,
  });

  const document = await loadingTask.promise;

  try {
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const pageText = await extractPageText(page);
      if (pageText) {
        pages.push(pageText);
      }
    }

    return pages.join("\f").trim();
  } finally {
    await document.destroy();
  }
}
