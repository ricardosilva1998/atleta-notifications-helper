const { test, expect } = require('@playwright/test');

test.describe('Public Pages', () => {

  test('Landing page loads with feature cards and CTA buttons', async ({ page }) => {
    await page.goto('/');

    // Title and tagline
    await expect(page).toHaveTitle(/Atleta/);
    await expect(page.locator('h1')).toBeVisible();

    // Feature cards
    const cards = page.locator('.card');
    await expect(cards).toHaveCount(4);

    // CTA buttons
    await expect(page.getByText('How It Works')).toBeVisible();
    await expect(page.getByText('Get Started with Discord')).toBeVisible();

    // Nav bar
    await expect(page.locator('.nav-brand')).toBeVisible();
    await expect(page.getByText('Login')).toBeVisible();
  });

  test('Landing page has correct feature descriptions', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Live Alerts' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Clips & Recaps' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'YouTube' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Community' })).toBeVisible();
  });

  test('Pricing page loads with 4 tier cards', async ({ page }) => {
    await page.goto('/pricing');

    await expect(page).toHaveTitle(/Pricing/);
    await expect(page.getByText('Choose Your Plan')).toBeVisible();

    // 4 pricing tiers
    await expect(page.getByRole('heading', { name: 'Free' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Starter' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pro' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Enterprise' })).toBeVisible();

    // Prices
    await expect(page.getByText('0 EUR', { exact: true })).toBeVisible();
    await expect(page.getByText('5 EUR', { exact: true })).toBeVisible();
    await expect(page.getByText('10 EUR', { exact: true })).toBeVisible();
    await expect(page.getByText('25 EUR', { exact: true })).toBeVisible();

    // Most popular badge
    await expect(page.getByText('Most Popular')).toBeVisible();
  });

  test('Pricing page shows login buttons for unauthenticated users', async ({ page }) => {
    await page.goto('/pricing');

    const loginButtons = page.getByText('Log in to Subscribe');
    await expect(loginButtons.first()).toBeVisible();
  });

  test('Tutorial page loads with setup steps', async ({ page }) => {
    await page.goto('/tutorial');

    await expect(page).toHaveTitle(/Setup Guide|Tutorial/);

    // Should have step numbers
    const steps = page.locator('.step-number');
    const count = await steps.count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test('Health endpoint returns OK', async ({ page }) => {
    const response = await page.goto('/health');
    expect(response.status()).toBe(200);
    await expect(page.locator('body')).toHaveText('OK');
  });

  test('Navigation sidebar opens and closes', async ({ page }) => {
    await page.goto('/');

    // Sidebar should be hidden initially
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).not.toHaveClass(/active/);

    // Click hamburger to open
    await page.locator('.hamburger').click();
    await expect(sidebar).toHaveClass(/active/);

    // Sidebar has navigation links
    await expect(page.locator('.sidebar-link').first()).toBeVisible();

    // Click overlay to close
    await page.locator('#sidebar-overlay').click({ force: true });
    await expect(sidebar).not.toHaveClass(/active/);
  });

  test('Login button redirects to Discord OAuth', async ({ page }) => {
    await page.goto('/');

    const [response] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'commit' }),
      page.getByText('Get Started with Discord').click(),
    ]);

    // Should redirect to Discord OAuth
    expect(page.url()).toContain('discord.com');
  });

  test('Sidebar links navigate correctly', async ({ page }) => {
    await page.goto('/');

    // Open sidebar
    await page.locator('.hamburger').click();

    // Click donate link
    await page.locator('.sidebar-link', { hasText: 'Buy me a coffee' }).click();
    await expect(page).toHaveURL(/donate/);

    // Open sidebar again
    await page.locator('.hamburger').click();

    // Click setup guide
    await page.locator('.sidebar-link', { hasText: 'Setup Guide' }).click();
    await expect(page).toHaveURL(/tutorial/);
  });

  test('Pricing page is responsive - 4 columns on desktop', async ({ page }) => {
    await page.goto('/pricing');

    const grid = page.locator('.pricing-grid');
    await expect(grid).toBeVisible();

    // Check grid has the right style
    const style = await grid.getAttribute('style');
    expect(style).toContain('repeat(4, 1fr)');
  });

});
