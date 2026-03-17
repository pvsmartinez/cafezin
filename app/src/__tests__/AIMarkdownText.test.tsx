import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { openUrl } from '@tauri-apps/plugin-opener';
import { CodeBlock } from '../components/ai/AICodeBlock';
import { AIMarkdownText } from '../components/ai/AIMarkdownText';

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('AIMarkdownText', () => {
  let container: HTMLDivElement;
  let root: Root;
  let clipboardWriteText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders common markdown structure for assistant messages', () => {
    act(() => {
      root.render(
        <AIMarkdownText
          content={`# Titulo\n\n- item 1\n- item 2\n\n**negrito** e \`codigo\``}
        />,
      );
    });

    const heading = container.querySelector('h1');
    const listItems = Array.from(container.querySelectorAll('li')).map((node) => node.textContent?.trim());
    const strong = container.querySelector('strong');
    const code = container.querySelector('code');

    expect(heading?.textContent).toBe('Titulo');
    expect(listItems).toEqual(['item 1', 'item 2']);
    expect(strong?.textContent).toBe('negrito');
    expect(code?.textContent).toBe('codigo');
  });

  it('linkifies plain domains and opens them in the browser', () => {
    act(() => {
      root.render(
        <AIMarkdownText content={'Abra app.supabase.com/project/default para revisar.'} />,
      );
    });

    const link = container.querySelector('a');
    expect(link?.textContent).toBe('app.supabase.com/project/default');
    expect(link?.getAttribute('href')).toBe('https://app.supabase.com/project/default');

    act(() => {
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(openUrl).toHaveBeenCalledWith('https://app.supabase.com/project/default');
  });

  it('adds copy buttons to rendered code blocks', async () => {
    act(() => {
      root.render(
        <AIMarkdownText content={'```ts\nconst answer = 42;\n```'} />,
      );
    });

    const copyButton = container.querySelector('.md-copy-btn');
    expect(copyButton?.textContent).toBe('Copy');

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(clipboardWriteText).toHaveBeenCalledWith('const answer = 42;\n');
  });

  it('copies agent code block content from the explicit copy action', async () => {
    act(() => {
      root.render(
        <CodeBlock lang="ts" code={'const answer = 42;'} />,
      );
    });

    const copyButton = container.querySelector('.ai-code-copy-btn');
    expect(copyButton?.textContent).toContain('Copy');

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(clipboardWriteText).toHaveBeenCalledWith('const answer = 42;');
  });
});