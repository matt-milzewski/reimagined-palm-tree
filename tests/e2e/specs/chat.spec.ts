import { test, expect, makeAuthenticatedRequest } from '../fixtures/auth';
import { cleanupDataset, generateTestDatasetName } from '../fixtures/cleanup';
import { generateMinimalPDF, waitFor } from '../../shared/test-data-generator';

test.describe('Chat with Citations', () => {
  let datasetId: string;
  let tenantId: string;

  // Setup: Create a dataset with a processed file before running chat tests
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300000); // 5 minutes for setup including file processing
    const context = await browser.newContext();
    const page = await context.newPage();

    // Authenticate
    await page.goto('/login/index.html');
    await page.fill('input[type="email"]', process.env.E2E_TEST_EMAIL!);
    await page.fill('input[type="password"]', process.env.E2E_TEST_PASSWORD!);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/);

    // Get tenant ID from token
    const idToken = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const tokenKey = keys.find(k => k.includes('idToken'));
      return tokenKey ? localStorage.getItem(tokenKey) : null;
    });

    if (idToken) {
      const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
      tenantId = payload.sub;
    }

    // Create dataset
    const datasetName = generateTestDatasetName('chat-test');
    await page.fill('input[placeholder="Dataset name"]', datasetName);
    await page.click('button:has-text("Create")');
    await page.waitForSelector(`text=${datasetName}`);

    // Click the last "View dataset" button (newest dataset)
    const viewButtons = page.locator('button:has-text("View dataset")');
    const count = await viewButtons.count();
    await viewButtons.nth(count - 1).click();
    await page.waitForTimeout(1000);

    const url = new URL(page.url());
    datasetId = url.searchParams.get('datasetId')!;

    // Upload and process file
    const pdfContent = generateMinimalPDF(
      'This is a construction safety document. Hard hats must be worn at all times on site. Safety is our top priority.'
    );
    const pdfBuffer = Buffer.from(pdfContent);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'safety-document.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer
    });

    // Wait for processing to complete (check for View results button)
    await waitFor(
      async () => {
        await page.click('button:has-text("Refresh")');
        await page.waitForTimeout(1000);
        const viewResultsButton = await page.locator('button:has-text("View results")').count();
        return viewResultsButton > 0;
      },
      { timeout: 180000, interval: 5000 }
    );

    console.log('File processing completed for chat test');

    console.log(`Setup complete: Dataset ${datasetId} is ready for chat tests`);

    await context.close();
  });

  test('should chat with dataset and receive citations', async ({ authenticatedPage: page }) => {
    // Navigate to chat page
    await page.goto('/chat/index.html');

    // Select the dataset
    await page.selectOption('select', datasetId);

    // Wait for dataset status badge to show READY
    await expect(page.locator('.badge.success, .badge:has-text("READY")')).toBeVisible({
      timeout: 10000
    });

    // Send a chat message
    const chatInput = page.locator('textarea[placeholder*="Ask" i], textarea[placeholder*="message" i]');
    await chatInput.fill('What safety requirements are mentioned in this document?');

    await page.click('button:has-text("Send")');

    // Wait for assistant response
    await expect(page.locator('.chat-message.assistant, .message.assistant')).toBeVisible({
      timeout: 30000
    });

    // Verify response has content
    const assistantMessage = page.locator('.chat-message.assistant, .message.assistant').first();
    const messageText = await assistantMessage.textContent();
    expect(messageText).toBeTruthy();
    expect(messageText!.length).toBeGreaterThan(10);

    // Verify citations panel is visible
    await expect(page.locator('.citations-panel, aside:has-text("Citation")')).toBeVisible();

    // Verify at least one citation is present
    const citationCount = await page.locator('.citation-item').count();
    expect(citationCount).toBeGreaterThan(0);

    console.log(`Chat test completed successfully with ${citationCount} citations`);
  });

  test('should open source document from citation', async ({ authenticatedPage: page }) => {
    await page.goto('/chat/index.html');
    await page.selectOption('select', datasetId);
    await expect(page.locator('.badge.success, .badge:has-text("READY")')).toBeVisible();

    // Send message
    const chatInput = page.locator('textarea[placeholder*="Ask" i], textarea[placeholder*="message" i]');
    await chatInput.fill('Tell me about safety');
    await page.click('button:has-text("Send")');

    // Wait for response and citations
    await expect(page.locator('.chat-message.assistant, .message.assistant')).toBeVisible({
      timeout: 30000
    });
    await expect(page.locator('.citation-item')).toBeVisible();

    // Click to open source (this will trigger download via presigned URL)
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.click('.citation-item button:has-text("Open"), .citation-item button:has-text("source")');

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.pdf');

    console.log('Source document opened successfully');
  });

  test.afterAll(async () => {
    // Cleanup created dataset
    if (datasetId && tenantId) {
      console.log(`Cleaning up test dataset: ${datasetId}`);
      try {
        await cleanupDataset(datasetId, tenantId);
        console.log('Cleanup completed');
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }
  });
});
