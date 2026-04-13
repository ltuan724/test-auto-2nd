import { test } from '@playwright/test';
import { readExcel } from '../utils/readExcel';
import { appendRow } from '../utils/excel';
import fs from 'fs';

const data: any = readExcel('data.xlsx');

test.describe('Order flow multi account', () => {

    for (const row of data) {

        test(`Order - ${row.username}`, async ({ browser }) => {

            const username = row.username.trim().toLowerCase();
            const path = `storageStates/${username}.json`;

            // ❌ không có login
            if (!fs.existsSync(path)) {
                appendRow({
                    username,
                    step: 'ORDER',
                    status: 'SKIP_NO_LOGIN'
                });
                return;
            }

            try {
                const context = await browser.newContext({
                    storageState: path
                });

                const page = await context.newPage();

                await page.goto('https://thanhdanh-stg.palmteksolution.com/');

                // ❌ session die
                if (page.url().includes('/login')) {
                    appendRow({
                        username,
                        step: 'ORDER',
                        status: 'SESSION_DIE'
                    });
                    return;
                }

                // 👉 order flow giữ nguyên
                await page.getByRole('link', { name: 'Sản Phẩm', exact: true }).click();

                const products = page.locator('div.border.rounded-sm.overflow-hidden.relative');
                const count = await products.count();
                const max = Math.min(count, 5);

                for (let i = 0; i < max; i++) {
                    await products.nth(i).click();
                    await page.getByText('Thêm vào giỏ hàng', { exact: true }).click();
                    await page.goBack();
                    await page.waitForLoadState('networkidle');
                }

                await page.locator("a[href='/cart']").click();

                const [response] = await Promise.all([
                    page.waitForResponse(res =>
                        res.url().includes('/orders/confirm') &&
                        res.request().method() === 'POST'
                    ),
                    page.getByText('Thanh toán', { exact: true }).click()
                ]);

                // ❌ order fail
                if (response.status() !== 200) {
                    appendRow({
                        username,
                        step: 'ORDER',
                        status: 'FAIL'
                    });
                    throw new Error(`Order failed: ${username}`);
                }

                // ✅ success
                appendRow({
                    username,
                    step: 'ORDER',
                    status: 'SUCCESS'
                });

                await context.close();

            } catch (err) {
                appendRow({
                    username,
                    step: 'ORDER',
                    status: 'ERROR',
                    error: String(err)
                });
                return;
            }

        });

    }

});