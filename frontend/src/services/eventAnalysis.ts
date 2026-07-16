import { askLLM } from './llm';
import type { Event } from '../store';
import {
  getCounterSignals,
  getEventType,
  getFreshness,
  getHeatShift,
  getMovementRead,
  getResearchSummary,
  getRelativeTimeLabel,
  getSignalQuality,
  getTransmissionSteps,
  getWatchPoints,
} from '../lib/eventIntel';

export type AnalysisTone = 'high' | 'medium' | 'low';

export interface AnalysisMetric {
  label: string;
  value: string;
}

export interface AnalysisFactorCard {
  title: string;
  direction: string;
  tone: AnalysisTone;
  metrics: AnalysisMetric[];
  progressLabel: string;
  progressValue: number;
  detail: string;
}

export interface AnalysisAttributionRow {
  factor: string;
  direction: string;
  contribution: string;
  evidence: string;
  note: string;
}

export interface AnalysisTransmissionRow {
  event: string;
  mechanism: string;
  chainPosition: string;
  impact: string;
  verify: string;
}

export interface AnalysisImpactItem {
  label: string;
  detail: string;
  tone: AnalysisTone;
}

export interface AnalysisEvidenceItem {
  type: string;
  status: string;
  summary: string;
  boundary: string;
}

export interface ProcessedEventAnalysis {
  heroSummary: string;
  evidenceBoundary: string;
  conclusionGrade: string;
  sourceSummary: string;
  similarEventsSummary: string;
  researchFit: string[];
  factorCards: AnalysisFactorCard[];
  attributionRows: AnalysisAttributionRow[];
  transmissionRows: AnalysisTransmissionRow[];
  impactMatrix: AnalysisImpactItem[];
  evidenceLedger: AnalysisEvidenceItem[];
  watchPoints: string[];
  counterSignals: string[];
}

export interface ProcessedEventResponse {
  analysis: ProcessedEventAnalysis;
  source: 'cache' | 'generated' | 'fallback';
  processedAt?: string;
}

const inflightAnalyses = new Map<string, Promise<ProcessedEventResponse>>();

function normalizeTone(value: unknown, fallback: AnalysisTone = 'medium'): AnalysisTone {
  return value === 'high' || value === 'medium' || value === 'low' ? value : fallback;
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeStringArray(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.map((item) => normalizeString(item)).filter(Boolean) : fallback;
}

function normalizeFactorCards(value: unknown, fallback: AnalysisFactorCard[]): AnalysisFactorCard[] {
  if (!Array.isArray(value)) return fallback;
  const cards = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      return {
        title: normalizeString(obj.title),
        direction: normalizeString(obj.direction),
        tone: normalizeTone(obj.tone),
        metrics: Array.isArray(obj.metrics)
          ? obj.metrics
              .map((metric) => {
                if (!metric || typeof metric !== 'object') return null;
                const metricObj = metric as Record<string, unknown>;
                return {
                  label: normalizeString(metricObj.label),
                  value: normalizeString(metricObj.value),
                };
              })
              .filter((metric): metric is AnalysisMetric => Boolean(metric?.label || metric?.value))
          : [],
        progressLabel: normalizeString(obj.progressLabel),
        progressValue: typeof obj.progressValue === 'number' ? obj.progressValue : 50,
        detail: normalizeString(obj.detail),
      };
    })
    .filter((card): card is AnalysisFactorCard => Boolean(card?.title));
  return cards.length > 0 ? cards : fallback;
}

function normalizeAttributionRows(value: unknown, fallback: AnalysisAttributionRow[]): AnalysisAttributionRow[] {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      return {
        factor: normalizeString(obj.factor),
        direction: normalizeString(obj.direction),
        contribution: normalizeString(obj.contribution),
        evidence: normalizeString(obj.evidence),
        note: normalizeString(obj.note),
      };
    })
    .filter((row): row is AnalysisAttributionRow => Boolean(row?.factor));
  return rows.length > 0 ? rows : fallback;
}

