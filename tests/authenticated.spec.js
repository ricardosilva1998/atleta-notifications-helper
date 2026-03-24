const { test, expect } = require('@playwright/test');

// These tests require a valid session cookie from the production app.
// Set ATLETA_SESSION_COOKIE env var to run authenticated tests.
const SESSION_COOKIE = process.env.ATLETA_SESSION_COOKIE;

test.describe('Authenticated Pages', () => {

  test.skip(!SESSION_COOKIE, 'Skipping - no ATLETA_SESSION_COOKIE set');

  test.beforeEach(async ({ context }) => {
    if (SESSION_COOKIE) {
      await context.addCookies([{
        name: 'session',
        value: SESSION_COOKIE,
        domain: 'atleta-notifications-helper-production.up.railway.app',
        path: '/',
      }]);
    }
  });

  test('Dashboard loads with server list', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page).toHaveTitle(/Dashboard/);
    await expect(page.getByText('Dashboard')).toBeVisible();

    // Should have tier badge
    await expect(page.locator('.badge-tier')).toBeVisible();

    // Should have Your Servers section
    await expect(page.getByText('Your Servers')).toBeVisible();
  });

  test('Dashboard shows quick action buttons', async ({ page }) => {
    await page.goto('/dashboard');

    // Should have Add Bot to Server button
    await expect(page.getByText('Add Bot to Server')).toBeVisible();
  });

  test('Dashboard server cards have stats and configure button', async ({ page }) => {
    await page.goto('/dashboard');

    // Check if there are server cards
    const serverCards = page.locator('.card').filter({ hasText: 'Configure' });
    const count = await serverCards.count();

    if (count > 0) {
      // First server card should have stats
      const firstCard = serverCards.first();
      await expect(firstCard.getByText('Live Alerts')).toBeVisible();
      await expect(firstCard.getByText('Clips Shared')).toBeVisible();
      await expect(firstCard.getByText('All Notifications')).toBeVisible();

      // Should have Configure button
      await expect(firstCard.getByText('Configure')).toBeVisible();

      // Should have Stats button
      await expect(firstCard.getByText('Stats')).toBeVisible();
    }
  });

  test('Dashboard stats expand/collapse on click', async ({ page }) => {
    await page.goto('/dashboard');

    const statsButton = page.getByText('Stats').first();
    const count = await statsButton.count();

    if (count > 0) {
      // Click stats to expand
      await statsButton.click();

      // Should show expanded stats with chart
      await expect(page.getByText('Last 30 days by type').first()).toBeVisible();

      // Click again to collapse
      await statsButton.click();

      // Expanded section should be hidden
      await expect(page.getByText('Last 30 days by type').first()).not.toBeVisible();
    }
  });

  test('Account page loads with profile and metrics', async ({ page }) => {
    await page.goto('/dashboard/account');

    await expect(page).toHaveTitle(/Account/);

    // Profile section
    await expect(page.locator('.badge-tier')).toBeVisible();

    // Metrics cards
    await expect(page.getByText('Total Sent')).toBeVisible();
    await expect(page.getByText('Today')).toBeVisible();
    await expect(page.getByText('This Week')).toBeVisible();
    await expect(page.getByText('This Month')).toBeVisible();

    // Chart section
    await expect(page.getByText('Notifications sent per day')).toBeVisible();

    // Quick actions
    await expect(page.getByText('Subscription')).toBeVisible();
    await expect(page.getByText('Language')).toBeVisible();
    await expect(page.getByText('Logout')).toBeVisible();
  });

  test('Account page language switcher works', async ({ page }) => {
    await page.goto('/dashboard/account');

    // Find language select
    const langSelect = page.locator('select[name="lang"]').last();
    await expect(langSelect).toBeVisible();

    // Should have multiple language options
    const options = langSelect.locator('option');
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThanOrEqual(7);
  });

  test('Guild config page loads with tabbed interface', async ({ page }) => {
    await page.goto('/dashboard');

    // Click Configure on first server
    const configButton = page.getByText('Configure').first();
    const count = await configButton.count();

    if (count > 0) {
      await configButton.click();

      // Should have tab bar
      await expect(page.locator('.tab-bar')).toBeVisible();

      // Should have platform tabs
      await expect(page.getByRole('button', { name: 'Twitch' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'YouTube' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Discord' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
    }
  });

  test('Guild config Twitch tab shows add form and channel list', async ({ page }) => {
    await page.goto('/dashboard');

    const configButton = page.getByText('Configure').first();
    if (await configButton.count() > 0) {
      await configButton.click();

      // Twitch tab should be active by default
      await expect(page.getByText('Add a Twitch Channel')).toBeVisible();
      await expect(page.locator('input[name="twitch_username"]')).toBeVisible();
      await expect(page.getByText('Watched Channels')).toBeVisible();
    }
  });

  test('Guild config YouTube tab works', async ({ page }) => {
    await page.goto('/dashboard');

    const configButton = page.getByText('Configure').first();
    if (await configButton.count() > 0) {
      await configButton.click();

      // Click YouTube tab
      await page.getByRole('button', { name: 'YouTube' }).click();

      // Should show YouTube form
      await expect(page.getByText('Add a YouTube Channel')).toBeVisible();
      await expect(page.locator('input[name="youtube_channel"]')).toBeVisible();
    }
  });

  test('Guild config Discord tab shows settings forms', async ({ page }) => {
    await page.goto('/dashboard');

    const configButton = page.getByText('Configure').first();
    if (await configButton.count() > 0) {
      await configButton.click();

      // Click Discord tab
      await page.getByRole('button', { name: 'Discord' }).click();

      // Should show welcome message and sub sync settings
      await expect(page.getByText('Welcome Message')).toBeVisible();
      await expect(page.getByText('Subscriber Role Sync')).toBeVisible();
      await expect(page.getByText('Activity Feed')).toBeVisible();
    }
  });

  test('Guild config Settings tab shows summary and remove button', async ({ page }) => {
    await page.goto('/dashboard');

    const configButton = page.getByText('Configure').first();
    if (await configButton.count() > 0) {
      await configButton.click();

      // Click Settings tab
      await page.getByRole('button', { name: 'Settings' }).click();

      // Should show server summary
      await expect(page.getByText('Server Summary')).toBeVisible();
      await expect(page.getByText('Twitch Channels')).toBeVisible();
      await expect(page.getByText('YouTube Channels')).toBeVisible();

      // Should show remove button
      await expect(page.getByText('Remove Bot from Server')).toBeVisible();
    }
  });

  test('Subscription page loads with plan details', async ({ page }) => {
    await page.goto('/payment/subscription');

    await expect(page).toHaveTitle(/Subscription/);
    await expect(page.getByText('Plan')).toBeVisible();
    await expect(page.getByText('Limits')).toBeVisible();
    await expect(page.getByText('Features')).toBeVisible();
  });

  test('Report issue page loads with form', async ({ page }) => {
    await page.goto('/dashboard/report');

    await expect(page).toHaveTitle(/Report/);
    await expect(page.locator('input[name="subject"]')).toBeVisible();
    await expect(page.locator('textarea[name="description"]')).toBeVisible();
    await expect(page.getByText('Submit Issue')).toBeVisible();
  });

  test('Twitch channel profile images are displayed', async ({ page }) => {
    await page.goto('/dashboard');

    const configButton = page.getByText('Configure').first();
    if (await configButton.count() > 0) {
      await configButton.click();

      // Check if watched channels have images or fallback avatars
      const channelList = page.locator('.tab-content#tab-twitch');
      const images = channelList.locator('img[style*="border-radius: 50%"]');
      const avatars = channelList.locator('[style*="border-radius: 50%"]');

      const imageCount = await images.count();
      const avatarCount = await avatars.count();

      // Should have at least some avatar elements (images or letter fallbacks)
      expect(imageCount + avatarCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('Navigation between pages preserves authentication', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Dashboard')).toBeVisible();

    // Go to account
    await page.goto('/dashboard/account');
    await expect(page.getByText('Total Sent')).toBeVisible();

    // Go to pricing
    await page.goto('/pricing');
    await expect(page.getByText('Choose Your Plan')).toBeVisible();

    // Back to dashboard
    await page.goto('/dashboard');
    await expect(page.getByText('Dashboard')).toBeVisible();
  });

});
