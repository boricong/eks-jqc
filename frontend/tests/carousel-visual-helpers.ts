import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export async function checkCarouselVisuals(page: Page, navigation = true) {
  const region = page.getByRole('region', { name: '진행 중인 자격', exact: true });
  const frame = region.locator('.home-qualification-frame');
  const result = await frame.evaluate((el) => {
    const rgb = (color: string) => color.match(/[\d.]+/g)!.map(Number);
    const luminance = (color: string) =>
      rgb(color)
        .slice(0, 3)
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i]!, 0);
    const contrast = (a: string, b: string) => {
      const x = luminance(a),
        y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const background = (element: Element | null): string => {
      if (!element) return 'rgb(255, 255, 255)';
      const color = getComputedStyle(element).backgroundColor;
      return (rgb(color)[3] ?? 1) === 1 ? color : background(element.parentElement);
    };
    let text = Infinity,
      controls = Infinity;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement!;
      if (!node.textContent?.trim() || parent.closest('[inert], [aria-disabled="true"]')) continue;
      text = Math.min(text, contrast(getComputedStyle(parent).color, background(parent)));
    }
    for (const button of el.querySelectorAll<HTMLElement>(
      'button:not([aria-disabled="true"]), a',
    )) {
      if (button.closest('[inert]')) continue;
      const style = getComputedStyle(button);
      controls = Math.min(controls, contrast(style.borderColor, background(button.parentElement)));
    }
    const region = el.parentElement!;
    const heading = region.querySelector('.section-heading')!;
    return {
      text,
      controls,
      distinct: background(el) !== background(region),
      headerUnchanged: background(heading) === background(region),
      left: Math.abs(el.getBoundingClientRect().left - region.getBoundingClientRect().left),
      width: Math.abs(el.getBoundingClientRect().width - region.getBoundingClientRect().width),
      titleLeft: Math.abs(
        heading.getBoundingClientRect().left - region.getBoundingClientRect().left,
      ),
    };
  });
  expect(result.text).toBeGreaterThanOrEqual(4.5);
  expect(result.controls).toBeGreaterThanOrEqual(3);
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
