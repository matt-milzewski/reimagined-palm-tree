import { test as base, Page } from '@playwright/test';
import { authenticateTestUser, TestUser, getTenantIdFromToken } from '../utils/test-user';

interface AuthFixtures {
  authenticatedPage: Page;
  testUser: TestUser;
  tenantId: string;
}

/**
 * Extended test with authentication fixtures
 */
export const test = base.extend<AuthFixtures>({
  testUser: async ({}, use) => {
    const user = await authenticateTestUser(
      process.env.E2E_TEST_EMAIL!,
      process.env.E2E_TEST_PASSWORD!,
      {
        region: process.env.AWS_REGION!,
        userPoolId: process.env.USER_POOL_ID!,
        clientId: process.env.USER_POOL_CLIENT_ID!
      }
    );
    await use(user);
  },

  tenantId: async ({ testUser }, use) => {
    const tenantId = getTenantIdFromToken(testUser.idToken!);
    await use(tenantId);
  },

  authenticatedPage: async ({ page, testUser }, use) => {
    // Navigate to login page
    await page.goto('/login');

    // Fill in credentials
    await page.fill('input[type="email"]', testUser.email);
    await page.fill('input[type="password"]', testUser.password);

    // Click sign in button
    await page.click('button[type="submit"]');

    // Wait for navigation to dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });

    await use(page);
  }
});

export { expect } from '@playwright/test';

/**
 * Helper to make authenticated API requests from browser context
 */
export async function makeAuthenticatedRequest(
  page: Page,
  method: string,
  path: string,
  body?: any
): Promise<any> {
  const apiBaseUrl = process.env.API_BASE_URL;

  // Get the auth token from localStorage (set by Amplify)
  const tokens = await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    const tokenKey = keys.find(k => k.includes('idToken'));
    return tokenKey ? localStorage.getItem(tokenKey) : null;
  });

  const response = await page.request.fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: tokens || ''
    },
    data: body
  });

  return response.json();
}
