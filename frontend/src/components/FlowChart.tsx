import { ChevronDown } from "lucide-react";

/** 检测一段文本是否为"逻辑线"：多行 + ≥2 个 ↓ 分隔符 */
export function isFlowChartText(text: string): boolean {
  if (!text) return false;
  const arrows = text.match(/↓/g);
  if (!arrows || arrows.length < 2) return false;
  return /\n/.test(text);
}

/** 把"逻辑线"按 ↓ 行切分为节点数组；容忍前后空白与各种换行 */
function splitFlow(text: string): string[] {
  return text
    .split(/\n\s*\n?\s*↓\s*\n?/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 行内高亮：→ 用 brand 色标识，弱化视觉权重 */
function renderInline(line: string) {
  const parts = line.split(/(→)/g);
  return parts.map((p, i) =>
    p === "→" ? (
      <span key={i} className="mx-1 text-brand/80 font-medium">
        →
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

/**
 * 垂直流程图：每段一个圆角矩形节点，节点间用 ↓ 图标连接。
 * 用在 markdown inline code 块里（识别"多行 + ↓"模式）。
 */
export default function FlowChart({ text }: { text: string }) {
  const nodes = splitFlow(text);
  if (nodes.length === 0) return null;

  return (
    <div className="my-2.5 rounded-lg border border-edge bg-[#FBFAF8] p-3 animate-fadeUp">
      <div className="flex flex-col items-stretch">
        {nodes.map((line, i) => {
          const isLast = i === nodes.length - 1;
          return (
            <div key={i} className="flex flex-col items-stretch">
              {/* 节点卡片 */}
              <div className="relative flex items-start gap-2.5 rounded-md border border-edge/80 bg-card px-3 py-2 text-[12.5px] leading-[1.7] text-ink shadow-[0_1px_0_rgba(0,0,0,0.02)]">
                {/* 步骤序号圆点 */}
                <span className="mt-[3px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-semibold text-brand ring-1 ring-brand/20">
                  {i + 1}
                </span>
                {/* 正文 */}
                <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                  {renderInline(line)}
                </div>
              </div>
              {/* 节点间 ↓ 连接器 */}
              {!isLast && (
                <div className="flex items-center justify-center py-1 text-faint">
                  <div className="flex flex-col items-center">
                    <div className="h-2 w-px bg-edge" />
                    <ChevronDown size={14} className="-mt-0.5 text-brand/60" />
                    <div className="h-0.5 w-px bg-edge" />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
