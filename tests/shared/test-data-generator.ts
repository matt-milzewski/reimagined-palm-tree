/**
 * Generate a minimal PDF for testing
 * This creates a PDF with properly encoded text that can be extracted by pypdf/pdfminer
 */
export function generateMinimalPDF(content: string = 'Test Document Content'): Buffer {
  // Escape special PDF characters in content
  const escapedContent = content
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

  // Build content stream - using proper text object with positioning
  const contentStream = `BT
/F1 12 Tf
1 0 0 1 72 720 Tm
(${escapedContent}) Tj
ET`;

  const streamLength = contentStream.length;

  // Build PDF with proper structure for text extraction
  // Using explicit font encoding and proper xref table
  const obj1 = `1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
`;

  const obj2 = `2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
`;

  const obj3 = `3 0 obj
<<
  /Type /Page
  /Parent 2 0 R
  /MediaBox [0 0 612 792]
  /Contents 4 0 R
  /Resources <<
    /Font << /F1 5 0 R >>
  >>
>>
endobj
`;

  const obj4 = `4 0 obj
<< /Length ${streamLength} >>
stream
${contentStream}
endstream
endobj
`;

  const obj5 = `5 0 obj
<<
  /Type /Font
  /Subtype /Type1
  /BaseFont /Helvetica
  /Encoding /WinAnsiEncoding
>>
endobj
`;

  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const body = obj1 + obj2 + obj3 + obj4 + obj5;

  // Calculate byte offsets for xref table
  const headerLen = Buffer.from(header).length;
  const obj1Start = headerLen;
  const obj2Start = obj1Start + Buffer.from(obj1).length;
  const obj3Start = obj2Start + Buffer.from(obj2).length;
  const obj4Start = obj3Start + Buffer.from(obj3).length;
  const obj5Start = obj4Start + Buffer.from(obj4).length;
  const xrefStart = obj5Start + Buffer.from(obj5).length;

  const xref = `xref
0 6
0000000000 65535 f
${obj1Start.toString().padStart(10, '0')} 00000 n
${obj2Start.toString().padStart(10, '0')} 00000 n
${obj3Start.toString().padStart(10, '0')} 00000 n
${obj4Start.toString().padStart(10, '0')} 00000 n
${obj5Start.toString().padStart(10, '0')} 00000 n
`;

  const trailer = `trailer
<< /Size 6 /Root 1 0 R >>
startxref
${xrefStart}
%%EOF`;

  const pdfContent = header + body + xref + trailer;
  return Buffer.from(pdfContent, 'binary');
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
