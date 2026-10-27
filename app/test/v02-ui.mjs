import assert from 'node:assert/strict';
import path from 'node:path';

/** Shared by the three-browser production check; every visible operation uses the keyboard. */
export async function foregroundOperations(page, { root, name, activate, tabTo, audit, ready }) {
  const button = (label) => page.getByRole('button', { name: label, exact: true });
  const add = button('人物の絵を重ねる'),
    position = button('人物の位置。矢印キーで動かします');
  const choose = async (file) => {
    const chooser = page.waitForEvent('filechooser');
    await activate(add);
    await (await chooser).setFiles(file);
  };
  const settled = () =>
    page.waitForFunction(
      () => document.querySelector('.foreground-panel')?.getAttribute('aria-busy') === 'false',
    );
  const capture = (state) =>
    page.screenshot({ path: path.join(root, `reports/V02-${name}-${state}.png`), fullPage: true });
  await capture('empty');
  await choose(path.join(root, 'src/assets/samples/flat.webp'));
  await settled();
  await page
    .getByRole('alert')
    .filter({ hasText: 'この画像には透けた部分がありません。背景が透けた PNG を選んでください。' })
    .waitFor()
    .catch(async (error) => {
      throw new Error(
        `${error.message}\nPanel: ${await page.locator('.foreground-panel').textContent()}`,
      );
    });
  assert.equal(await position.count(), 0);
  await audit('foreground-opaque');
  await capture('opaque');
  // Hold only the image decode promise to observe real disabled controls during a foreground load.
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    window.releaseForegroundDecode = undefined;
    HTMLImageElement.prototype.decode = function () {
      const work = decode.call(this);
      HTMLImageElement.prototype.decode = decode;
      return work.then(
        () =>
          new Promise((resolve) => {
            window.releaseForegroundDecode = resolve;
          }),
      );
    };
  });
  await choose(path.join(root, '../assets/showcase/layer/girl.png'));
  await page.waitForFunction(() => !!window.releaseForegroundDecode);
  assert.ok(await add.isDisabled());
  assert.ok(await page.getByLabel('人物の画像ファイル', { exact: true }).isDisabled());
  await capture('loading');
  await page.evaluate(() => window.releaseForegroundDecode());
  await settled();
  assert.equal(await page.locator('.foreground-summary span').textContent(), 'girl');
  assert.equal(await page.getByRole('slider', { name: '大きさ', exact: true }).inputValue(), '70');
  const blend = page.getByRole('slider', { name: '夜のなじみ', exact: true });
  assert.equal(await blend.inputValue(), '50');
  assert.equal(await blend.getAttribute('aria-valuetext'), 'ふつう');
  await tabTo(blend);
  await page.keyboard.press('Home');
  assert.equal(await blend.getAttribute('aria-valuetext'), 'なし');
  await page.keyboard.press('ArrowRight');
  assert.equal(await blend.getAttribute('aria-valuetext'), '弱め');
  await page.keyboard.press('End');
  assert.equal(await blend.getAttribute('aria-valuetext'), '同じ');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await blend.getAttribute('aria-valuetext'), '強め');
  await blend.fill('50');
  await blend.dispatchEvent('change');
  const size = page.getByRole('slider', { name: '大きさ', exact: true });
  await tabTo(size);
  await page.keyboard.press('ArrowRight');
  assert.equal(await size.inputValue(), '71');
  await page.keyboard.press('ArrowLeft');
  // The position rectangle deliberately has the spec's 1px dotted focus, rather than the common 2px outline.
  await page.locator('#picture').focus();
  for (let i = 0; i < 100; i++) {
    await page.keyboard.press('Tab');
    if (await position.evaluate((n) => n === document.activeElement)) break;
  }
  assert.ok(await position.evaluate((n) => n === document.activeElement));
  const focus = await position.evaluate((n) => ({
    visible: n.matches(':focus-visible'),
    width: getComputedStyle(n).outlineWidth,
    style: getComputedStyle(n).outlineStyle,
  }));
  assert.deepEqual(focus, { visible: true, width: '1px', style: 'dotted' });
  const at = () =>
    position.evaluate((n) => ({
      left: parseFloat(n.style.left),
      top: parseFloat(n.style.top),
      width: parseFloat(n.style.width),
      height: parseFloat(n.style.height),
    }));
  const initial = await at();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+ArrowUp');
  const moved = await at();
  assert.ok(Math.abs(moved.left - initial.left + 1) < 1e-5);
  assert.ok(Math.abs(moved.top - initial.top + 10) < 1e-5);
  await capture('position-focus');
  await page.bringToFront();
  await position.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowRight');
  const right = await at();
  assert.ok(Math.abs(right.left + right.width / 2 - 100) < 1e-3, JSON.stringify(right));
  for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowDown');
  const bottom = await at();
  assert.ok(
    Math.abs(bottom.top + bottom.height - (100 + bottom.height / 2)) < 1e-3,
    JSON.stringify(bottom),
  );
  // Pointer and touch events use the same clamped placement path as the keyboard.
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowUp');
  const beforeDrag = await at(),
    box = await position.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5 - 30, box.y + box.height * 0.4 - 15, { steps: 3 });
  await page.mouse.up();
  assert.ok((await at()).left < beforeDrag.left);
  await audit('foreground-present');
  await capture('present');
  // A new background must retain all four settings and the person.
  const placement = await at();
  await activate(button('運河の街'));
  await ready();
  assert.deepEqual(await at(), placement);
  await activate(button('外す'));
  assert.equal(await position.count(), 0);
  assert.ok(await add.evaluate((n) => n === document.activeElement));
  await capture('removed');
  return {
    keyboard: true,
    focus,
    mouseDrag: true,
    placementClamped: true,
    opaqueRejected: true,
    loadingDisabled: true,
    backgroundRetainsSettings: true,
    removed: true,
  };
}
