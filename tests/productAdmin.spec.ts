import { test, expect, type Page } from '@playwright/test';
import { readExcel } from '../utils/readExcel';
import { appendRow, resetExcel } from '../utils/excel';
import fs from 'fs';

type Order = {
    code: string;
    status: string;
};

const data: any = readExcel('data.xlsx', 'Sheet2');
const CONFIRMED_STATUS = 'Đã xác nhận';
const SHIPPING_STATUS = 'Đang giao hàng';
const DELIVERED_STATUS = 'Đã giao';
const COMPLETED_STATUS = 'Hoàn thành';
const CANCELLED_STATUS = 'Đã hủy';
const SKIP_STATUSES = [CANCELLED_STATUS, COMPLETED_STATUS];
const ORDER_ADMIN_STEP = 'ORDER_ADMIN';

async function openOrderList(page: Page) {
    await page.getByRole('button', { name: 'Danh sách đơn hàng' }).click();
}

async function getOrderDialog(page: Page) {
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();
    return dialog;
}

async function closeOrderDialog(page: Page) {
    const dialog = page.getByRole('dialog').first();
    if (await dialog.isVisible().catch(() => false)) {
        const closeButton = dialog.getByRole('button', { name: 'Đóng' });

        try {
            await closeButton.waitFor({ state: 'visible', timeout: 3000 });
            await closeButton.click({ timeout: 3000 });
        } catch {
            const dialogStillVisible = await dialog.isVisible().catch(() => false);

            if (dialogStillVisible) {
                await page.keyboard.press('Escape').catch(() => undefined);
                await expect(dialog).not.toBeVisible({ timeout: 3000 });
                return;
            }
        }

        await expect(dialog).not.toBeVisible();
    }
}

function getOrderRow(page: Page, orderCode: string) {
    return page.locator('tbody tr').filter({
        has: page.getByText(orderCode, { exact: true })
    }).first();
}

async function openOrderDetailByCode(page: Page, orderCode: string) {
    const row = getOrderRow(page, orderCode);

    await expect(row).toBeVisible();
    await row.locator('td').last().locator('button, svg').first().click();
    await getOrderDialog(page);
}

async function expectOrderRowStatus(page: Page, orderCode: string, statusName: string) {
    const row = getOrderRow(page, orderCode);
    await expect(row.locator('td').nth(3)).toContainText(statusName);
}

async function getStatusControls(page: Page) {
    const dialog = await getOrderDialog(page);
    const statusSection = dialog.getByText('Cập nhật trạng thái', { exact: true }).locator('..');

    return {
        dialog,
        statusBox: statusSection.getByRole('combobox').first(),
        saveButton: dialog.getByRole('button', { name: 'Lưu' })
    };
}

async function getDialogStatus(page: Page) {
    const { statusBox } = await getStatusControls(page);
    return (await statusBox.textContent())?.trim() ?? '';
}

function getTargetStatusesForOrder(currentStatus: string) {
    if (currentStatus === COMPLETED_STATUS || currentStatus === CANCELLED_STATUS) {
        return [];
    }

    if (currentStatus === DELIVERED_STATUS) {
        return [COMPLETED_STATUS];
    }

    if (currentStatus === SHIPPING_STATUS) {
        return [DELIVERED_STATUS];
    }

    if (currentStatus === CONFIRMED_STATUS) {
        return [SHIPPING_STATUS, DELIVERED_STATUS];
    }

    return [SHIPPING_STATUS, DELIVERED_STATUS];
}

async function updateStatus(page: Page, statusName: string) {
    const { statusBox, saveButton } = await getStatusControls(page);

    await statusBox.scrollIntoViewIfNeeded();
    await statusBox.click();

    const listbox = page.getByRole('listbox').last();
    await expect(listbox).toBeVisible();

    const option = listbox.getByRole('option', { name: statusName, exact: true });
    await expect(option).toBeVisible();
    await option.click();

    await expect(statusBox).toContainText(statusName);
    await saveButton.click();
}

async function expectStatus(page: Page, statusName: string) {
    const { statusBox } = await getStatusControls(page);
    await expect(statusBox).toContainText(statusName);
}

async function updateStatusAndReopen(page: Page, orderCode: string, statusName: string) {
    await updateStatus(page, statusName);
    await closeOrderDialog(page);
    await expectOrderRowStatus(page, orderCode, statusName);
    await openOrderDetailByCode(page, orderCode);
    await expectStatus(page, statusName);
}

async function getTopFiveOrders(page: Page) {
    const rows = page.locator('tbody tr');
    const total = await rows.count();
    const limit = Math.min(total, 9);
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

async function processStatusStep(page: Page, username: string, orderCode: string, targetStatus: string) {
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

async function processOrder(page: Page, username: string, orderCode: string, currentStatus: string) {
    await openOrderDetailByCode(page, orderCode);
    console.log(`Da mo chi tiet don hang ${orderCode}`);

    for (const targetStatus of getTargetStatusesForOrder(currentStatus)) {
        await processStatusStep(page, username, orderCode, targetStatus);
        console.log(`Da xu ly ${orderCode} cho step ${targetStatus}`);
    }

    await closeOrderDialog(page);
}

test.describe('Order flow multi account', () => {
    test.setTimeout(1200000);

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

                await page.goto('https://cms-thanhdanh-stg.palmteksolution.com/auth/sign-in');

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
