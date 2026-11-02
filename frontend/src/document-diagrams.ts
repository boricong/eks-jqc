import DOMPurify from 'dompurify';
import type { DocumentDiagram } from './document-markdown';

let engine: Promise<(typeof import('mermaid'))['default']> | undefined;
let queue = Promise.resolve();
let renderId = 0;
function loadEngine() {
  engine ??= import('mermaid')
    .then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        maxTextSize: 30000,
        maxEdges: 500,
        htmlLabels: false,
        theme: 'base',
        fontFamily: 'Pretendard, sans-serif',
        themeVariables: {
          fontFamily: 'Pretendard, sans-serif',
          fontSize: '14px',
          primaryColor: '#f6f9fc',
          primaryTextColor: '#0d253d',
          primaryBorderColor: '#78889e',
          lineColor: '#64748b',
          secondaryColor: '#eeecff',
          tertiaryColor: '#ffffff',
        },
        flowchart: { htmlLabels: false, useMaxWidth: false },
        sequence: { useMaxWidth: false, wrap: true },
      });
      return mermaid;
    })
    .catch((error) => {
      engine = undefined;
      throw error;
    });
  return engine;
}

/** Only populate the still-current, already-authorized document body. */
export function renderDocumentDiagrams(
  root: HTMLElement,
  diagrams: DocumentDiagram[],
  current: () => boolean,
) {
  queue = queue.then(async () => {
    for (const diagram of diagrams) {
      if (!current() || !root.isConnected) return;
      const target = root.querySelector<HTMLElement>(`#${diagram.id}`);
      if (!target) continue;
      try {
        // Keep document content from overriding the application theme or security settings.
        if (
          diagram.source.length > 30000 ||
          !/^(flowchart|graph|sequenceDiagram)\b/.test(diagram.source.trim()) ||
          /%%\s*\{|(?:^|[;\n])\s*(click|classDef|style|linkStyle)\b/.test(diagram.source)
        )
          throw new Error('Unsupported diagram');
        const mermaid = await loadEngine();
        if (!current() || !root.isConnected) return;
        await document.fonts.ready;
        const { svg } = await mermaid.render(`eks-document-diagram-${++renderId}`, diagram.source);
        if (!current() || !root.isConnected) return;
        target.innerHTML = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: [
            'a',
            'image',
            'foreignObject',
            'script',
            'animate',
            'animateMotion',
            'animateTransform',
            'set',
          ],
          FORBID_ATTR: ['href', 'xlink:href'],
        });
        const graphic = target.querySelector('svg');
        if (!graphic) throw new Error('Missing diagram');
        graphic.setAttribute('role', 'img');
        graphic.setAttribute('aria-label', diagram.label);
      } catch {
        if (!current() || !root.isConnected) return;
        const message = document.createElement('p');
        message.className = 'document-diagram-error';
        message.setAttribute('role', 'status');
        message.textContent = '다이어그램을 표시하지 못했습니다. 아래 원문을 확인해 주세요.';
        target.replaceChildren(message);
        target.parentElement?.querySelector('details')?.setAttribute('open', '');
      } finally {
        target.removeAttribute('aria-busy');
      }
    }
  });
  return queue;
}
