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
    await page.fill('input[placeholder="Enter dataset name"]', datasetName);
    await page.click('button:has-text("Create dataset")');

    // Wait for dataset to appear in list
    await page.waitForSelector(`text=${datasetName}`, { timeout: 10000 });

    // Find and click the "View dataset" button for our specific dataset
    const datasetCard = page.locator('.card', { hasText: datasetName });
    await datasetCard.locator('button:has-text("View dataset")').click();
    await page.waitForURL(/datasetId=/, { timeout: 10000 });

    const url = new URL(page.url());
    datasetId = url.searchParams.get('datasetId')!;
    expect(datasetId).toBeTruthy();

    console.log(`Created dataset: ${datasetId}`);

    // Step 2: Upload File (using pdf-lib for proper PDF generation)
    // Content needs to be long enough for chunking (min 800 chars for optimal processing)
    const pdfBuffer = await generateMinimalPDF(
      `RAGREADY PLATFORM TEST DOCUMENT

SECTION 1: INTRODUCTION

This document is used for end-to-end testing of the RagReady platform document processing pipeline. The pipeline extracts text from uploaded documents, processes the content, and prepares it for retrieval-augmented generation (RAG) operations.

SECTION 2: DOCUMENT PROCESSING OVERVIEW

The document processing pipeline consists of several stages including text extraction, normalization, quality checks, chunking, and vector embedding. Each stage validates the content and prepares it for the next step in the pipeline.

SECTION 3: TEXT EXTRACTION

Text extraction uses multiple methods to ensure reliable content extraction from PDF documents. The system first attempts extraction using pypdf, and falls back to pdfminer if the initial extraction yields insufficient text.

SECTION 4: QUALITY ASSURANCE

The quality assurance process evaluates extracted text for readiness scoring. This includes checking text length, identifying potential issues, and generating quality reports that help users understand document processing results.

SECTION 5: VECTOR EMBEDDING

After chunking, the system generates vector embeddings for each chunk using Amazon Bedrock. These embeddings enable semantic search and retrieval of relevant document sections during chat operations.`
    );

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
        const completeStatus = await page.locator('td:has-text("COMPLETE")').count();
        const failedStatus = await page.locator('td:has-text("FAILED")').count();
        return completeStatus > 0 || failedStatus > 0;
      },
      {
        timeout: 180000, // 3 minutes
        interval: 5000, // Check every 5 seconds
        timeoutMessage: 'File processing did not complete within 3 minutes'
      }
    );

    const failedStatus = await page.locator('td:has-text("FAILED")').count();
    if (failedStatus > 0) {
      const jobCell = await page.locator('table tbody tr td:nth-child(3)').textContent().catch(() => 'unknown');
      await page.click('button:has-text("View results")');
      await page.waitForTimeout(2000);
      const errorMessage = await page.locator('text=/error|Error/i').first().textContent().catch(() => 'Unknown error');
      throw new Error(`File processing FAILED. Error: ${errorMessage}. Job ID: ${jobCell}`);
    }

    await expect(page.locator('td:has-text("COMPLETE")')).toBeVisible();
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

    // Step 5: Verify dataset is READY for chat
    await page.goto('/chat/index.html');
    await page.waitForSelector('select#dataset-picker:not([disabled])', { timeout: 15000 });

    const selectElement = page.locator('select#dataset-picker');
    const datasetOption = selectElement.locator(`option[value="${datasetId}"]`);
    await waitFor(
      async () => {
        await page.click('button:has-text("Refresh")');
        await page.waitForTimeout(500);
        const label = await datasetOption.textContent();
        return Boolean(label && label.includes('READY'));
      },
      { timeout: 120000, interval: 3000, timeoutMessage: 'Dataset did not become READY' }
    );

    await selectElement.selectOption(datasetId);
    await expect(page.locator('.badge:has-text("READY")')).toBeVisible({ timeout: 5000 });

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
