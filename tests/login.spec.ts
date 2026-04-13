import { test } from '@playwright/test';
import { readExcel } from '../utils/readExcel';
import { appendRow } from '../utils/excel';
import * as fs from 'fs';

const data: any = readExcel('data.xlsx');

if (!fs.existsSync('storageStates')) {
  fs.mkdirSync('storageStates');
}


test.describe('Login multiple accounts', () => {
  for (const row of data) {
    test(`Login - ${row.username}`, async ({ page }) => {
      const username = String(row.username).trim().toLowerCase();

      try {
        await page.goto('https://thanhdanh-stg.palmteksolution.com/login');

        await page.locator('[name="username"]').fill(username);
        console.log(`Đã điền username: ${username}`);
        await page.locator('[name="password"]').fill(String(row.password));
        console.log(`Đã điền password cho: ${username}`);
        await page.locator('button[type="submit"]').click();
        console.log(`Đã click login cho: ${username}`);
        await page.waitForLoadState('networkidle');

        if (page.url().includes('/login')) {
          appendRow({
            username,
            step: 'LOGIN',
            status: 'FAIL',
          });

          throw new Error(`Login failed: ${username}`);
        }

        await page.context().storageState({
          path: `storageStates/${username}.json`,
        });

        appendRow({
          username,
          step: 'LOGIN',
          status: 'SUCCESS',
        });
      } catch (err) {
        appendRow({

          username,
          step: 'LOGIN',
          status: 'ERROR',
          error: String(err),
        });
        return;
      }
    });
  }
});