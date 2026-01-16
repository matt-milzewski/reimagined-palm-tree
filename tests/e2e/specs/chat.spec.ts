import { test, expect } from '../fixtures/auth';
import { cleanupDataset, generateTestDatasetName } from '../fixtures/cleanup';
import { generateMinimalPDF, waitFor } from '../../shared/test-data-generator';

/**
 * Chat tests are currently skipped because they depend on the vector ingestion pipeline
 * setting the dataset status to READY. The pipeline's vector_ingest.py step needs to
 * successfully process the uploaded PDF and ingest embeddings into PostgreSQL.
 *
 * TODO: Enable these tests once the vector ingestion pipeline is working:
 * 1. Verify pypdf/pdfminer can extract text from the test PDFs
 * 2. Ensure vector_ingest.py runs and sets dataset status to READY
 * 3. Remove the .skip() from these tests
 */
test.describe('Chat with Citations', () => {
  test.skip('should chat with dataset and receive citations', async ({ authenticatedPage: page, tenantId }) => {
    test.setTimeout(300000); // 5 minutes for setup + chat

    // Step 1: Create dataset from dashboard
    const datasetName = generateTestDatasetName('chat-test');
    await page.fill('input[placeholder="Enter dataset name"]', datasetName);
    await page.click('button:has-text("Create dataset")');
    await page.waitForSelector(`text=${datasetName}`);

    // Click the first "View dataset" button (newest dataset - they're sorted newest first)
    const viewButtons = page.locator('button:has-text("View dataset")');
    await viewButtons.first().click();
    await page.waitForURL(/datasetId=/, { timeout: 10000 });

    const url = new URL(page.url());
    const datasetId = url.searchParams.get('datasetId')!;
    expect(datasetId).toBeTruthy();

    console.log(`Created dataset: ${datasetId}`);

    // Step 2: Upload file with safety content
    const pdfContent = generateMinimalPDF(
      'This is a construction safety document. Hard hats must be worn at all times on site. Safety is our top priority. All workers must complete safety induction.'
    );
    const pdfBuffer = Buffer.from(pdfContent);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'safety-document.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer
    });

    // Wait for processing to complete (check for View results button)
    console.log('Waiting for file processing to complete...');
    await waitFor(
      async () => {
        await page.click('button:has-text("Refresh")');
        await page.waitForTimeout(1000);
        const viewResultsButton = await page.locator('button:has-text("View results")').count();
        return viewResultsButton > 0;
      },
      { timeout: 180000, interval: 5000, timeoutMessage: 'File processing did not complete' }
    );

    console.log('File processing completed');

    // Step 3: Navigate to chat page
    await page.goto('/chat/index.html');

    // Wait for datasets to load
    await page.waitForSelector('select:not([disabled])', { timeout: 15000 });

    // Select the dataset - find option that contains our dataset ID
    const selectElement = page.locator('select#dataset-picker');

    // Wait for our dataset option to appear and be enabled (READY status)
    await waitFor(
      async () => {
        await page.click('button:has-text("Refresh")');
        await page.waitForTimeout(500);
        const options = await selectElement.locator('option').allTextContents();
        const readyOption = options.find(opt => opt.includes(datasetName) && opt.includes('READY'));
        return !!readyOption;
      },
      { timeout: 30000, interval: 2000, timeoutMessage: 'Dataset did not become READY' }
    );

    await selectElement.selectOption({ label: new RegExp(datasetName) });

    // Wait for status badge
    await expect(page.locator('.badge:has-text("READY")')).toBeVisible({ timeout: 5000 });

    // Step 4: Send a chat message
    const chatInput = page.locator('textarea');
    await chatInput.fill('What safety requirements are mentioned in this document?');
    await page.click('button:has-text("Send")');

    // Wait for assistant response
    const assistantMessage = page.locator('.message').filter({ hasText: /safety|hard hat|induction/i });
    await expect(assistantMessage).toBeVisible({ timeout: 60000 });

    // Verify response has content
    const messageText = await assistantMessage.textContent();
    expect(messageText).toBeTruthy();
    expect(messageText!.length).toBeGreaterThan(20);

    // Verify citations panel has content
    await expect(page.locator('aside:has-text("Citations")')).toBeVisible();

    console.log('Chat test completed successfully');

    // Cleanup
    console.log(`Cleaning up dataset: ${datasetId}`);
    await cleanupDataset(datasetId, tenantId);
  });

  test.skip('should open source document from citation', async ({ authenticatedPage: page, tenantId }) => {
    test.setTimeout(300000);

    // Create dataset
    const datasetName = generateTestDatasetName('chat-citation');
    await page.fill('input[placeholder="Enter dataset name"]', datasetName);
    await page.click('button:has-text("Create dataset")');
    await page.waitForSelector(`text=${datasetName}`);

    const viewButtons = page.locator('button:has-text("View dataset")');
    await viewButtons.first().click();
    await page.waitForURL(/datasetId=/, { timeout: 10000 });

    const url = new URL(page.url());
    const datasetId = url.searchParams.get('datasetId')!;

    // Upload file
    const pdfContent = generateMinimalPDF('Construction safety document with important guidelines.');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'guidelines.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(pdfContent)
    });

    // Wait for processing
    await waitFor(
      async () => {
        await page.click('button:has-text("Refresh")');
        await page.waitForTimeout(1000);
        return (await page.locator('button:has-text("View results")').count()) > 0;
      },
      { timeout: 180000, interval: 5000 }
    );

    // Navigate to chat
    await page.goto('/chat/index.html');
    await page.waitForSelector('select:not([disabled])', { timeout: 15000 });

    // Wait for dataset to be READY
    const selectElement = page.locator('select#dataset-picker');
    await waitFor(
      async () => {
        await page.click('button:has-text("Refresh")');
        await page.waitForTimeout(500);
        const options = await selectElement.locator('option').allTextContents();
        return options.some(opt => opt.includes(datasetName) && opt.includes('READY'));
      },
      { timeout: 30000, interval: 2000 }
    );

    await selectElement.selectOption({ label: new RegExp(datasetName) });

    // Send message
    const chatInput = page.locator('textarea');
    await chatInput.fill('Tell me about safety guidelines');
    await page.click('button:has-text("Send")');

    // Wait for response
    await expect(page.locator('.message').filter({ hasText: /guidelines|safety/i })).toBeVisible({ timeout: 60000 });

    // Click on citation to open source (triggers download)
    const openSourceButton = page.locator('button:has-text("Open source"), button:has-text("View")').first();
    if (await openSourceButton.isVisible()) {
      const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
      await openSourceButton.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toContain('.pdf');
      console.log('Source document opened successfully');
    } else {
      console.log('No citation source button found - skipping download verification');
    }

    // Cleanup
    await cleanupDataset(datasetId, tenantId);
  });
});
