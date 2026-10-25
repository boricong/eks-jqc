import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export async function checkCarouselVisuals(page: Page, navigation = true) {
  const region = page.getByRole('region', { name: '진행 중인 자격', exact: true });
  const frame = region.locator('.home-qualification-frame');
  const result = await frame.evaluate((el) => {
    const rgb = (color: string) => color.match(/[\d.]+/g)!.map(Number);
    const background = (element: Element | null): string => {
      if (!element) return 'rgb(255, 255, 255)';
      const color = getComputedStyle(element).backgroundColor;
      return (rgb(color)[3] ?? 1) === 1 ? color : background(element.parentElement);
    };
    const region = el.parentElement!;
    const heading = region.querySelector('.section-heading')!;
    return {
      distinct: background(el) !== background(region),
      headerUnchanged: background(heading) === background(region),
      left: Math.abs(el.getBoundingClientRect().left - region.getBoundingClientRect().left),
      width: Math.abs(el.getBoundingClientRect().width - region.getBoundingClientRect().width),
      titleLeft: Math.abs(
        heading.getBoundingClientRect().left - region.getBoundingClientRect().left,
      ),
    };
  });
  await carouselContrast(page);
  expect(result.distinct).toBe(true);
  expect(result.headerUnchanged).toBe(true);
  expect(result.left).toBeLessThan(1);
  expect(result.width).toBeLessThan(1);
  expect(result.titleLeft).toBeLessThan(1);
  if (navigation) {
    await expect(region.getByRole('button', { name: '이전 항목' })).toHaveText('이전');
    await expect(region.getByRole('button', { name: '다음 항목' })).toHaveText('다음');
  } else {
    await expect(region.getByRole('group', { name: '항목 탐색' })).toHaveCount(0);
  }
}

// Measure the actual photo + opacity + mask composition, including button surfaces.
export async function carouselContrast(page: Page) {
  const frame = page.locator('.home-qualification-frame');
  await frame.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await frame.evaluate(async (el) => {
    const url = getComputedStyle(el, '::before').backgroundImage.match(
      /url\(["']?(.*?)["']?\)/,
    )?.[1];
    if (url) {
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {});
    }
  });
  const samples = await frame.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const points: { x: number; y: number; color: string; kind: 'text' | 'controls' | 'focus' }[] =
      [];
    const add = (x: number, y: number, color: string, kind: 'text' | 'controls' | 'focus') => {
      if (x >= box.left && x < box.right && y >= box.top && y < box.bottom)
        points.push({ x: x - box.left, y: y - box.top, color, kind });
    };
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement!;
      if (!node.textContent?.trim() || parent.closest('[inert], [aria-disabled="true"]')) continue;
      const clip = parent.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects())
        for (let y = Math.max(r.top, clip.top) + 1; y < Math.min(r.bottom, clip.bottom); y += 3)
          for (let x = Math.max(r.left, clip.left) + 1; x < Math.min(r.right, clip.right); x += 3)
            add(x, y, getComputedStyle(parent).color, 'text');
    }
    for (const button of el.querySelectorAll<HTMLElement>(
      'button:not([aria-disabled="true"]), a',
    )) {
      if (button.closest('[inert]')) continue;
      const r = button.getBoundingClientRect(),
        style = getComputedStyle(button);
      for (let x = r.left + 12; x < r.right - 12; x += 3)
        for (const y of [r.top - 1, r.bottom + 1]) add(x, y, style.borderTopColor, 'controls');
      if (button.matches(':focus-visible') && style.outlineStyle !== 'none') {
        const offset = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth) / 2;
        for (let x = r.left + 12; x < r.right - 12; x += 3)
          for (const y of [r.top - offset, r.bottom + offset])
            add(x, y, style.outlineColor, 'focus');
      }
    }
    return points;
  });
  const hide = await page.addStyleTag({
    content:
      '.home-qualification-frame * { -webkit-text-fill-color: transparent !important; text-shadow: none !important; outline-color: transparent !important; } .home-qualification-frame svg { visibility: hidden !important; }',
  });
  let png: Buffer;
  try {
    png = await frame.screenshot();
  } finally {
    await hide.evaluate((el) => el.parentNode?.removeChild(el));
  }
  const result = await page.evaluate(
    async ({ image, samples }) => {
      const img = new Image();
      img.src = image;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      const luminance = (rgb: number[]) =>
        rgb
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const minima = { text: 100, controls: 100, focus: 100 };
      const worst: Record<string, unknown> = {};
      for (const p of samples) {
        const x = Math.max(0, Math.min(img.width - 1, Math.round(p.x))),
          y = Math.max(0, Math.min(img.height - 1, Math.round(p.y)));
        const i = (y * img.width + x) * 4;
        const bg = luminance([data[i]!, data[i + 1]!, data[i + 2]!]);
        const fg = luminance(
          p.color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number),
        );
        const ratio = (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
        if (ratio < minima[p.kind])
          worst[p.kind] = { ...p, background: [data[i], data[i + 1], data[i + 2]], ratio };
        minima[p.kind] = Math.min(minima[p.kind], ratio);
      }
      return { ...minima, worst };
    },
    { image: `data:image/png;base64,${png!.toString('base64')}`, samples },
  );
  expect(result.text, JSON.stringify(result.worst)).toBeGreaterThanOrEqual(4.5);
  expect(result.controls, JSON.stringify(result.worst)).toBeGreaterThanOrEqual(3);
  expect(result.focus).toBeGreaterThanOrEqual(3);
  return result;
}
