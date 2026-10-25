import { test, expect, actor } from './fixtures';
import { carouselContrast } from './carousel-visual-helpers';

const frameSelector = '.home-qualification-frame';
test('반도체 배경의 독립 투명도·네 폭 합성 대비·고정 배치와 지역 자산', async ({
  page,
  backend,
}, info) => {
  await page.goto('/');
  await actor(page, 'learner-1');
  const before = backend.store.snapshot();
  const frame = page.locator(frameSelector);
  const metrics = [];
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await frame.scrollIntoViewIfNeeded();
    const style = await frame.evaluate((el) => {
      const decoration = getComputedStyle(el, '::before');
      return {
        opacity: decoration.opacity,
        image: decoration.backgroundImage,
        pointer: decoration.pointerEvents,
        foreground: getComputedStyle(el).opacity,
      };
    });
    expect(style.opacity).toBe(width < 768 ? '0.38' : '0.55');
    expect(style.foreground).toBe('1');
    expect(style.pointer).toBe('none');
    expect(style.image).toContain(
      width < 768 ? 'semiconductor-card-mobile.webp' : 'semiconductor-card.webp',
    );
    const url = style.image.match(/url\("(.*?)"\)/)![1]!;
    expect(new URL(url).origin).toBe(new URL(page.url()).origin);
    expect((await page.request.get(url)).status()).toBe(200);
    const loaded = await frame.boundingBox();
    const hide = await page.addStyleTag({
      content: '.home-qualification-frame::before { background-image:none !important; }',
    });
    expect(await frame.boundingBox()).toEqual(loaded);
    if (width === 1920) await page.screenshot({ path: info.outputPath('before-1920.png') });
    await hide.evaluate((el) => el.parentNode?.removeChild(el));
    await frame.getByRole('link', { name: '상세정보 보기', exact: true }).focus();
    const contrast = await carouselContrast(page);
    expect(contrast.focus).toBeLessThan(100);
    metrics.push({ width, ...contrast });
    await page.screenshot({ path: info.outputPath(`wafer-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(backend.store.snapshot()).toEqual(before);
  await info.attach('composited-contrast', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
});

test('배경 로드 실패와 빈 카드에서도 정보·크기·클릭·계정 격리 유지', async ({
  page,
  backend,
}, info) => {
  await page.route('**/semiconductor-card*.webp', (route) => route.abort());
  await page.goto('/');
  await actor(page, 'learner-1');
  const frame = page.locator(frameSelector);
  await expect(frame.getByRole('link', { name: '상세정보 보기', exact: true })).toBeVisible();
  const failed = await frame.boundingBox();
  const before = backend.store.snapshot();
  await page.unroute('**/semiconductor-card*.webp');
  await page.reload();
  await expect(frame).toBeVisible();
  expect(await frame.boundingBox()).toEqual(failed);
  await frame.getByRole('link', { name: '상세정보 보기', exact: true }).click();
  await expect(page).toHaveURL(/\/qualifications\//);
  await page.goto('/');
  await actor(page, 'ft-1');
  await expect(frame).toHaveClass(/empty-state/);
  await expect(frame).toContainText('진행 중인 자격이 없습니다.');
  for (const width of [1920, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await carouselContrast(page);
    await page.screenshot({ path: info.outputPath(`empty-${width}.png`) });
  }
  await frame.getByRole('link', { name: '내 계획 확인' }).click();
  await expect(page).toHaveURL(/\/plans/);
  expect(backend.store.snapshot()).toEqual(before);
});
