import { test } from '@playwright/test';
import { readExcel } from '../utils/readExcel';
import { appendRow } from '../utils/excel';
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
                await page.goto('http://cms-tdecommerce.ncs.int/auth/sign-in');

                await page.getByPlaceholder('Nhập tên đăng nhập', { exact: true }).fill(username);
                console.log(`Đã điền username: ${username}`);
                await page.getByPlaceholder('Nhập mật khẩu', { exact: true }).fill(String(row.password));
                console.log(`Đã điền password cho: ${row.password}`, 'Password');
                await page.getByText('Đăng nhập', { exact: true }).click();
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
                    path: `admin/${username}.json`,
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