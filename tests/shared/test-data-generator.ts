/**
 * Generate a minimal PDF for testing
 * This creates a simple PDF with text content
 */
export function generateMinimalPDF(content: string = 'Test Document Content'): Buffer {
  // Minimal PDF structure
  // This is a basic PDF that contains a single page with text
  const pdfContent = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/Resources <<
/Font <<
/F1 <<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
>>
>>
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj
4 0 obj
<<
/Length ${50 + content.length}
>>
stream
BT
/F1 12 Tf
50 750 Td
(${content}) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000317 00000 n
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
${415 + content.length}
%%EOF`;

  return Buffer.from(pdfContent, 'utf-8');
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