function normalizeTransmissionRows(value: unknown, fallback: AnalysisTransmissionRow[]): AnalysisTransmissionRow[] {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      return {
        event: normalizeString(obj.event),
        mechanism: normalizeString(obj.mechanism),
        chainPosition: normalizeString(obj.chainPosition),
        impact: normalizeString(obj.impact),
        verify: normalizeString(obj.verify),
      };
    })
    .filter((row): row is AnalysisTransmissionRow => Boolean(row?.event));
  return rows.length > 0 ? rows : fallback;
}

function normalizeImpactMatrix(value: unknown, fallback: AnalysisImpactItem[]): AnalysisImpactItem[] {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      return {
        label: normalizeString(obj.label),
        detail: normalizeString(obj.detail),
        tone: normalizeTone(obj.tone),
      };
    })
    .filter((row): row is AnalysisImpactItem => Boolean(row?.label));
  return rows.length > 0 ? rows : fallback;
}

function normalizeEvidenceLedger(value: unknown, fallback: AnalysisEvidenceItem[]): AnalysisEvidenceItem[] {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      return {
        type: normalizeString(obj.type),
        status: normalizeString(obj.status),
        summary: normalizeString(obj.summary),
        boundary: normalizeString(obj.boundary),
      };
    })
    .filter((row): row is AnalysisEvidenceItem => Boolean(row?.type));
  return rows.length > 0 ? rows : fallback;
}

export function buildEventAnalysisFingerprint(event: Event, targetAssets: string[]): string {
  const targetKey = [...targetAssets].sort().join('|');
  const raw = [
    'v1',
    event.id,
    event.title,
    event.timestamp,
    event.market,
    event.impactAssets.join('|'),
    targetKey,
  ].join('::');
  return btoa(unescape(encodeURIComponent(raw))).replace(/=+$/g, '');
}

