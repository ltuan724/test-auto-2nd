import { test, expect } from '@playwright/test';
import { readExcel } from '../utils/readExcel';
import { appendRow, resetExcel } from '../utils/excel';
import fs from 'fs';

const data: any = readExcel('data.xlsx');
const SKIP_STATUSES = ['Đã giao', 'Đã hủy', 'Hoàn thành'];
const TARGET_STATUSES = ['Đang xử lý', 'Đã giao'];

async function openOrderList(page: any) {
    await page.getByRole('button', { name: 'Danh sách đơn hàng' }).click();
}

async function getOrderDialog(page: any) {
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();
    return dialog;
}

async function closeOrderDialog(page: any) {
    const dialog = page.getByRole('dialog').first();
    if (await dialog.isVisible().catch(() => false)) {
        await dialog.getByRole('button', { name: 'Đóng' }).click();
        await expect(dialog).not.toBeVisible();
    }
}

async function openOrderDetailByCode(page: any, orderCode: string) {
    const row = page.locator('tbody tr').filter({
        has: page.getByText(orderCode, { exact: true })
    }).first();

    await expect(row).toBeVisible();
    await row.locator('td').last().locator('button, svg').first().click();
    await getOrderDialog(page);
}

async function getDialogStatus(page: any) {
    const dialog = await getOrderDialog(page);
    const statusSection = dialog.getByText('Cập nhật trạng thái', { exact: true }).locator('..');
    const statusBox = statusSection.getByRole('combobox').first();
    return (await statusBox.textContent())?.trim() ?? '';
}

async function updateStatus(page: any, statusName: string) {
    const dialog = await getOrderDialog(page);
    const statusSection = dialog.getByText('Cập nhật trạng thái', { exact: true }).locator('..');
    const statusBox = statusSection.getByRole('combobox').first();
    const saveButton = dialog.getByRole('button', { name: 'Lưu' });

    await statusBox.scrollIntoViewIfNeeded();
    await statusBox.click();
    const listbox = page.getByRole('listbox').last();
    await expect(listbox).toBeVisible();
    await listbox.getByRole('option', { name: statusName, exact: true }).click();
    await expect(statusBox).toContainText(statusName);
    await saveButton.click();
}

async function expectStatus(page: any, statusName: string) {
    const dialog = await getOrderDialog(page);
    const statusSection = dialog.getByText('Cập nhật trạng thái', { exact: true }).locator('..');
    await expect(statusSection.getByRole('combobox').first()).toContainText(statusName);
}

async function updateStatusAndReopen(page: any, orderCode: string, statusName: string) {
    await updateStatus(page, statusName);
    await closeOrderDialog(page);
    await openOrderDetailByCode(page, orderCode);
    await expectStatus(page, statusName);
}

async function getTopFiveOrders(page: any) {
    const rows = page.locator('tbody tr');
    const total = await rows.count();
    const limit = Math.min(total, 5);
    const orders: Array<{ code: string; status: string }> = [];

    for (let i = 0; i < limit; i++) {
        const row = rows.nth(i);
        const code = (await row.locator('td').nth(0).textContent())?.trim() ?? '';
        const status = (await row.locator('td').nth(3).textContent())?.trim() ?? '';

        if (code) {
            orders.push({ code, status });
        }
    }

    return orders;
}

function logOrderStep(row: Record<string, any>) {
    appendRow(row);
}

async function processStatusStep(page: any, username: string, orderCode: string, targetStatus: string) {
    const currentStatus = await getDialogStatus(page);

    if (currentStatus === targetStatus) {
        logOrderStep({
            username,
            orderCode,
            step: targetStatus,
            result: 'ALREADY_AT_STEP',
            fromStatus: currentStatus,
            toStatus: targetStatus
        });
        return;
    }

    await updateStatusAndReopen(page, orderCode, targetStatus);

    logOrderStep({
        username,
        orderCode,
        step: targetStatus,
        result: 'CHANGED',
        fromStatus: currentStatus,
        toStatus: targetStatus
    });
}

async function processOrder(page: any, username: string, orderCode: string) {
    await openOrderDetailByCode(page, orderCode);
    console.log(`Da mo chi tiet don hang ${orderCode}`);

    for (const targetStatus of TARGET_STATUSES) {
        await processStatusStep(page, username, orderCode, targetStatus);
        console.log(`Da xu ly ${orderCode} cho step ${targetStatus}`);
    }

    await closeOrderDialog(page);
}

test.describe('Order flow multi account', () => {
    test.setTimeout(120000);
    test.beforeAll(() => {
        resetExcel();
    });

    for (const row of data) {
        test(`Order - ${row.username}`, async ({ browser }) => {
            const username = row.username.trim().toLowerCase();
            const path = `admin/${username}.json`;

            if (!fs.existsSync(path)) {
                appendRow({
                    username,
                    step: 'ORDER_ADMIN',
                    status: 'SKIP_NO_LOGIN'
                });
                return;
            }

            const context = await browser.newContext({
                storageState: path
            });

            try {
                const page = await context.newPage();

                await page.goto('http://cms-tdecommerce.ncs.int/auth/sign-in');

                if (page.url().includes('/auth/sign-in')) {
                    appendRow({
                        username,
                        step: 'ORDER_ADMIN',
                        status: 'SESSION_DIE'
                    });
                    return;
                }

                await openOrderList(page);
                await page.waitForLoadState('networkidle');

                const topOrders = await getTopFiveOrders(page);
                const processableOrders = topOrders.filter(order => !SKIP_STATUSES.includes(order.status));

                for (const order of topOrders) {
                    if (SKIP_STATUSES.includes(order.status)) {
                        appendRow({
                            username,
                            orderCode: order.code,
                            step: order.status,
                            result: 'ALREADY_AT_STEP',
                            fromStatus: order.status,
                            toStatus: order.status
                        });
                        console.log(`Bo qua ${order.code} vi dang o trang thai ${order.status}`);
                    }
                }

                for (const order of processableOrders) {
                    await processOrder(page, username, order.code);
                }

                appendRow({
                    username,
                    step: 'ORDER_ADMIN',
                    status: processableOrders.length > 0 ? 'SUCCESS' : 'SKIP_NO_ELIGIBLE_ORDER',
                    processed: processableOrders.length
                });
            } catch (err) {
                appendRow({
                    username,
                    step: 'ORDER_ADMIN',
                    status: 'ERROR',
                    error: String(err)
                });
                throw err;
            } finally {
                await context.close();
            }
        });
    }
});
