import katex from 'katex';

const MATH_TOKEN_RE = /\[\[(BLOCK_MATH|MATH)\]\]([\s\S]*?)\[\[\/\1\]\]/g;

export function renderMathMarkers(value: string) {
  return value.replace(MATH_TOKEN_RE, (_match, token: string, rawFormula: string) => {
    const formula = rawFormula.trim();
    if (!formula) {
      return '';
    }
    try {
      return katex.renderToString(formula, {
        displayMode: token === 'BLOCK_MATH',
        throwOnError: false,
        output: 'html',
      });
    } catch {
      return `<code class="math-error">${escapeHTML(formula)}</code>`;
    }
  });
}

function escapeHTML(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
