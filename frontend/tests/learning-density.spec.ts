import { showLearningMaterials } from './learning-helpers';
import { test, expect, actor } from './fixtures';
import { writeFile } from 'node:fs/promises';
test('동일 학습 정보의 네 화면 폭과 자료 도달 위치', async ({ page, backend }, info) => {
  await backend.store.transact(
    'admin-1',
    crypto.randomUUID(),
    crypto.randomUUID(),
    () => {},
    (s) => {
      const a = s.assignments.find((a) => a.id === 'assignment-1')!;
      Object.assign(a.qualificationMetadata!, {
        title: '설비 상태 점검과 독립 수행',
        description:
          '설비 상태와 공정 조건을 확인하고 작업 기준에 따라 독립적으로 수행합니다.\n안전 수칙과 이상 징후의 판단 근거를 함께 익힙니다.',
      });
      const c = s.courses.find((c) => c.id === 'demo-course-1')!;
      c.learningItems = Array.from({ length: 10 }, (_, i) => ({
        id: `scope-${i}`,
        title: `${i + 1}. 작업 기준과 판단 근거 확인`,
        type: 'ojt' as const,
        required: true,
      }));
      c.materials = Array.from({ length: 5 }, (_, i) => ({
        id: `reading-${i}`,
        title: `${i + 1}. 설비 점검 학습자료`,
        type: 'text' as const,
        description: '관찰할 항목과 근거를 확인합니다.',
        url: '',
        content:
          '설비 상태와 공정 조건을 확인하고 작업 기준을 기록합니다.\n판단 근거를 비교하여 독립적인 수행을 준비합니다.\n\n'.repeat(
            35,
          ),
      }));
      return {};
    },
  );
  await page.goto('/');
  await actor(page, 'learner-1');
  await page.goto('/qualifications/assignment-1?course=demo-course-1');
  await showLearningMaterials(page);
  const before = backend.store.snapshot();
  const metrics = [];
  const paletteAudit = [];
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page.getByRole('region', { name: '학습자료', exact: true })).toBeVisible();
    metrics.push(
      await page.evaluate(() => ({
        width: innerWidth,
        height: document.documentElement.scrollHeight,
        materialTop: document
          .querySelector('.learning-material-reader,.course-material-collection')!
          .getBoundingClientRect().top,
        bodyTop: document
          .querySelector('.learning-material-body,.material-content')!
          .getBoundingClientRect().top,
        qualificationHeight: document.querySelector('.learning-hero')!.getBoundingClientRect()
          .height,
        courseHeight: document.querySelector('.learning-course-hero')!.getBoundingClientRect()
          .height,
        overflow: document.documentElement.scrollWidth > innerWidth,
      })),
    );
    const latest = metrics.at(-1)!;
    expect(latest.overflow).toBe(false);
    if (width >= 1280) {
      expect(latest.qualificationHeight).toBeGreaterThanOrEqual(160);
      const heroBox = (await page.locator('.learning-hero').boundingBox())!;
      const workspaceBox = (await page.locator('.qualification-workspace').boundingBox())!;
      expect(workspaceBox.y - heroBox.y - heroBox.height).toBeCloseTo(32, 1);
    }
    await expect(page.locator('.learning-hero h1')).toHaveCSS('font-size', '24px');
    await expect(page.locator('.learning-hero h1')).toHaveCSS('font-weight', '600');
    await expect(page.locator('.learning-material-body .material-content')).toHaveCSS(
      'font-size',
      '15px',
    );
    await expect(page.locator('.learning-material-body .material-content')).toHaveCSS(
      'line-height',
      '24.75px',
    );
    await expect(page.locator('.learning-hero')).toHaveCSS('font-family', /Pretendard/);
    const courseHero = page.getByRole('region', { name: '인증Set 요약', exact: true });
    await expect(courseHero).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(courseHero).toHaveCSS('border-left-width', '4px');
    await expect(courseHero.getByRole('heading', { level: 2 })).toHaveCSS('font-size', '18px');
    await expect(courseHero.locator('.small-label').first()).toHaveCSS('font-size', '13px');
    const hero = page.getByRole('region', { name: '자격 요약', exact: true });
    await expect(hero).toHaveCSS('background-color', 'rgb(246, 249, 252)');
    await expect(hero).toHaveCSS('color', 'rgb(13, 37, 61)');
    await expect(hero).toHaveCSS('border-left-width', '1px');
    await expect(hero).toHaveCSS('border-left-color', 'rgb(227, 232, 238)');
    await expect(hero).toHaveCSS('border-top-width', '1px');
    await expect(hero).toHaveCSS('border-top-color', 'rgb(227, 232, 238)');
    const details = hero.getByRole('region', { name: '자격 상세 정보', includeHidden: true });
    const toggle = hero.getByRole('button', { name: '자격 정보', exact: true });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(details).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(details).toBeHidden();
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveCSS('outline-style', 'solid');
    await expect(toggle).toHaveCSS('outline-width', '2px');
    const contrasts = await page.locator('.qualification-detail').evaluate((root) => {
      const rgb = (c: string) => c.match(/[\d.]+/g)!.map(Number);
      const bg = (el: Element | null): number[] => {
        if (!el) return [255, 255, 255];
        const c = rgb(getComputedStyle(el).backgroundColor),
          a = c[3] ?? 1;
        if (a === 1) return c;
        return bg(el.parentElement).map((v, i) => c[i]! * a + v * (1 - a));
      };
      const lum = (c: number[]) =>
        c.slice(0, 3).reduce((sum, v, i) => {
          v /= 255;
          return (
            sum +
            (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]!
          );
        }, 0);
      const ratio = (a: number[], b: number[]) =>
        (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
      const text = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const el = node.parentElement!;
        if (!node.textContent?.trim() || !el.checkVisibility()) continue;
        text.push(ratio(rgb(getComputedStyle(el).color), bg(el)));
      }
      const controls = [...root.querySelectorAll<HTMLElement>('.button')]
        .filter((el) => el.checkVisibility())
        .map((el) => ratio(rgb(getComputedStyle(el).borderColor), bg(el.parentElement)));
      const hero = root.querySelector('.learning-course-hero')!;
      const summary = root.querySelector('.learning-hero button[aria-expanded]')!;
      return {
        text: Math.min(...text),
        controls: Math.min(...controls),
        accent: ratio(rgb(getComputedStyle(hero).borderLeftColor), bg(hero)),
        focus: ratio(rgb(getComputedStyle(summary).outlineColor), bg(summary)),
      };
    });
    expect(contrasts.text).toBeGreaterThanOrEqual(4.5);
    expect(contrasts.controls).toBeGreaterThanOrEqual(3);
    expect(contrasts.accent).toBeGreaterThanOrEqual(3);
    expect(contrasts.focus).toBeGreaterThanOrEqual(3);
    paletteAudit.push({ width, ...contrasts });
    await toggle.evaluate((el) => (el as HTMLElement).blur());
    if (width <= 768) {
      for (const control of await page
        .locator(
          '.qualification-detail button:visible, .qualification-detail .button:visible, .qualification-detail summary:visible, .qualification-detail .learner-nav a',
        )
        .all())
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: info.outputPath(`learning-${width}.png`), fullPage: true });
    await page.screenshot({ path: info.outputPath(`learning-first-screen-${width}.png`) });
    await page
      .getByRole('navigation', { name: '자격 취득 메뉴' })
      .getByRole('link', { name: '평가', exact: true })
      .click();
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page.getByRole('region', { name: '자격 요약' })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({
      path: info.outputPath(`assessment-selection-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole('navigation', { name: '자격 취득 메뉴' })
      .getByRole('link', { name: '학습', exact: true })
      .click();
  }
  await writeFile(info.outputPath('density.json'), JSON.stringify(metrics, null, 2));
  await writeFile(info.outputPath('palette-audit.json'), JSON.stringify(paletteAudit, null, 2));
  expect(backend.store.snapshot()).toEqual(before);
});
