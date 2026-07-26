import { useCallback, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Components } from 'react-markdown';

/** Copy text to clipboard */
async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}

/** Custom code block component with syntax highlighting, language label, and copy button */
function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const language =
    className?.replace(/^language-/, '').trim() || 'text';

  const code = String(children).replace(/\n$/, '');

  const handleCopy = useCallback(async () => {
    await copyToClipboard(code);
    setCopied(true);

    window.setTimeout(() => {
      setCopied(false);
    }, 2000);
  }, [code]);

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{language}</span>

        <button
          type="button"
          onClick={handleCopy}
          className="copy-button"
          aria-label={copied ? 'Code copied' : 'Copy code'}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: '18px',
          borderRadius: '0 0 10px 10px',
          background: '#181818',
          fontSize: '13px',
          lineHeight: '1.7',
          overflowX: 'auto',
        }}
        codeTagProps={{
          style: {
            fontFamily:
              '"JetBrains Mono", "Fira Code", Consolas, monospace',
          },
        }}
        wrapLongLines={false}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

/** Custom markdown renderers — reuse across panels */
export const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const isCodeBlock = Boolean(className?.startsWith('language-'));

    if (!isCodeBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }

    return (
      <CodeBlock className={className}>{children}</CodeBlock>
    );
  },
};