export function buildFallbackProcessedEventAnalysis(event: Event, targetAssets: string[]): ProcessedEventAnalysis {
  const freshness = getFreshness(event);
  const signal = getSignalQuality(event);
  const heatShift = getHeatShift(event);
  const eventType = getEventType(event);
  const watchPoints = getWatchPoints(event);
  const researchSummary = getResearchSummary(event, targetAssets);
  const transmissionSteps = getTransmissionSteps(event);
  const counterSignals = getCounterSignals(event);
  const targetMatches = event.impactAssets.filter((asset) => targetAssets.includes(asset));
  const primaryAssets = event.impactAssets.slice(0, 3);
  const sourceLabel = event.sourceUrl ? '原始公开来源' : '免费事件流来源';

  return {
    heroSummary: researchSummary[0] || `${eventType.label}层面出现新催化，但当前仍处于待进一步验证的阶段。`,
    evidenceBoundary: event.sourceUrl
      ? '已有源头复核入口，但仍需更多客观变量确认。'
      : '当前只有来源类型与事件快照，不能把推演写成已证实事实。',
    conclusionGrade: event.sourceUrl ? '中等，可复核' : '弱到中，仅快照',
    sourceSummary: `${sourceLabel}；时间窗口 ${getRelativeTimeLabel(event.timestamp)}。`,
    similarEventsSummary:
      '当前没有真正的 backtest 样本，仅能基于同市场与同主题近似事件做参考，历史统计暂不下结论。',
    researchFit: researchSummary,
    factorCards: [
      {
        title: '事件强度',
        direction: signal.label,
        tone: signal.tone,
        metrics: [
          { label: '当前热度', value: `${event.feverLevel.toFixed(0)}°` },
          { label: '相对基线', value: `${heatShift >= 0 ? '+' : ''}${heatShift.toFixed(1)}°` },
        ],
        progressLabel: freshness.label,
        progressValue: Math.min(100, Math.max(20, event.feverLevel)),
        detail: `${signal.detail}；${freshness.detail}。`,
      },
      {
        title: '资产暴露',
        direction: primaryAssets.length > 0 ? `${primaryAssets.length} 项` : '待补充',
        tone: targetMatches.length > 0 ? 'high' : 'medium',
        metrics: [
          { label: '首要资产', value: primaryAssets[0] || '待验证' },
          { label: '命中标的', value: targetMatches.length > 0 ? targetMatches.join(' / ') : '无直接命中' },
        ],
        progressLabel: targetMatches.length > 0 ? '研究相关性高' : '环境信号',
        progressValue: targetMatches.length > 0 ? 80 : 45,
        detail:
          targetMatches.length > 0
            ? '当前事件已经直接命中研究标的，可优先进入图谱推演。'
            : '当前更适合作为环境变化或板块风向信号跟踪。',
      },
      {
        title: '源头复核',
        direction: event.sourceUrl ? '可复核' : '待补链路',
        tone: event.sourceUrl ? 'medium' : 'low',
        metrics: [
          { label: '来源类型', value: sourceLabel },
          { label: '时间窗口', value: getRelativeTimeLabel(event.timestamp) },
        ],
        progressLabel: event.sourceUrl ? '原文入口已保留' : '仅有来源类型',
        progressValue: event.sourceUrl ? 72 : 32,
        detail: event.sourceUrl
          ? '当前已保留可跳转源头，适合继续做原文复核。'
          : '当前仅有免费数据快照，不能伪造原文链接，需要后续补充一手来源。',
      },
    ],
    attributionRows: [
      {
        factor: '事件方向',
        direction: eventType.label,
        contribution: signal.tone === 'high' ? '+18' : signal.tone === 'medium' ? '+10' : '+4',
        evidence: event.title,
        note: '先确定事件属于宏观、政策、行业、个股还是资金，再决定后续解释路径。',
      },
      {
        factor: '客观偏移',
        direction: heatShift >= 0 ? '正向偏移' : '回落/中性',
        contribution:
          heatShift >= 0
            ? `+${Math.max(4, Math.round(Math.abs(heatShift) * 3))}`
            : `-${Math.max(2, Math.round(Math.abs(heatShift) * 2))}`,
        evidence: `${event.feverLevel.toFixed(0)}° / ${heatShift >= 0 ? '+' : ''}${heatShift.toFixed(1)}°`,
        note: '只把热度视为盘面强弱线索，不直接等同于基本面已经改变。',
      },
      {
        factor: '资产暴露',
        direction: primaryAssets.length > 0 ? '已识别' : '待验证',
        contribution: primaryAssets.length > 1 ? '+10' : '+5',
        evidence: primaryAssets.join(' / ') || '待验证',
        note: '用受影响资产界定第一轮传导对象，不凭常识扩写公司池。',
      },
      {
        factor: '源头可信度',
        direction: event.sourceUrl ? '中等' : '待验证',
        contribution: event.sourceUrl ? '+8' : '+2',
        evidence: event.sourceUrl ? '保留 source_url' : '仅来源类型',
        note: '有真实 source_url 时可继续做源头复核；没有则明确写证据边界。',
      },
    ],
    transmissionRows: [
      {
        event: event.title,
        mechanism: transmissionSteps[0]?.detail || '待验证',
        chainPosition: event.market,
        impact:
          eventType.key === 'policy'
            ? '先影响政策预期与风险偏好'
            : eventType.key === 'company'
              ? '先影响直接关联公司与可比标的'
              : '先影响核心资产定价锚',
        verify: watchPoints[0] || '待验证',
      },
      {
        event: '第二轮扩散',
        mechanism: transmissionSteps[1]?.detail || '待验证',
        chainPosition: primaryAssets.join(' / ') || '相关资产',
        impact: targetMatches.length > 0 ? '研究标的受影响概率更高' : '更像主题或风格扩散',
        verify: watchPoints[1] || '待验证',
      },
      {
        event: '证据确认',
        mechanism: '需要更高可信度来源、后续事件或价格行为做确认',
        chainPosition: '验证变量',
        impact: counterSignals[0] || '待验证',
        verify: watchPoints[2] || '待验证',
      },
    ],
    impactMatrix: [
      {
        label: '直接受影响',
        detail: primaryAssets.length > 0 ? primaryAssets.join(' / ') : '待验证',
        tone: 'high',
      },
      {
        label: '潜在扩散',
        detail:
          eventType.key === 'company'
            ? '同主题公司、可比标的、上下游供应链'
            : eventType.key === 'policy'
              ? '受政策阈值影响的板块与链路环节'
              : `${event.market} 市场风险偏好与相关风格资产`,
        tone: 'medium',
      },
      {
        label: '当前承压/反向',
        detail: counterSignals[1] || '待验证',
        tone: 'low',
      },
    ],
    evidenceLedger: [
      {
        type: sourceLabel,
        status: '支持',
        summary: event.description,
        boundary: event.sourceUrl ? '可跳转原始链接复核。' : '当前只有免费事件流快照，缺少原文链接。',
      },
      {
        type: '市场热度',
        status: heatShift >= 0 ? '支持' : '中性',
        summary: `当前热度 ${event.feverLevel.toFixed(0)}°，相对基线 ${heatShift >= 0 ? '+' : ''}${heatShift.toFixed(1)}°。`,
        boundary: '这是盘面强弱线索，不等于基本面已经确认。',
      },
      {
        type: '反方证据',
        status: '待验证',
        summary: counterSignals[0] || '尚未出现明确反方证据。',
        boundary: '若后续缺少二次催化或更高可信度来源，当前判断需要降级。',
      },
    ],
    watchPoints,
    counterSignals,
  };
}

