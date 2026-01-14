import { test, expect } from '../fixtures/auth';

test.describe('Authentication', () => {
  test('should login with existing test user', async ({ page }) => {
    // Navigate to login page
    await page.goto('/login');

    // Fill in credentials
    await page.fill('input[type="email"]', process.env.E2E_TEST_EMAIL!);
    await page.fill('input[type="password"]', process.env.E2E_TEST_PASSWORD!);

    // Click sign in button
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });

    // Verify we're on the dashboard
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('h1')).toContainText(/dashboard/i);
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/login');

    // Fill in invalid credentials
    await page.fill('input[type="email"]', 'invalid@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');

    // Click sign in button
    await page.click('button[type="submit"]');

    // Wait for error message (adjust selector based on actual error display)
    await expect(page.locator('text=Incorrect username or password')).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to login from landing page', async ({ page }) => {
    // Start at landing page
    await page.goto('/');

    // Click login button
    await page.click('a[href="/login"]');

    // Verify we're on login page
    await expect(page).toHaveURL(/\/login/);
  });
});
