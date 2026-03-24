/** Formats source code via Prettier standalone (code-split). */
export async function formatContent(code: string, language: string): Promise<string> {
  try {
    const prettier = await import('prettier/standalone');
    if (language === 'javascript' || language === 'jsx') {
      const [babel, estree] = await Promise.all([
        import('prettier/plugins/babel'),
        import('prettier/plugins/estree'),
      ]);
      return await prettier.format(code, { parser: 'babel', plugins: [babel, estree] });
    }
    if (language === 'typescript' || language === 'tsx') {
      const [ts, estree] = await Promise.all([
        import('prettier/plugins/typescript'),
        import('prettier/plugins/estree'),
      ]);
      return await prettier.format(code, { parser: 'typescript', plugins: [ts, estree] });
    }
    if (language === 'json') {
      const [babel, estree] = await Promise.all([
        import('prettier/plugins/babel'),
        import('prettier/plugins/estree'),
      ]);
      return await prettier.format(code, { parser: 'json', plugins: [babel, estree] });
    }
    if (language === 'css' || language === 'scss' || language === 'less') {
      const css = await import('prettier/plugins/postcss');
      return await prettier.format(code, { parser: 'css', plugins: [css] });
    }
    if (language === 'html') {
      const html = await import('prettier/plugins/html');
      return await prettier.format(code, { parser: 'html', plugins: [html] });
    }
  } catch { /* formatting failed — return original */ }
  return code;
}
