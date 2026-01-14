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
    test.setTimeout(300000); // 5 minutes for pipeline processing
    tenantId = tid;

    // Step 1: Create Dataset
    const datasetName = generateTestDatasetName('lifecycle');

    // Already on dashboard from authenticatedPage fixture
    // Look for create dataset input
    await page.fill('input[placeholder="Dataset name"]', datasetName);
    await page.click('button:has-text("Create")');

    // Wait for dataset to appear in list
    await page.waitForSelector(`text=${datasetName}`, { timeout: 10000 });

    // Click the last "View dataset" button (newest dataset)
    const viewButtons = page.locator('button:has-text("View dataset")');
    const count = await viewButtons.count();
    await viewButtons.nth(count - 1).click();
    await page.waitForURL(/datasetId=/, { timeout: 10000 });

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

    // Poll for processing to complete (COMPLETE or FAILED status)
    await waitFor(
      async () => {
        await page.click('button:has-text("Refresh")');
        await page.waitForTimeout(1000);
        // Check for View results button which indicates processing is done
        const viewResultsButton = await page.locator('button:has-text("View results")').count();
        return viewResultsButton > 0;
      },
      {
        timeout: 180000, // 3 minutes
        interval: 5000, // Check every 5 seconds
        timeoutMessage: 'File processing did not complete within 3 minutes'
      }
    );

    // Verify results button is available
    await expect(page.locator('button:has-text("View results")')).toBeVisible();

    // Step 4: View Results
    await page.click('button:has-text("View results")');

    // Wait for results page to load by checking for content
    await expect(page.locator('text=Readiness')).toBeVisible({ timeout: 15000 });

    // Verify we're on the file results page
    await expect(page.locator('h1:has-text("File results")')).toBeVisible();

    // Verify job results are displayed (readiness score and status)
    const hasScore = await page.locator('text=/score|readiness|status/i').count();
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
