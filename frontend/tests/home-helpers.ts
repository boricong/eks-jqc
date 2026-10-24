import { expect, type Page } from '@playwright/test';

// Sample the rendered SVG behind every text run, rather than assuming a solid background.
export async function heroContrast(page: Page) {
  const hero = page.locator('.home-hero');
  await page.evaluate(() => document.fonts.ready);
  const samples = await hero.evaluate((el) => {
    const bounds = el.getBoundingClientRect();
    const result: {
      x: number;
      y: number;
      color: string;
      minimum: number;
      kind?: 'tabIndicator' | 'tabFocus';
    }[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const color = getComputedStyle(node.parentElement!).color;
      for (const r of range.getClientRects()) {
        for (let y = r.top + 1; y < r.bottom; y += 3)
          for (let x = r.left + 1; x < r.right; x += 3)
            result.push({ x: x - bounds.x, y: y - bounds.y, color, minimum: 4.5 });
      }
    }
    for (const a of el.querySelectorAll<HTMLElement>('.stat-item')) {
      const r = a.getBoundingClientRect();
      const color = getComputedStyle(el).getPropertyValue('--primary-press').trim();
      for (let x = r.left - 4; x <= r.right + 4; x += 4)
        for (const y of [r.top - 4, r.bottom + 4])
          result.push({ x: x - bounds.x, y: y - bounds.y, color, minimum: 3 });
    }
    for (const tab of el.querySelectorAll<HTMLElement>('.home-role-tabs [role="tab"]')) {
      const r = tab.getBoundingClientRect();
      const clip = tab.parentElement!.getBoundingClientRect();
      const style = getComputedStyle(tab);
      const sample = (x: number, y: number, color: string, kind: 'tabIndicator' | 'tabFocus') => {
        if (x >= clip.left && x < clip.right && y >= clip.top && y < clip.bottom)
          result.push({ x: x - bounds.x, y: y - bounds.y, color, minimum: 3, kind });
      };
      if (tab.getAttribute('aria-selected') === 'true')
        for (let x = r.left + 2; x < r.right - 2; x += 3)
          sample(x, r.bottom - 1, style.borderBottomColor, 'tabIndicator');
      if (tab.matches(':focus-visible') && style.outlineStyle !== 'none') {
        for (let x = r.left + 1; x < r.right; x += 3)
          for (const y of [r.top + 1, r.bottom - 1]) sample(x, y, style.outlineColor, 'tabFocus');
        for (let y = r.top + 1; y < r.bottom; y += 3)
          for (const x of [r.left + 1, r.right - 1]) sample(x, y, style.outlineColor, 'tabFocus');
      }
    }
    return result;
  });
  const hide = await page.addStyleTag({
    content:
      '.home-hero * { color: transparent !important; text-shadow: none !important; outline: none !important; } .home-hero svg { visibility: hidden !important; } .home-role-tabs [role=tab] { border-bottom-color: transparent !important; }',
  });
  let png: Buffer;
  try {
    png = await hero.screenshot();
  } finally {
    await hide.evaluate((el) => el.parentNode?.removeChild(el));
  }
  const ratios = await page.evaluate(
    async ({ image, samples }) => {
      const img = new Image();
      img.src = image;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
      const luminance = (rgb: number[]) =>
        rgb
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const minima = { text: 100, focus: 100, tabIndicator: 100, tabFocus: 100 };
      for (const s of samples) {
        const x = Math.max(0, Math.min(img.width - 1, Math.round(s.x)));
        const y = Math.max(0, Math.min(img.height - 1, Math.round(s.y)));
        const i = (y * img.width + x) * 4;
        const bg = luminance([pixels[i]!, pixels[i + 1]!, pixels[i + 2]!]);
        const rgb = s.color.startsWith('#')
          ? s.color
              .slice(1)
              .match(/../g)!
              .map((v) => parseInt(v, 16))
          : s.color
              .match(/[\d.]+/g)!
              .slice(0, 3)
              .map(Number);
        const fg = luminance(rgb);
        const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        const key = s.kind || (s.minimum === 4.5 ? 'text' : 'focus');
        minima[key] = Math.min(minima[key], ratio);
      }
      return minima;
    },
    { image: `data:image/png;base64,${png!.toString('base64')}`, samples },
  );
  expect(ratios.text).toBeGreaterThanOrEqual(4.5);
  expect(ratios.focus).toBeGreaterThanOrEqual(3);
  expect(ratios.tabIndicator).toBeGreaterThanOrEqual(3);
  expect(ratios.tabFocus).toBeGreaterThanOrEqual(3);
  return ratios;
}