function sanitizeAnalysis(
  value: unknown,
  fallback: ProcessedEventAnalysis,
): ProcessedEventAnalysis {
  if (!value || typeof value !== 'object') return fallback;
  const obj = value as Record<string, unknown>;
  return {
    heroSummary: normalizeString(obj.heroSummary, fallback.heroSummary),
    evidenceBoundary: normalizeString(obj.evidenceBoundary, fallback.evidenceBoundary),
    conclusionGrade: normalizeString(obj.conclusionGrade, fallback.conclusionGrade),
    sourceSummary: normalizeString(obj.sourceSummary, fallback.sourceSummary),
    similarEventsSummary: normalizeString(obj.similarEventsSummary, fallback.similarEventsSummary),
    researchFit: normalizeStringArray(obj.researchFit, fallback.researchFit),
    factorCards: normalizeFactorCards(obj.factorCards, fallback.factorCards),
    attributionRows: normalizeAttributionRows(obj.attributionRows, fallback.attributionRows),
    transmissionRows: normalizeTransmissionRows(obj.transmissionRows, fallback.transmissionRows),
    impactMatrix: normalizeImpactMatrix(obj.impactMatrix, fallback.impactMatrix),
    evidenceLedger: normalizeEvidenceLedger(obj.evidenceLedger, fallback.evidenceLedger),
    watchPoints: normalizeStringArray(obj.watchPoints, fallback.watchPoints),
    counterSignals: normalizeStringArray(obj.counterSignals, fallback.counterSignals),
  };
}

