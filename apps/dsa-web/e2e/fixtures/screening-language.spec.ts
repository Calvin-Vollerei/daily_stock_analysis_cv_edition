import { expect, test, type Page } from '@playwright/test';

const completedResult = {
  enabled: true, strategy: 'quality', market: 'cn', run_id: 'example-run', candidate_count: 1,
  candidates: [{
    rank: 1, code: '600519', name: '贵州茅台', reason: '数据源提供的摘要',
    amount: 100_000_000, score: 85, risk_level: 'medium', factor_scores: { value: 86 }, raw: {},
  }],
};

// The shell no longer owns the language switch: it lives on Settings → General
// (GeneralSettingsCard). Walk through the real settings UI and come back, so the
// in-flight task has to survive a route change (it is restored from
// sessionStorage, exactly like a page refresh).
async function switchLanguageInSettings(page: Page, current: 'zh' | 'en', next: 'zh' | 'en') {
  const isZh = current === 'zh';
  await page.getByRole('link', { name: isZh ? '设置' : 'Settings', exact: true }).click();
  const categories = page.getByRole('navigation', { name: isZh ? '配置分类' : 'Configuration categories' });
  await categories.getByRole('button', { name: isZh ? /^通用设置/ : /^General/ }).click();
  // Role-scoped: the hidden mobile header also exposes an aria-label named
  // "Switch UI language", which getByLabel would match as well.
  await page.getByRole('combobox', { name: isZh ? /^界面语言/ : /^Interface language/ }).selectOption(next);
  const isZhNext = next === 'zh';
  await page.getByRole('link', { name: isZhNext ? '选股' : 'Screening', exact: true }).click();
}

test('switches language during a screening run and on its completed results', async ({ page }, testInfo) => {
  let submissions = 0;
  let polls = 0;
  let finishRun = false;
  await page.addInitScript(() => localStorage.setItem('dsa.uiLanguage', 'en'));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    let json: unknown = { items: [], total: 0 };
    if (path.endsWith('/auth/status')) json = { authEnabled: false, loggedIn: true };
    // Settings → General renders after a config load; the page needs a valid
    // (empty) config document even though this fixture never edits config.
    if (path === '/api/v1/system/config') json = { configVersion: 'fixture-v1', maskToken: '******', items: [] };
    // Settings → General also polls setup/scheduler status; the page reads
    // checks/scheduleTimes without guarding the arrays.
    if (path.endsWith('/system/config/setup/status')) json = { ready: true, checks: [] };
    if (path.endsWith('/system/scheduler/status')) json = { enabled: true, running: false, scheduleTimes: ['18:00'] };
    if (path.endsWith('/screening/status')) json = { enabled: true, available: true };
    if (path.endsWith('/screening/strategies')) json = {
      enabled: true, strategies: [{ id: 'quality', name: 'Quality', description: 'Quality factor screen', category: 'quality' }],
    };
    if (path.endsWith('/screening/hotspots')) json = { enabled: true, hotspots: [] };
    if (path.endsWith('/screening/history')) json = { runs: [] };
    // Returning to the screening page after completion restores the run by id.
    if (path.endsWith('/screening/history/example-run')) json = {
      run_id: 'example-run', strategy: 'quality', market: 'cn', result: completedResult,
    };
    if (path.endsWith('/screening/screen/tasks')) {
      submissions++;
      json = { task_id: 'language-test', status: 'pending', message: '选股任务已提交' };
    }
    if (path.endsWith('/screening/screen/tasks/language-test')) {
      polls++;
      json = finishRun ? {
        task_id: 'language-test', status: 'completed', progress: 100, result: completedResult,
      } : { task_id: 'language-test', status: 'processing', progress: 25, message: '正在读取全市场快照' };
    }
    await route.fulfill({ json });
  });
  await page.clock.install();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/screening');
  const runButton = page.getByRole('button', { name: 'Run screening', exact: true });
  await expect(runButton).toBeEnabled();
  await runButton.click();
  await expect(page.getByText('Loading the market snapshot · 25%')).toBeVisible();
  await switchLanguageInSettings(page, 'en', 'zh');
  // Same in-flight task, restored after the route change, now rendered in Chinese.
  await expect(page.getByText('正在读取全市场快照 · 25%')).toBeVisible();
  expect(submissions).toBe(1);
  finishRun = true;
  await page.clock.fastForward(2000);
  await expect(page.getByRole('heading', { name: '选股结果' })).toBeVisible();
  await expect(page.getByText('1.00 亿', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('stock-screening-zh.png'), animations: 'disabled' });
  await switchLanguageInSettings(page, 'zh', 'en');
  await expect(page.getByRole('heading', { name: 'Screening results' })).toBeVisible();
  await expect(page.getByText('100.00 M', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '贵州茅台' })).toBeVisible();
  await expect(page.getByText('数据源提供的摘要', { exact: true })).toBeVisible();
  expect(submissions).toBe(1);
  // Both language switches only navigate; the task keeps polling instead of
  // being resubmitted, and the completed run is restored through the history API.
  // (Exact poll counts are a dev-only StrictMode artifact, so only require >1.)
  expect(polls).toBeGreaterThan(1);
  await page.screenshot({ path: testInfo.outputPath('stock-screening-en.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Run screening', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('stock-screening-en-mobile.png'), animations: 'disabled' });
});
