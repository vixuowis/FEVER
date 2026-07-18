import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import FlowChart, { isFlowChartText } from "./FlowChart";

/** 统一 markdown 渲染（react-markdown + remark-gfm），暖纸排版 */
export default function Markdown({ text, compact }: { text: string; compact?: boolean }) {
  return (
    <div className={compact ? "md md-compact" : "md"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="font-serif text-xl font-semibold text-ink mt-5 mb-2.5 first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="font-serif text-lg font-semibold text-ink mt-5 mb-2 first:mt-0 flex items-center gap-2">
              <span className="inline-block h-3.5 w-[3px] rounded-full bg-brand/70" />
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="font-serif text-[15px] font-semibold text-ink mt-4 mb-1.5 first:mt-0">{children}</h3>
          ),
          p: ({ children }) => <p className="my-2 leading-[1.85] text-[14px] text-ink first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 space-y-1 pl-5 list-disc marker:text-brand/60">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 space-y-1 pl-5 list-decimal marker:text-brand/70">{children}</ol>,
          li: ({ children }) => <li className="leading-[1.8] text-[14px] text-ink">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
          em: ({ children }) => <em className="text-mute">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="my-2.5 border-l-[3px] border-brand/40 bg-brand-soft/50 rounded-r-lg px-3.5 py-2 text-mute [&_p]:text-mute">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-edge" />,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-jade underline decoration-jade/40 underline-offset-2 hover:decoration-jade transition-colors"
            >
              {children}
            </a>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = /language-/.test(className ?? "");
            const raw = typeof children === "string" ? children : String(children ?? "");
            // inline code 命中"逻辑线"模式（多行 + ≥2 个 ↓）→ 渲染为流程图
            if (!isBlock && isFlowChartText(raw)) {
              return <FlowChart text={raw} />;
            }
            if (isBlock) {
              return (
                <code className="block my-2.5 rounded-lg bg-[#F4F2EE] border border-edge px-3.5 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink overflow-x-auto whitespace-pre">
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded-[5px] bg-[#F4F2EE] border border-edge px-1.5 py-0.5 font-mono text-[12.5px] text-brand"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="my-0">{children}</pre>,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-edge">
              <table className="w-full border-collapse text-[13px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-[#F4F2EE]">{children}</thead>,
          th: ({ children }) => (
            <th className="px-3 py-2 text-left font-semibold text-ink border-b border-edge whitespace-nowrap">{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-mute border-b border-edge/60 align-top">{children}</td>
          ),
          // 防止 LLM 误用 ~~text~~ 把数字/数据画成删除线；按纯文本渲染
          del: ({ children }) => <span className="text-ink">{children}</span>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