async function fetchCachedAnalysis(eventId: string, fingerprint: string) {
  const res = await fetch(`/api/live/event-analyses/${encodeURIComponent(eventId)}?fingerprint=${encodeURIComponent(fingerprint)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`读取事件缓存失败: HTTP ${res.status}`);
  }
  return res.json();
}

async function saveAnalysis(eventId: string, payload: {
  fingerprint: string;
  event: Event;
  analysis: ProcessedEventAnalysis;
}) {
  const res = await fetch(`/api/live/event-analyses/${encodeURIComponent(eventId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fingerprint: payload.fingerprint,
      event: payload.event,
      analysis: payload.analysis,
      processed_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    throw new Error(`保存事件处理结果失败: HTTP ${res.status}`);
  }
  return res.json();
}

async function generateProcessedEventAnalysisWithLLM(event: Event, targetAssets: string[], fallback: ProcessedEventAnalysis) {
  const eventType = getEventType(event);
  const sys = `你是 FEVER 的事件研究引擎。你的任务是在事件详情页首次打开时，对单个事件做一次结构化深度处理。必须返回严格 JSON，不要输出 markdown，不要输出解释文字，不要给投资建议。所有文本值必须使用中文。`;
  const prompt = `请基于以下事件信息生成结构化分析，用于详情页缓存。分析要克制、证据边界明确，不能把短窗口事件写成已证实的基本面结论。

事件信息：
- 事件标题：${event.title}
- 事件描述：${event.description}
- 市场：${event.market}
- 影响资产：${event.impactAssets.join(' / ') || '暂无'}
- 当前热度：${event.feverLevel}
- 时间：${event.timestamp}
- 来源链接：${event.sourceUrl || '无'}
- 事件类型初判：${eventType.label}
- 用户关注标的：${targetAssets.join(' / ') || '无'}

要求：
1. 只在已有信息范围内做结构化推演，所有不确定部分要写成“待验证”或边界说明。
2. 如果没有真实 sourceUrl，不要假装有原文。
3. 因子卡只输出 3 张，字段必须齐全。
4. 归因表输出 4 行以内，contribution 形如 +12 或 -6。
5. 传导表输出 3 行，强调“事件 -> 机制 -> 位置 -> 受益/承压 -> 验证变量”。
6. 受益/承压矩阵输出 3 项。
7. 证据链至少 3 项，必须包含支持、边界或反方线索。
8. 输出 watchPoints 3 条、counterSignals 3 条。

返回 JSON，字段必须严格匹配：
{
  "heroSummary": "一句话结论",
  "evidenceBoundary": "结论边界",
  "conclusionGrade": "例如：中等，可复核",
  "sourceSummary": "来源与数据口径摘要",
  "similarEventsSummary": "历史相似事件边界说明",
  "researchFit": ["数组，最多3条"],
  "factorCards": [
    {
      "title": "标题",
      "direction": "方向",
      "tone": "high|medium|low",
      "metrics": [
        { "label": "标签", "value": "值" },
        { "label": "标签", "value": "值" }
      ],
      "progressLabel": "进度标签",
      "progressValue": 0,
      "detail": "解释"
    }
  ],
  "attributionRows": [
    {
      "factor": "因子",
      "direction": "方向",
      "contribution": "+12",
      "evidence": "证据",
      "note": "解释"
    }
  ],
  "transmissionRows": [
    {
      "event": "事件",
      "mechanism": "机制",
      "chainPosition": "位置",
      "impact": "受益/承压",
      "verify": "验证变量"
    }
  ],
  "impactMatrix": [
    {
      "label": "标签",
      "detail": "说明",
      "tone": "high|medium|low"
    }
  ],
  "evidenceLedger": [
    {
      "type": "来源类型",
      "status": "支持|中性|待验证",
      "summary": "摘要",
      "boundary": "边界"
    }
  ],
  "watchPoints": ["观察点1", "观察点2", "观察点3"],
  "counterSignals": ["反方1", "反方2", "反方3"]
}`;

  const result = await askLLM(sys, prompt, { allowQVerisFallback: false });
  return sanitizeAnalysis(result, fallback);
}

export async function loadProcessedEventAnalysis(event: Event, targetAssets: string[]): Promise<ProcessedEventResponse> {
  const fingerprint = buildEventAnalysisFingerprint(event, targetAssets);
  const fallback = buildFallbackProcessedEventAnalysis(event, targetAssets);
  const requestKey = `${event.id}::${fingerprint}`;

  const existing = inflightAnalyses.get(requestKey);
  if (existing) {
    return existing;
  }

  const task = (async (): Promise<ProcessedEventResponse> => {
    try {
      const cached = await fetchCachedAnalysis(event.id, fingerprint);
      if (cached?.analysis) {
        return {
          analysis: sanitizeAnalysis(cached.analysis, fallback),
          source: 'cache',
          processedAt: normalizeString(cached.processed_at),
        };
      }
    } catch (error) {
      console.warn('读取事件处理缓存失败，将继续重新生成：', error);
    }

    try {
      const analysis = await generateProcessedEventAnalysisWithLLM(event, targetAssets, fallback);
      try {
        await saveAnalysis(event.id, { fingerprint, event, analysis });
      } catch (saveError) {
        console.warn('保存事件处理结果失败，将继续使用内存结果：', saveError);
      }
      return {
        analysis,
        source: 'generated',
      };
    } catch (error) {
      console.warn('事件深度处理失败，回退到本地规则结果：', error);
      try {
        await saveAnalysis(event.id, { fingerprint, event, analysis: fallback });
      } catch (saveError) {
        console.warn('保存 fallback 事件处理结果失败：', saveError);
      }
      return {
        analysis: fallback,
        source: 'fallback',
      };
    }
  })();

  inflightAnalyses.set(requestKey, task);
  try {
    return await task;
  } finally {
    inflightAnalyses.delete(requestKey);
  }
}
