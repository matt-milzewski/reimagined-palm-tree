import { test, expect } from '../fixtures/auth';

test.describe('Authentication', () => {
  test('should login with existing test user', async ({ page }) => {
    // Navigate to login page
    await page.goto('/login/index.html');

    // Fill in credentials
    await page.fill('input[type="email"]', process.env.E2E_TEST_EMAIL!);
    await page.fill('input[type="password"]', process.env.E2E_TEST_PASSWORD!);

    // Click sign in button
    await page.click('button[type="submit"]');

    // Wait for auth to complete and navigate to dashboard
    await page.waitForTimeout(2000);
    await page.goto('/dashboard/index.html');

    // Verify we're on the dashboard
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('h1')).toContainText(/datasets/i);
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/login/index.html');

    // Fill in invalid credentials
    await page.fill('input[type="email"]', 'invalid@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');

    // Click sign in button
    await page.click('button[type="submit"]');

    // Wait for error message
    await expect(page.locator('text=Login failed. Check your credentials.')).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to login from landing page', async ({ page }) => {
    // Start at landing page
    await page.goto('/');

    // Click the "Log in" link in the hero section (more reliable than nav)
    // Use getByRole for accessibility-friendly selection
    await page.getByRole('link', { name: 'Log in' }).first().click();

    // Verify we're on login page
    await expect(page).toHaveURL(/\/login/);
  });
});
