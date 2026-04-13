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
                console.log('Đã vào trang sản phẩm');
                const products = page.locator('div.border.rounded-sm.overflow-hidden.relative');
                const count = await products.count();
                const max = Math.min(count, 5);

                for (let i = 0; i < max; i++) {
                    await products.nth(i).click();
                    await page.getByText('Thêm vào giỏ hàng', { exact: true }).click();
                    await page.goBack();
                    await page.waitForLoadState('networkidle');
                }
                console.log(`Đã thêm ${max} sản phẩm vào giỏ hàng`);

                await page.locator("a[href='/cart']").click();
                console.log('Đã vào giỏ hàng');

                // mở popup voucher
                //const voucherBtn = page.getByText('Chọn voucher', { exact: true });
                const voucherBtn = page.getByRole('button', { name: 'Chọn voucherChọn 1 voucher đã lưu để áp dụng cho đơn hàng.', exact: true },);
                if (await voucherBtn.isVisible()) {
                    await voucherBtn.click();
                    console.log('👉 mở voucher');
                }

                // đợi popup hiện (nếu có)
                const voucherItem = await page.locator('div.max-h-\[70vh\].space-y-3.overflow-y-auto.p-6');// sửa selector nếu cần

                if (await voucherItem.first().isVisible().catch(() => false)) {
                    console.log('👉 có voucher');

                    await voucherItem.first().click(); // chọn voucher đầu
                } else {
                    console.log('👉 không có voucher');

                    // click nút X đóng popup
                    const closeBtn = page.getByRole('button', { name: 'Đóng' }); // hoặc icon X
                    if (await closeBtn.isVisible().catch(() => false)) {
                        await closeBtn.click();
                    }
                }



                const [response] = await Promise.all([

                    page.waitForResponse(res =>
                        res.url().includes('/orders/confirm') &&
                        res.request().method() === 'POST'
                    ),
                    page.getByText('Thanh toán', { exact: true }).click(),

                ]);
                console.log('Đã click thanh toán')
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