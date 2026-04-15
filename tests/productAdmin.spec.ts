import { test, expect } from '@playwright/test';
import { readExcel } from '../utils/readExcel';
import { appendRow, resetExcel } from '../utils/excel';
import fs from 'fs';

type Order = {
    code: string;
    status: string;
};

const data: any = readExcel('data.xlsx');
const DELIVERED_STATUS = 'Đã giao';
const COMPLETED_STATUS = 'Hoàn thành';
const SKIP_STATUSES = ['Đã hủy', COMPLETED_STATUS];
const TARGET_STATUSES = ['Đang xử lý', DELIVERED_STATUS];
const ORDER_ADMIN_STEP = 'ORDER_ADMIN';

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
        const closeButton = dialog.getByRole('button', { name: 'Đóng' });

        try {
            await closeButton.click();
        } catch (error) {
            const dialogStillVisible = await dialog.isVisible().catch(() => false);

            if (dialogStillVisible) {
                throw error;
            }
        }

        await expect(dialog).not.toBeVisible();
    }
}

function getOrderRow(page: any, orderCode: string) {
    return page.locator('tbody tr').filter({
        has: page.getByText(orderCode, { exact: true })
    }).first();
}

async function openOrderDetailByCode(page: any, orderCode: string) {
    const row = getOrderRow(page, orderCode);

    await expect(row).toBeVisible();
    await row.locator('td').last().locator('button, svg').first().click();
    await getOrderDialog(page);
}

async function expectOrderRowStatus(page: any, orderCode: string, statusName: string) {
    const row = getOrderRow(page, orderCode);
    await expect(row.locator('td').nth(3)).toContainText(statusName);
}

async function getStatusControls(page: any) {
    const dialog = await getOrderDialog(page);
    const statusSection = dialog.getByText('Cập nhật trạng thái', { exact: true }).locator('..');

    return {
        dialog,
        statusBox: statusSection.getByRole('combobox').first(),
        saveButton: dialog.getByRole('button', { name: 'Lưu' })
    };
}

async function getDialogStatus(page: any) {
    const { statusBox } = await getStatusControls(page);
    return (await statusBox.textContent())?.trim() ?? '';
}

async function updateStatus(page: any, statusName: string) {
    const { statusBox, saveButton } = await getStatusControls(page);

    await statusBox.scrollIntoViewIfNeeded();
    await statusBox.click();
    const listbox = page.getByRole('listbox').last();
    await expect(listbox).toBeVisible();
    await listbox.getByRole('option', { name: statusName, exact: true }).click();
    await expect(statusBox).toContainText(statusName);
    await saveButton.click();
}

async function expectStatus(page: any, statusName: string) {
    const { statusBox } = await getStatusControls(page);
    await expect(statusBox).toContainText(statusName);
}

async function updateStatusAndReopen(page: any, orderCode: string, statusName: string) {
    await updateStatus(page, statusName);
    await closeOrderDialog(page);
    await expectOrderRowStatus(page, orderCode, statusName);
    await openOrderDetailByCode(page, orderCode);
    await expectStatus(page, statusName);
}

async function getTopFiveOrders(page: any) {
    const rows = page.locator('tbody tr');
    const total = await rows.count();
    const limit = Math.min(total, 5);
    const orders: Order[] = [];

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

function logSkippedOrder(username: string, order: Order) {
    logOrderStep({
        username,
        orderCode: order.code,
        step: order.status,
        result: 'ALREADY_AT_STEP',
        fromStatus: order.status,
        toStatus: order.status
    });
}

function getTargetStatusesForOrder(currentStatus: string) {
    if (currentStatus === DELIVERED_STATUS) {
        return [COMPLETED_STATUS];
    }

    return TARGET_STATUSES;
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

async function processOrder(page: any, username: string, orderCode: string, currentStatus: string) {
    await openOrderDetailByCode(page, orderCode);
    console.log(`Da mo chi tiet don hang ${orderCode}`);

    for (const targetStatus of getTargetStatusesForOrder(currentStatus)) {
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
                    step: ORDER_ADMIN_STEP,
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
                        step: ORDER_ADMIN_STEP,
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
                        logSkippedOrder(username, order);
                        console.log(`Bo qua ${order.code} vi dang o trang thai ${order.status}`);
                    }
                }

                for (const order of processableOrders) {
                    await processOrder(page, username, order.code, order.status);
                }

                appendRow({
                    username,
                    step: ORDER_ADMIN_STEP,
                    status: processableOrders.length > 0 ? 'SUCCESS' : 'SKIP_NO_ELIGIBLE_ORDER',
                    processed: processableOrders.length
                });
            } catch (err) {
                appendRow({
                    username,
                    step: ORDER_ADMIN_STEP,
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
