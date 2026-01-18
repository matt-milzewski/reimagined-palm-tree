import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * Generate a proper PDF for testing using pdf-lib
 * This creates a PDF with text that can be extracted by pypdf/pdfminer
 */
export async function generateMinimalPDF(content: string = 'Test Document Content'): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);

  const page = pdfDoc.addPage([612, 792]); // US Letter size
  const { height } = page.getSize();
  const fontSize = 12;

  // Split content into lines that fit on the page
  const maxWidth = 500;
  // Replace newlines with spaces and split into words (filter out empty strings)
  const words = content.replace(/\n+/g, ' ').split(' ').filter(w => w.length > 0);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const textWidth = timesRomanFont.widthOfTextAtSize(testLine, fontSize);

    if (textWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  // Draw each line
  let yPosition = height - 72; // Start 1 inch from top
  for (const line of lines) {
    page.drawText(line, {
      x: 72, // 1 inch margin
      y: yPosition,
      size: fontSize,
      font: timesRomanFont,
      color: rgb(0, 0, 0),
    });
    yPosition -= fontSize * 1.5; // Line spacing
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Synchronous wrapper for generateMinimalPDF
 * Note: This is async internally but returns a Promise
 */
export function generateMinimalPDFSync(content: string = 'Test Document Content'): Promise<Buffer> {
  return generateMinimalPDF(content);
}

/**
 * Generate a test PDF filename
 */
export function generateTestPDFFilename(testName: string): string {
  const timestamp = Date.now();
  const sanitizedName = testName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  return `e2e-test-${sanitizedName}-${timestamp}.pdf`;
}

/**
 * Wait for a condition to be true with polling
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  options: {
    timeout?: number;
    interval?: number;
    timeoutMessage?: string;
  } = {}
): Promise<void> {
  const timeout = options.timeout || 120000; // 2 minutes default
  const interval = options.interval || 2000; // 2 seconds default
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(options.timeoutMessage || `Condition not met within ${timeout}ms`);
}
