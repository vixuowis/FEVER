import type { TablePayload } from "../types";

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    return Number.isInteger(v) ? v.toLocaleString("zh-CN") : String(Number(v.toFixed(4)));
  }
  return String(v);
}

function isNumCol(rows: unknown[][], idx: number): boolean {
  let nums = 0;
  let total = 0;
  for (const r of rows.slice(0, 20)) {
    const v = r[idx];
    if (v === null || v === undefined || v === "") continue;
    total++;
    if (typeof v === "number") nums++;
  }
  return total > 0 && nums / total >= 0.6;
}

/** 数据表：斑马纹 + 横向滚动 + 数值右对齐（design.md §9 table） */
export default function DataTable({ payload }: { payload: TablePayload }) {
  const { columns = [], rows = [], note } = payload;
  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-edge">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-[#F4F2EE]">
              {columns.map((c, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap border-b border-edge px-3 py-2.5 text-left font-semibold text-ink"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className={ri % 2 === 1 ? "bg-[#FAF9F7]" : "bg-card"}>
                {columns.map((_, ci) => (
                  <td
                    key={ci}
                    className={
                      "whitespace-nowrap border-b border-edge/50 px-3 py-2 text-mute" +
                      (isNumCol(rows, ci) ? " text-right font-mono text-[12px]" : "")
                    }
                  >
                    {cellText(r[ci])}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={Math.max(columns.length, 1)} className="px-3 py-6 text-center text-faint">
                  暂无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {note && <p className="mt-2 text-[11.5px] leading-relaxed text-faint">{note}</p>}
    </div>
  );
}
