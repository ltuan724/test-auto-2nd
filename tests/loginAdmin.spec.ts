import { test } from '@playwright/test';
import { readExcel } from '../utils/readExcel';
import * as fs from 'fs';

const data: any = readExcel('data.xlsx', 'Sheet2');

if (!fs.existsSync('admin')) {
    fs.mkdirSync('admin');
}


test.describe('Login multiple accounts', () => {
    for (const row of data) {
        test(`Login - ${row.username}`, async ({ page }) => {
            const username = String(row.username).trim().toLowerCase();

            try {
                await page.goto('https://cms-thanhdanh-stg.palmteksolution.com/auth/sign-in');

                await page.getByPlaceholder('Nhập tên đăng nhập', { exact: true }).fill(username);
                console.log(`Đã điền username: ${username}`);
                await page.getByPlaceholder('Nhập mật khẩu', { exact: true }).fill(String(row.password));
                console.log(`Đã điền password cho: ${row.password}`);
                await page.getByText('Đăng nhập', { exact: true }).click();
                console.log(`Đã click login cho: ${username}`);
                await page.waitForLoadState('networkidle');

                if (page.url().includes('/auth/sign-in')) {
                    throw new Error(`Login failed: ${username}`);
                }

                await page.context().storageState({
                    path: `admin/${username}.json`,
                });
            } catch (err) {
                return;
            }
        });
    }
});
