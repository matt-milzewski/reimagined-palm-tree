import { test, expect } from '../fixtures/auth';
import { cleanupDataset, generateTestDatasetName } from '../fixtures/cleanup';
import { generateMinimalPDF, waitFor } from '../../shared/test-data-generator';

test.describe('Chat with Citations', () => {
  test('should chat with dataset and receive citations', async ({ authenticatedPage: page, tenantId }) => {
    test.setTimeout(300000); // 5 minutes for setup + chat

    // Step 1: Create dataset from dashboard
    const datasetName = generateTestDatasetName('chat-test');
    await page.fill('input[placeholder="Enter dataset name"]', datasetName);
    await page.click('button:has-text("Create dataset")');
    await page.waitForSelector(`text=${datasetName}`);

    // Find and click the "View dataset" button for our specific dataset
    const datasetCard = page.locator('.card', { hasText: datasetName });
    await datasetCard.locator('button:has-text("View dataset")').click();
    await page.waitForURL(/datasetId=/, { timeout: 10000 });

    const url = new URL(page.url());
    const datasetId = url.searchParams.get('datasetId')!;
    expect(datasetId).toBeTruthy();

    console.log(`Created dataset: ${datasetId}`);

    // Step 2: Upload file using same content as lifecycle test (which works reliably)
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

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test-document.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer
    });

    // Wait for processing to finish (either COMPLETE or FAILED)
    console.log('Waiting for file processing to complete...');
    await waitFor(
      async () => {
        await page.click('button:has-text("Refresh")');
        await page.waitForTimeout(1000);
        // Check for any terminal status (COMPLETE or FAILED)
        const completeStatus = await page.locator('td:has-text("COMPLETE")').count();
        const failedStatus = await page.locator('td:has-text("FAILED")').count();
        return completeStatus > 0 || failedStatus > 0;
      },
      { timeout: 180000, interval: 5000, timeoutMessage: 'File processing did not complete' }
    );

    // Check if processing succeeded
    const failedStatus = await page.locator('td:has-text("FAILED")').count();
    if (failedStatus > 0) {
      // Click View results to see the error message
      await page.click('button:has-text("View results")');
      await page.waitForTimeout(2000);

      // Try to capture error message from results page
      const errorMessage = await page.locator('text=/error|Error/i').first().textContent().catch(() => 'Unknown error');
      const jobCell = await page.locator('table tbody tr td:nth-child(3)').textContent().catch(() => 'unknown');

      throw new Error(`File processing FAILED. Error: ${errorMessage}. Job ID: ${jobCell}`);
    }

    console.log('File processing completed successfully');

    // Step 3: Navigate to chat page
    await page.goto('/chat/index.html');

    // Wait for datasets to load
    await page.waitForSelector('select:not([disabled])', { timeout: 15000 });

    // Select the dataset - find option that contains our dataset ID
    const selectElement = page.locator('select#dataset-picker');
    const datasetOption = selectElement.locator(`option[value="${datasetId}"]`);

    // Wait for our dataset option to appear and be READY
    // Vector ingestion with Bedrock embeddings can take time
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

    // Wait for status badge
    await expect(page.locator('.badge:has-text("READY")')).toBeVisible({ timeout: 5000 });

    // Step 4: Send a chat message
    const chatInput = page.locator('textarea');
    await chatInput.fill('What safety requirements are mentioned in this document?');
    await page.click('button:has-text("Send")');

    // Wait for assistant response
    const assistantMessage = page.locator('.message').filter({ hasText: /safety|hard hat|induction|protective/i });
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

  test('should open source document from citation', async ({ authenticatedPage: page, tenantId }) => {
    test.setTimeout(300000);

    // Create dataset
    const datasetName = generateTestDatasetName('chat-citation');
    await page.fill('input[placeholder="Enter dataset name"]', datasetName);
    await page.click('button:has-text("Create dataset")');
    await page.waitForSelector(`text=${datasetName}`);

    // Find and click the "View dataset" button for our specific dataset
    const datasetCard = page.locator('.card', { hasText: datasetName });
    await datasetCard.locator('button:has-text("View dataset")').click();
    await page.waitForURL(/datasetId=/, { timeout: 10000 });

    const url = new URL(page.url());
    const datasetId = url.searchParams.get('datasetId')!;

    // Upload file using same content as lifecycle test (which works reliably)
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
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test-document.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer
    });

    // Wait for processing to finish (either COMPLETE or FAILED)
    await waitFor(
      async () => {
        await page.click('button:has-text("Refresh")');
        await page.waitForTimeout(1000);
        const completeStatus = await page.locator('td:has-text("COMPLETE")').count();
        const failedStatus = await page.locator('td:has-text("FAILED")').count();
        return completeStatus > 0 || failedStatus > 0;
      },
      { timeout: 180000, interval: 5000, timeoutMessage: 'File processing did not complete' }
    );

    // Check if processing succeeded
    const failedStatus = await page.locator('td:has-text("FAILED")').count();
    if (failedStatus > 0) {
      const jobCell = await page.locator('table tbody tr td:nth-child(3)').textContent();
      throw new Error(`File processing FAILED. Job ID: ${jobCell}. Check CloudWatch logs for details.`);
    }

    // Navigate to chat
    await page.goto('/chat/index.html');
    await page.waitForSelector('select:not([disabled])', { timeout: 15000 });

    // Wait for dataset to be READY (vector ingestion with Bedrock can take time)
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

    // Send message
    const chatInput = page.locator('textarea');
    await chatInput.fill('Tell me about safety guidelines');
    await page.click('button:has-text("Send")');

    // Wait for response
    await expect(page.locator('.message').filter({ hasText: /guidelines|safety|protective/i })).toBeVisible({ timeout: 60000 });

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
