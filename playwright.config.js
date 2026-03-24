const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'https://atleta-notifications-helper-production.up.railway.app',
    screenshot: 'on',
    video: 'on',
    trace: 'on',
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/html' }],
  ],
  outputDir: 'test-results/artifacts',
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
    },
  ],
});
