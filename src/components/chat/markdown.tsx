"use client";

/**
 * Lightweight markdown renderer for chat text parts.
 */
import ReactMarkdown from "react-markdown";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-body text-sm leading-relaxed break-words">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>,
          h1: ({ children }) => <h1 className="mb-2 text-lg font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 text-base font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 text-sm font-semibold">{children}</h3>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-emerald-400 underline underline-offset-2">
              {children}
            </a>
          ),
          code: ({ className, children }) => {
            const isBlock = Boolean(className);
            if (isBlock) {
              return (
                <code className="block overflow-x-auto rounded-md border border-zinc-800 bg-zinc-900 p-3 font-mono text-xs text-zinc-200">
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[0.8em] text-emerald-300">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="mb-2">{children}</pre>,
          table: ({ children }) => (
            <div className="mb-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-zinc-800 bg-zinc-900 px-2 py-1 text-left">{children}</th>,
          td: ({ children }) => <td className="border border-zinc-800 px-2 py-1">{children}</td>,
          blockquote: ({ children }) => (
            <blockquote className="mb-2 border-l-2 border-zinc-700 pl-3 text-zinc-400">{children}</blockquote>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
