// Régression visuelle (n° 146) : npm run visual, et npm run visual:update pour régénérer les références.
// Références : tests-visual/__screenshots__/<vue>-<projet>-<plateforme>.png (darwin en local, linux en CI).
import {defineConfig, devices} from '@playwright/test';

const PORT = Number(process.env.PORT_VISUEL || 8310);
const iphone = {...devices['iPhone 14'], browserName: 'chromium'};
const bureau = {browserName: 'chromium', viewport: {width: 1280, height: 800}, deviceScaleFactor: 1, isMobile: false, hasTouch: false};

export default defineConfig({
  testDir: '.',
  testMatch: /\.spec\.mjs$/,
  outputDir: './.resultats',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{projectName}-{platform}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['list'], ['html', {outputFolder: './.rapport', open: 'never'}]] : 'list',
  timeout: 60000,
  expect: {toHaveScreenshot: {maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide', scale: 'css'}},
  use: {
    baseURL: `http://localhost:${PORT}/`,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
    trace: 'off'
  },
  projects: [
    {name: 'iphone14-clair', use: {...iphone, colorScheme: 'light'}},
    {name: 'iphone14-sombre', use: {...iphone, colorScheme: 'dark'}},
    {name: 'bureau-clair', use: {...bureau, colorScheme: 'light'}},
    {name: 'bureau-sombre', use: {...bureau, colorScheme: 'dark'}}
  ],
  webServer: {
    command: 'node serveur.mjs',
    url: `http://localhost:${PORT}/index.html`,
    env: {PORT_VISUEL: String(PORT)},
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  }
});
