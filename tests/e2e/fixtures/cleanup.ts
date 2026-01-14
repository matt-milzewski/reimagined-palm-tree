import { E2ECleanupManager, getCleanupOptionsFromStackOutputs } from '../../shared/cleanup-manager';

let cleanupManager: E2ECleanupManager | null = null;

/**
 * Get or create the cleanup manager singleton
 */
export async function getCleanupManager(): Promise<E2ECleanupManager> {
  if (!cleanupManager) {
    const options = await getCleanupOptionsFromStackOutputs(process.env.AWS_REGION!);
    cleanupManager = new E2ECleanupManager(options);
  }
  return cleanupManager;
}

/**
 * Cleanup a dataset after a test
 */
export async function cleanupDataset(datasetId: string, tenantId: string): Promise<void> {
  const manager = await getCleanupManager();
  await manager.cleanupDataset(datasetId, tenantId);
}

/**
 * Generate a unique test dataset name
 */
export function generateTestDatasetName(testName: string): string {
  const timestamp = Date.now();
  const sanitizedName = testName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  return `e2e-test-${sanitizedName}-${timestamp}`;
}
