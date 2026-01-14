import { test, expect } from '../fixtures/auth';
import { cleanupDataset, generateTestDatasetName } from '../fixtures/cleanup';
import { generateMinimalPDF, waitFor } from '../../shared/test-data-generator';

test.describe('Dataset Lifecycle', () => {
  let datasetId: string;
  let tenantId: string;

  test('should complete full dataset lifecycle: create → upload → process → results', async ({
    authenticatedPage: page,
    tenantId: tid
  }) => {
    tenantId = tid;

    // Step 1: Create Dataset
    const datasetName = generateTestDatasetName('lifecycle');

    await page.goto('/dashboard');

    // Look for create dataset input
    await page.fill('input[placeholder*="dataset" i], input[name="name"]', datasetName);
    await page.click('button:has-text("Create")');

    // Wait for dataset to appear in list
    await page.waitForSelector(`text=${datasetName}`, { timeout: 10000 });

    // Get dataset ID from URL or UI
    await page.click(`button:has-text("View"):near(:text("${datasetName}"))`);
    await page.waitForURL(/datasetId=/);

    const url = new URL(page.url());
    datasetId = url.searchParams.get('datasetId')!;
    expect(datasetId).toBeTruthy();

    console.log(`Created dataset: ${datasetId}`);

    // Step 2: Upload File
    const pdfContent = generateMinimalPDF('E2E Test Document Content for RagReady');
    const pdfBuffer = Buffer.from(pdfContent);

    // Find file input and upload
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test-document.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer
    });

    // Wait for upload to initiate
    await page.waitForSelector('.upload-list', { timeout: 10000 });

    // Step 3: Wait for Processing
    console.log('Waiting for file processing to complete...');

    // Poll for COMPLETE status
    await waitFor(
      async () => {
        await page.click('button:has-text("Refresh")');
        await page.waitForTimeout(1000);
        const completeStatus = await page.locator('.status.complete').count();
        return completeStatus > 0;
      },
      {
        timeout: 180000, // 3 minutes
        interval: 5000, // Check every 5 seconds
        timeoutMessage: 'File processing did not complete within 3 minutes'
      }
    );

    // Verify file is marked as complete
    await expect(page.locator('.status.complete')).toBeVisible();

    // Step 4: View Results
    await page.click('button:has-text("View")');
    await page.waitForURL(/\/file\?/);

    // Verify results page shows readiness score
    await expect(page.locator('text=Readiness')).toBeVisible({ timeout: 10000 });

    // Verify job results are displayed
    const hasScore = await page.locator('text=/score|readiness/i').count();
    expect(hasScore).toBeGreaterThan(0);

    console.log('Dataset lifecycle test completed successfully');
  });

  test.afterEach(async () => {
    // Cleanup created resources
    if (datasetId && tenantId) {
      console.log(`Cleaning up dataset: ${datasetId}`);
      try {
        await cleanupDataset(datasetId, tenantId);
        console.log('Cleanup completed');
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }
  });
});
