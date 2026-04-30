import { test, expect } from '@playwright/test';

test.describe('End-to-End Clinic Workflow', () => {
  const clinicId = '11111111-1111-4111-8111-111111111111';
  const baseUrl = 'http://localhost:3014';

  test('Patient check-in and tracking flow', async ({ page }) => {
    await page.goto(`${baseUrl}/checkin/${clinicId}`);
    
    const doctorSelect = page.locator('label:has-text("Doctor") select').first();
    await doctorSelect.waitFor();
    
    const doctors = await doctorSelect.locator('option').allInnerTexts();
    if (doctors.length === 0) throw new Error("No doctors found in dropdown");
    await doctorSelect.selectOption({ index: 1 }); 

    const phoneInput = page.locator('input[placeholder="9876543210"]').first();
    await phoneInput.fill('9876543210');
    
    await page.waitForLoadState('networkidle');

    const nameInput = page.locator('input[placeholder="Ravi Kumar"]').first();
    await nameInput.fill('Test Patient E2E');

    const complaintInput = page.locator('textarea[placeholder*="complaint"]').first();
    await complaintInput.fill('Testing end-to-end workflow');
    
    await page.click('button:has-text("Check in patient")');

    const successMessage = page.locator('text=Token #');
    await expect(successMessage).toBeVisible({ timeout: 15000 });

    const trackLink = page.locator('a:has-text("Open patient tracking page")');
    const href = await trackLink.getAttribute('href');
    if (href) {
        await page.goto(`${baseUrl}${href}`);
        await expect(page.locator('text=Test Patient E2E')).toBeVisible();
    }
  });

  test('Receptionist and Doctor visibility', async ({ page }) => {
    await page.goto(`${baseUrl}/preview/reception-workspace`);
    const flowColumn = page.locator('aside[aria-label="Clinic flow"]');
    await expect(flowColumn).toBeVisible();
    await expect(flowColumn.locator('text=Currently serving')).toBeVisible();
  });

  test('Doctor Workspace Check', async ({ page }) => {
    await page.goto(`${baseUrl}/preview/doctor-workspace`);
    await expect(page.locator('text=Doctor Workspace')).toBeVisible();
  });
});
