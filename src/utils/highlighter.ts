import { codeToHtml, bundledLanguages, bundledThemes } from 'shiki';

export async function highlightCodeAsync(code: string, lang: string | undefined): Promise<string> {
  if (!lang) {
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  }

  try {
    const lightTheme = 'github-light' as keyof typeof bundledThemes;
    const darkTheme = 'github-dark' as keyof typeof bundledThemes;
    return await codeToHtml(code, {
      lang: lang as keyof typeof bundledLanguages,
      themes: {
        light: lightTheme,
        dark: darkTheme,
      },
    });
  } catch (err) {
    // Fallback if language is not supported
    return `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(code)}</code></pre>`;
  }
}

function escapeHtml(str: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return str.replace(/[&<>"']/g, (m) => map[m]);
}
