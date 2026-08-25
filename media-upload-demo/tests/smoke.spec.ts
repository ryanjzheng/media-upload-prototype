import { expect, test } from '@playwright/test';

test('media upload demo renders records and uploader', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Records with governed media' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Field asset records' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Upload to the media library' }),
  ).toBeVisible();
  await expect(page.getByText('North Ridge Tower')).toBeVisible();
  await expect(page.getByText('Drop an image or PDF here')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Edit' }).first(),
  ).toBeVisible();
});
