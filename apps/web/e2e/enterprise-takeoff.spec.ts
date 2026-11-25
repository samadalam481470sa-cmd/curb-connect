import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { pdfFromPages } from '../../api/test/fixtures/plan-pdf';

test('opens a prior private plan revision, renders the selected sheet, and restores zoom', async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1',
    'Requires the seeded local development identity provider.',
  );
  test.setTimeout(120_000);
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  await page.goto('/v1/auth/login/dev?returnTo=%2Fenterprise%2Ftakeoff');
  await page.waitForURL('**/enterprise/takeoff');
  await expect(page.getByRole('heading', { name: 'Digital Takeoff', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const me = await page.request.get('/v1/me');
  expect(me.status()).toBe(200);
  expect((await me.json()).user.email).toBe('demo-roof-owner@example.test');

  const headers = { origin };
  const status = await page.request.get('/v1/enterprise/status');
  expect(status.status()).toBe(200);
  const wasEnabled = (await status.json()).enabled === true;
  if (!wasEnabled) {
    const enabled = await page.request.put('/v1/enterprise/status', {
      headers,
      data: { enabled: true },
    });
    expect(enabled.status()).toBe(200);
  }

  async function create(path: string, data: object, revision?: number) {
    const requestHeaders =
      revision === undefined ? headers : { ...headers, 'if-match': '"' + revision + '"' };
    const result = await page.request.post(path, { headers: requestHeaders, data });
    expect(result.status(), await result.text()).toBe(201);
    return result.json();
  }

  try {
    const project = await create('/v1/enterprise/projects', {
      name: 'Takeoff viewer browser fixture ' + randomUUID(),
      originalContractMinor: 10000000,
    });
    const root = '/v1/enterprise/projects/' + project.id;
    const original = await create(root + '/documents', {
      title: 'Original canopy drawings',
      category: 'plans',
      filename: 'issue-a.pdf',
      contentBase64: Buffer.from(
        pdfFromPages([
          { width: 1224, height: 792 },
          { width: 612, height: 792, rotation: 90 },
        ]),
      ).toString('base64'),
      clientRequestId: randomUUID(),
    });
    const laterVersion = await create(
      root + '/documents/' + original.documentSetId + '/versions',
      {
        filename: 'issue-b.pdf',
        contentBase64: Buffer.from(pdfFromPages([{ width: 600, height: 600 }])).toString('base64'),
        revisionNote: 'Replacement revision with a different page count.',
        clientRequestId: randomUUID(),
      },
      1,
    );
    const earlierPlan = await create(root + '/takeoff/plan-sets', {
      title: 'Canopy review drawings',
      revisionLabel: 'Issue A',
      versionIds: [original.id],
      clientRequestId: randomUUID(),
    });

    await page.reload();
    await page.getByRole('combobox', { name: /^Commercial project/ }).selectOption(project.id);
    await page.getByRole('button', { name: /^Canopy review drawings/ }).click();
    await page.getByRole('button', { name: 'Open sheet 2' }).click();
    const viewer = page.getByRole('region', { name: 'Plan sheet viewer' });
    await expect(
      viewer.getByText('Issue A · Original canopy drawings · Vault version 1'),
    ).toBeVisible();
    const canvas = viewer.getByRole('img', { name: 'Rendered drawing for sheet 2' });
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    expect(
      await canvas.evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) return false;
        const pixels = element
          .getContext('2d')
          ?.getImageData(0, 0, element.width, element.height).data;
        if (!pixels) return false;
        for (let i = 0; i < pixels.length; i += 4) {
          if ((pixels[i] ?? 255) < 245 && (pixels[i + 3] ?? 0) > 0) return true;
        }
        return false;
      }),
    ).toBe(true);

    await viewer.getByRole('button', { name: 'Fit sheet' }).click();
    await viewer.getByRole('button', { name: 'Zoom in' }).click();
    await expect(viewer.getByLabel('View zoom')).toHaveText('125% of fit');
    await expect(canvas).toBeVisible();
    const viewport = viewer.getByLabel('Drawing viewport for sheet 2');
    const scrollKey = await viewport.evaluate((element) =>
      element.scrollHeight > element.clientHeight ? 'ArrowDown' : 'ArrowRight',
    );
    await viewport.press(scrollKey);
    await expect
      .poll(() => viewport.evaluate((element) => Math.max(element.scrollTop, element.scrollLeft)))
      .toBeGreaterThan(0);
    const thumbnails = viewer.getByRole('navigation', { name: 'Sheets in this PDF' });
    await expect(thumbnails.locator('canvas:not([hidden])').first()).toBeVisible();
    const ratio = async () =>
      canvas.evaluate((element) =>
        element instanceof HTMLCanvasElement ? element.width / element.height : 0,
      );
    await expect.poll(ratio).toBeGreaterThan(1);
    await viewer.getByRole('button', { name: 'Rotate clockwise' }).click();
    await expect(canvas).toBeVisible();
    await expect.poll(ratio).toBeLessThan(1);
    await thumbnails.getByRole('button', { name: 'Sheet 1' }).click();
    await expect(viewer.getByRole('img', { name: 'Rendered drawing for sheet 1' })).toBeVisible();
    await viewer.getByRole('button', { name: 'Close sheet' }).click();
    await expect(page.getByRole('button', { name: 'Open sheet 2' })).toBeFocused();
    await page.getByRole('button', { name: 'Open sheet 2' }).click();
    await expect(viewer.getByLabel('View zoom')).toHaveText('125% of fit');

    await test.step('Capture and save a sheet calibration from two reference points', async () => {
      const calibration = viewer.getByRole('region', { name: 'Sheet scale calibration' });
      await calibration.getByRole('button', { name: 'Calibrate scale' }).click();
      await calibration.getByRole('button', { name: 'Pick reference point a' }).click();
      await expect(viewer.getByText('Select reference point a on the drawing.')).toBeVisible();
      const drawing = await canvas.boundingBox();
      if (!drawing) throw new Error('The rotated sheet is missing.');
      await canvas.click({ position: { x: 50, y: 90 } });
      const pointAX = calibration.getByLabel('Reference point A X (pt)', { exact: true });
      const pointAY = calibration.getByLabel('Reference point A Y (pt)', { exact: true });
      await expect(pointAX).not.toHaveValue('');
      expect(
        Math.abs(Number(await pointAX.inputValue()) - (90 / drawing.height) * 612),
      ).toBeLessThan(2);
      expect(
        Math.abs(Number(await pointAY.inputValue()) - (1 - 50 / drawing.width) * 792),
      ).toBeLessThan(2);
      await calibration.getByRole('button', { name: 'Pick reference point b' }).click();
      await canvas.click({ position: { x: 150, y: 90 } });
      const pointBX = calibration.getByLabel('Reference point B X (pt)', { exact: true });
      await expect(pointBX).not.toHaveValue('');

      await pointAX.fill('10');
      await pointAY.fill('15');
      await pointBX.fill('110');
      await calibration.getByLabel('Reference point B Y (pt)', { exact: true }).fill('15');
      await calibration.getByLabel('Known reference length').fill('10');
      await expect(
        calibration.getByText('Computed scale · 0.1 ft per drawing point'),
      ).toBeVisible();
      await calibration
        .getByRole('checkbox', { name: 'Verify against a second dimension' })
        .check();
      await calibration.getByLabel('Check point A X (pt)', { exact: true }).fill('10');
      await calibration.getByLabel('Check point A Y (pt)', { exact: true }).fill('15');
      await calibration.getByLabel('Check point B X (pt)', { exact: true }).fill('260');
      await calibration.getByLabel('Check point B Y (pt)', { exact: true }).fill('15');
      const knownCheck = calibration.getByLabel('Known check length (ft)', { exact: true });
      await knownCheck.fill('24');
      await expect(
        calibration.getByText(/Check the marked dimensions before using this scale/),
      ).toBeVisible();
      await knownCheck.fill('25');
      await expect(calibration.getByText(/Check dimension · 25 ft/)).toBeVisible();
      await calibration.getByRole('button', { name: 'Save calibration' }).click();
      await expect(calibration.getByText('Revision 1 · 0.1 ft per drawing point')).toBeVisible();

      await viewer.getByRole('button', { name: 'Close sheet' }).click();
      await page.getByRole('button', { name: 'Open sheet 2' }).click();
      await expect(
        viewer
          .getByRole('region', { name: 'Sheet scale calibration' })
          .getByText('Revision 1 · 0.1 ft per drawing point'),
      ).toBeVisible();
    });

    await test.step('Draw and save a calibrated polyline, then flag the earlier length after recalibration', async () => {
      const measures = viewer.getByRole('region', { name: 'Sheet length measurements' });
      await measures.getByRole('button', { name: 'Start length measurement' }).click();
      const constrain = measures.getByRole('checkbox', {
        name: 'Constrain segments to 45° increments',
      });
      await constrain.check();
      await expect(constrain).toBeChecked();
      await constrain.uncheck();
      await canvas.click({ position: { x: 72, y: 99 } });
      await canvas.dblclick({ position: { x: 139, y: 149 } });
      await expect(measures.getByRole('button', { name: 'Continue drawing' })).toBeVisible();
      await expect(viewer.locator('.enterprise-takeoff-path circle')).toHaveCount(2);
      await measures.getByLabel('Vertex 1 X (pt)', { exact: true }).fill('80');
      await measures.getByLabel('Vertex 1 Y (pt)', { exact: true }).fill('80');
      await measures.getByLabel('Vertex 2 X (pt)', { exact: true }).fill('110');
      await measures.getByLabel('Vertex 2 Y (pt)', { exact: true }).fill('120');
      await expect(measures.getByText('Length · 5 ft')).toBeVisible();

      await measures.getByText('Add a measurement category', { exact: true }).click();
      await measures.getByLabel('Category name').fill('Steel beam');
      await measures.getByRole('button', { name: 'Add category', exact: true }).click();
      await expect(
        measures.getByRole('combobox', { name: /^Measurement category/ }),
      ).not.toHaveValue('');
      await measures.getByRole('button', { name: 'Save length measurement' }).click();
      await expect(measures.getByText('Steel beam · 5 ft')).toBeVisible();

      const calibration = viewer.getByRole('region', { name: 'Sheet scale calibration' });
      await calibration.getByRole('button', { name: 'Recalibrate sheet' }).click();
      await calibration.getByLabel('Known reference length').fill('20');
      await calibration.getByRole('button', { name: 'Save calibration' }).click();
      await expect(calibration.getByText('Revision 2 · 0.2 ft per drawing point')).toBeVisible();
      await expect(measures.getByText('Steel beam · 5 ft')).toBeVisible();
      await expect(
        measures.getByText('Review required · Saved with an earlier scale'),
      ).toBeVisible();
    });

    await test.step('Draw an area with a deduction and verify the net area and perimeters', async () => {
      const areas = viewer.getByRole('region', { name: 'Sheet area measurements' });
      await areas.getByRole('button', { name: 'Start area measurement' }).click();
      await canvas.click({ position: { x: 40, y: 70 } });
      await canvas.click({ position: { x: 120, y: 70 } });
      await canvas.click({ position: { x: 120, y: 145 } });
      await canvas.dblclick({ position: { x: 40, y: 145 } });
      await expect(areas.getByRole('button', { name: 'Add a deduction boundary' })).toBeVisible();

      async function setRing(name: string, vertices: number[][]) {
        for (const [index, vertex] of vertices.entries()) {
          await areas
            .getByLabel(name + ' vertex ' + (index + 1) + ' X (pt)', { exact: true })
            .fill(String(vertex[0]));
          await areas
            .getByLabel(name + ' vertex ' + (index + 1) + ' Y (pt)', { exact: true })
            .fill(String(vertex[1]));
        }
      }
      await setRing('Exterior', [
        [10, 20],
        [60, 20],
        [60, 80],
        [10, 80],
      ]);
      await areas.getByRole('button', { name: 'Add a deduction boundary' }).click();
      await canvas.click({ position: { x: 65, y: 91 } });
      await canvas.click({ position: { x: 91, y: 91 } });
      await canvas.click({ position: { x: 91, y: 111 } });
      await canvas.dblclick({ position: { x: 65, y: 111 } });
      await setRing('Deduction 1', [
        [20, 30],
        [30, 30],
        [30, 45],
        [20, 45],
      ]);

      const deduction = areas.getByLabel('Deduction 1 vertex 1 X (pt)', { exact: true });
      await deduction.fill('100');
      await expect(areas.getByRole('button', { name: 'Save area measurement' })).toBeDisabled();
      await deduction.fill('20');
      await expect(
        areas.getByText(
          /Net area · 114 sq ft.*Exterior perimeter · 44 ft.*Deduction perimeter · 10 ft/,
        ),
      ).toBeVisible();
      await expect(
        viewer.locator('.enterprise-takeoff-area path[fill-rule="evenodd"]'),
      ).toHaveAttribute('d', /Z.*Z/);
      await areas.getByRole('button', { name: 'Save area measurement' }).click();
      await expect(areas.getByText('114 sq ft · 44 ft exterior perimeter')).toBeVisible();
      await expect(areas.getByText('6 sq ft deducted')).toBeVisible();
      await viewer.getByRole('button', { name: 'Close sheet' }).click();
      await page.getByRole('button', { name: 'Open sheet 2' }).click();
      await expect(
        viewer
          .getByRole('region', { name: 'Sheet area measurements' })
          .getByText('114 sq ft · 44 ft exterior perimeter'),
      ).toBeVisible();
    });

    await test.step('Count symbols, warn on a nearby marker, undo, and remove exactly one saved marker', async () => {
      const counts = viewer.getByRole('region', { name: 'Sheet object counts' });
      await counts.getByRole('button', { name: 'Start object count' }).click();
      await counts
        .getByRole('combobox', { name: /^Count category/ })
        .selectOption({ label: 'Steel beam' });
      await counts.getByRole('combobox', { name: /^Marker symbol/ }).selectOption('triangle');
      await canvas.click({ position: { x: 75, y: 90 } });
      await expect(counts.getByText('Draft count · 1')).toBeVisible();
      await canvas.click({ position: { x: 77, y: 92 } });
      await expect(
        counts.getByRole('alert').filter({ hasText: 'A marker is already near this position.' }),
      ).toBeVisible();
      await counts.getByRole('button', { name: 'Skip nearby marker' }).click();
      await canvas.click({ position: { x: 147, y: 130 } });
      await expect(counts.getByText('Draft count · 2')).toBeVisible();
      await counts.getByRole('button', { name: 'Undo last marker' }).click();
      await expect(counts.getByText('Draft count · 1')).toBeVisible();
      await canvas.click({ position: { x: 147, y: 130 } });
      await counts.getByRole('button', { name: 'Save object count' }).click();
      await expect(counts.getByText('Steel beam · 2 objects')).toBeVisible();
      await expect(viewer.locator('.enterprise-takeoff-count g path')).toHaveCount(2);

      await counts.getByText('Marker history', { exact: true }).click();
      await counts.getByRole('button', { name: 'Remove marker 1', exact: true }).click();
      await expect(counts.getByText('Steel beam · 1 object')).toBeVisible();
      await expect(counts.getByText('Marker 1 · Removed')).toBeVisible();
      await expect(viewer.locator('.enterprise-takeoff-count g path')).toHaveCount(1);
    });

    await test.step('Tag measurements by floor and room and show only the selected floor', async () => {
      const tags = viewer.getByRole('region', { name: 'Measurement conditions' });
      await tags.getByText('Add a project condition', { exact: true }).click();
      const add = tags.getByRole('button', { name: 'Add condition', exact: true });
      const name = tags.getByLabel('Condition name', { exact: true });
      const kind = tags.getByRole('combobox', { name: /^Condition type/ });
      await name.fill('North floor');
      await add.click();
      await expect(tags.getByText('Floor added · North floor')).toBeVisible();
      await name.fill('South floor');
      await add.click();
      await expect(tags.getByText('Floor added · South floor')).toBeVisible();

      await kind.selectOption('room');
      await name.fill('Lobby');
      await tags
        .getByRole('combobox', { name: /^Parent floor/ })
        .selectOption({ label: 'North floor' });
      await add.click();
      await expect(tags.getByText('Room added · Lobby')).toBeVisible();
      await kind.selectOption('material');
      await name.fill('Structural steel');
      await add.click();
      await expect(tags.getByText('Material added · Structural steel')).toBeVisible();

      await tags.getByRole('button', { name: 'Tag Length · 5 ft', exact: true }).click();
      await tags
        .getByRole('combobox', { name: /^Condition to apply/ })
        .selectOption({ label: 'Material · Structural steel' });
      await tags
        .getByRole('combobox', { name: /^Assignment floor/ })
        .selectOption({ label: 'North floor' });
      await tags
        .getByRole('combobox', { name: /^Assignment room/ })
        .selectOption({ label: 'Lobby' });
      await tags.getByRole('button', { name: 'Save condition assignment' }).click();
      await expect(tags.getByText('Structural steel · North floor · Lobby')).toBeVisible();

      await tags.getByRole('button', { name: 'Tag Area · 114 sq ft', exact: true }).click();
      await tags
        .getByRole('combobox', { name: /^Condition to apply/ })
        .selectOption({ label: 'Floor · South floor' });
      await tags.getByRole('button', { name: 'Save condition assignment' }).click();
      await expect(
        tags
          .getByRole('listitem')
          .filter({ hasText: 'Area · 114 sq ft' })
          .getByText('South floor', { exact: true }),
      ).toBeVisible();

      await expect(tags.getByText('Count · 1 object', { exact: true })).toBeVisible();
      const floors = tags.getByRole('combobox', { name: /^Filter measurements by floor/ });
      await floors.selectOption({ label: 'North floor' });
      await expect(tags.getByText('Length · 5 ft', { exact: true })).toBeVisible();
      await expect(tags.getByText('Area · 114 sq ft', { exact: true })).toHaveCount(0);
      await expect(tags.getByText('Count · 1 object', { exact: true })).toHaveCount(0);
      await floors.selectOption({ label: 'South floor' });
      await expect(tags.getByText('Area · 114 sq ft', { exact: true })).toBeVisible();
      await expect(tags.getByText('Length · 5 ft', { exact: true })).toHaveCount(0);
    });

    await test.step('Keep scale warnings visible and sign off the exact saved count', async () => {
      const tags = viewer.getByRole('region', { name: 'Measurement conditions' });
      const area = tags.getByRole('listitem').filter({ hasText: 'Area · 114 sq ft' });
      await area.locator('summary').click();
      await expect(area.getByText(/calibration check found an incorrect scale/i)).toBeVisible();
      await expect(area.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);

      await tags.getByRole('combobox', { name: /^Filter measurements by floor/ }).selectOption('');
      const count = tags.getByRole('listitem').filter({ hasText: 'Count · 1 object' });
      await count.getByText('Review measurement', { exact: true }).click();
      await count
        .getByLabel('Reason for review')
        .fill('Read the one remaining symbol on the sheet.');
      await count.getByRole('button', { name: 'Submit for review' }).click();
      await expect(
        count.getByRole('list', { name: 'Review history' }).getByText('Ready for review'),
      ).toBeVisible();
      await count.getByLabel('Review decision').selectOption('approved');
      await count.getByLabel('Decision reason').fill('Confirmed the symbol count on drawings.');
      await count.getByRole('button', { name: 'Record decision' }).click();
      await expect(
        count.getByRole('list', { name: 'Review history' }).getByText('Approved', { exact: true }),
      ).toBeVisible();
      await count.getByText('Review measurement', { exact: true }).click();
      await count.getByText('Review measurement', { exact: true }).click();
      await expect(count.getByText('Confirmed the symbol count on drawings.')).toBeVisible();
    });

    await test.step('Preview and confirm a reviewed takeoff transfer without silently replacing a quantity', async () => {
      const draft = await create(root + '/estimates', {
        title: 'Reviewed canopy quantities',
        currency: 'USD',
        quantityPrecision: 3,
        clientRequestId: randomUUID(),
      });
      const estimate = root + '/estimates/' + draft.id;
      await create(
        estimate + '/lines',
        {
          description: 'Canopy fittings',
          unit: 'ea',
          quantity: '2',
          clientRequestId: randomUUID(),
        },
        1,
      );
      const count = viewer
        .getByRole('region', { name: 'Measurement conditions' })
        .getByRole('listitem')
        .filter({ hasText: 'Count · 1 object' });
      await count.getByText('Push to estimate', { exact: true }).click();
      const transfer = count.getByRole('region', { name: 'Transfer takeoff quantity' });
      await transfer.getByLabel('Target estimate revision').selectOption(draft.id);
      await transfer.getByRole('checkbox', { name: /Canopy fittings/ }).check();
      await transfer.getByRole('button', { name: 'Preview quantity transfer' }).click();
      await expect(transfer.getByText('Quantity to save · 1 each')).toBeVisible();
      await expect(
        transfer.getByRole('button', { name: 'Confirm quantity transfer' }),
      ).toBeDisabled();
      await transfer.getByRole('button', { name: 'Cancel preview' }).click();

      const before = await page.request.get(estimate);
      expect(before.status()).toBe(200);
      expect((await before.json()).lines[0]).toMatchObject({ quantity: '2', sourceReviewId: null });
      await transfer
        .getByLabel(/Reason to replace Canopy fittings/)
        .fill('Replace the allowance with the reviewed count.');
      await transfer.getByRole('button', { name: 'Preview quantity transfer' }).click();
      await expect(transfer.getByText('Before rounding · 1 each')).toBeVisible();
      await transfer.getByRole('button', { name: 'Confirm quantity transfer' }).click();
      await expect(transfer.getByText('Quantity transfer recorded')).toBeVisible();
      const after = await page.request.get(estimate);
      expect(after.status()).toBe(200);
      expect((await after.json()).lines[0]).toMatchObject({
        quantity: '1',
        sourceReviewId: expect.any(String),
      });
    });

    await test.step('Review alignment and compare drawing changes without changing approval', async () => {
      const laterPlan = await create(root + '/takeoff/plan-sets', {
        title: 'Canopy current drawings',
        revisionLabel: 'Issue B',
        versionIds: [laterVersion.id],
        clientRequestId: randomUUID(),
      });
      const openComparison = page.getByRole('button', { name: 'Compare revisions', exact: true });
      const comparison = page.getByRole('region', { name: 'Compare plan revisions' });
      async function selectDrawings() {
        await page.reload();
        await page.getByRole('combobox', { name: /^Commercial project/ }).selectOption(project.id);
        await openComparison.click();
        await comparison.getByLabel('Earlier plan set').selectOption(earlierPlan.id);
        await comparison.getByLabel('Current plan set').selectOption(laterPlan.id);
        await comparison
          .getByLabel('Earlier sheet')
          .selectOption({ label: 'Sheet 2 · Original canopy drawings · Vault version 1' });
        await comparison
          .getByLabel('Current sheet')
          .selectOption({ label: 'Sheet 1 · Original canopy drawings · Vault version 2' });
      }
      await selectDrawings();
      const preview = comparison.getByRole('button', { name: 'Preview drawing overlay' });
      await preview.click();
      await expect(
        comparison.getByRole('heading', { name: 'Review alignment before comparing' }),
      ).toBeVisible();
      await expect(comparison.getByText('The page size or orientation differs.')).toBeVisible();
      await expect(comparison.getByRole('img', { name: 'Compared plan drawings' })).toHaveCount(0);
      const acknowledgement = comparison.getByRole('checkbox', {
        name: /I reviewed the alignment/,
      });
      await acknowledgement.check();
      await comparison.getByLabel('Horizontal offset (pt)').fill('12');
      await expect(acknowledgement).not.toBeChecked();
      await acknowledgement.check();
      await preview.click();
      await expect(
        comparison.getByRole('heading', { name: 'Alignment reviewed', exact: true }),
      ).toBeVisible();
      const overlay = comparison.getByRole('region', { name: 'Drawing overlay' });
      await expect(overlay).toHaveAttribute('data-renderer', 'server', { timeout: 15_000 });
      await expect(overlay.getByRole('img', { name: 'Compared plan drawings' })).toBeVisible();
      await expect(
        overlay.getByText(/^[1-9]\d* added pixels · [1-9]\d* removed pixels$/),
      ).toBeVisible();
      await overlay.getByRole('button', { name: 'Current drawing' }).click();
      await expect(overlay.getByRole('button', { name: 'Current drawing' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await test.step('Save and reopen an anchored comparison note', async () => {
        const notes = overlay.getByRole('region', { name: 'Comparison review notes' });
        const noteBody = 'Verify the revised canopy edge against the site clearance.';
        const notePin = notes.getByRole('button', { name: 'Show comparison note 1' });
        const noteRow = notes.getByRole('listitem').filter({ hasText: noteBody });
        await notes.getByRole('button', { name: 'Add comparison note' }).click();
        await notes.getByLabel('Horizontal position (%)').fill('38');
        await notes.getByLabel('Vertical position (%)').fill('62');
        await notes.getByLabel('Review note').fill(noteBody);
        await notes.getByRole('button', { name: 'Save comparison note' }).click();
        await expect(notes.getByText('Comparison note saved')).toBeVisible();
        await notePin.click();
        await expect(noteRow).toBeFocused();

        await selectDrawings();
        await comparison.getByLabel('Horizontal offset (pt)').fill('12');
        await preview.click();
        await acknowledgement.check();
        await preview.click();
        await expect(overlay).toHaveAttribute('data-renderer', 'server', { timeout: 15_000 });
        await expect(noteRow).toBeVisible();
        await expect(notePin).toHaveAttribute('style', /left: 38%; top: 62%;/);
      });
      await comparison.getByRole('button', { name: 'Close comparison' }).click();
      await expect(openComparison).toBeFocused();

      await page.getByRole('button', { name: /^Canopy review drawings/ }).click();
      await page.getByRole('button', { name: 'Open sheet 2' }).click();
      const count = viewer
        .getByRole('region', { name: 'Measurement conditions' })
        .getByRole('listitem')
        .filter({ hasText: 'Count · 1 object' });
      await count.getByText('Review measurement', { exact: true }).click();
      await expect(
        count.getByRole('list', { name: 'Review history' }).getByText('Approved', { exact: true }),
      ).toBeVisible();
    });
  } finally {
    if (!wasEnabled) {
      await page.request.put('/v1/enterprise/status', { headers, data: { enabled: false } });
    }
  }
});
