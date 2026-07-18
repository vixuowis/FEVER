import { useEffect, useRef, useState } from "react";
import {
  CandlestickChart,
  Landmark,
  LineChart,
  Newspaper,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import type { Mode } from "../types";
import Composer from "./Composer";
import MessageItem from "./MessageItem";

type Suggestion = {
  text: string;
  mode: Mode;
  /** 字符串 hint，渲染时再用 ICON_BY_HINT 查 icon（避免 React element 被 JSON.stringify 损坏） */
  icon_hint: "newspaper" | "sparkles" | "trending" | "landmark" | "candlestick" | "users";
  desc: string;
  query?: string;
};

// 兜底建议：API 失败时用这组
const FALLBACK_SUGGESTIONS: Suggestion[] = [
  {
    text: "分析贵州茅台近一个月的事件与股价表现",
    mode: "auto",
    icon_hint: "candlestick",
    desc: "新闻 + K线 + 事件研究",
  },
  {
    text: "最近有什么值得关注的财经事件？",
    mode: "auto",
    icon_hint: "newspaper",
    desc: "全局快讯筛选高影响事件",
  },
  {
    text: "对宁德时代做深度研究",
    mode: "team",
    icon_hint: "users",
    desc: "研究团队多专家并行",
  },
  {
    text: "央行国债收益率最近怎么走？",
    mode: "auto",
    icon_hint: "landmark",
    desc: "宏观指标曲线",
  },
];

const ICON_BY_HINT: Record<string, React.ReactNode> = {
  newspaper: <Newspaper size={16} />,
  sparkles: <Sparkles size={16} />,
  trending: <TrendingUp size={16} />,
  landmark: <Landmark size={16} />,
  candlestick: <CandlestickChart size={16} />,
  users: <Users size={16} />,
};

const CHIPS = ["日K行情", "财经快讯", "公告检索", "财务摘要", "事件研究 CAR", "宏观指标", "龙虎榜", "融资融券", "研报评级"];

/** 热门 A 股池：每次点击 chip 时随机抽一只，让示例 prompt 不刻板 */
const STOCK_POOL: { code: string; name: string }[] = [
  { code: "600519", name: "贵州茅台" },
  { code: "000858", name: "五粮液" },
  { code: "300750", name: "宁德时代" },
  { code: "600036", name: "招商银行" },
  { code: "002594", name: "比亚迪" },
  { code: "601318", name: "中国平安" },
  { code: "000333", name: "美的集团" },
  { code: "600276", name: "恒瑞医药" },
  { code: "601012", name: "隆基绿能" },
  { code: "688981", name: "中芯国际" },
  { code: "601899", name: "紫金矿业" },
  { code: "600030", name: "中信证券" },
  { code: "000651", name: "格力电器" },
  { code: "002475", name: "立讯精密" },
  { code: "601138", name: "工业富联" },
];
const pickStock = () => STOCK_POOL[Math.floor(Math.random() * STOCK_POOL.length)];

/** chip 标签 → 每次点击返回一个具体 prompt 字符串（标的随机抽，宏观类无标的） */
const CHIP_PROMPTS: Record<string, () => string> = {
  "日K行情": () => { const s = pickStock(); return `用日K行情分析 ${s.code}（${s.name}）的近期走势`; },
  "财经快讯": () => "看下最近的重要财经快讯",
  "公告检索": () => { const s = pickStock(); return `检索 ${s.code}（${s.name}）的最新公告`; },
  "财务摘要": () => { const s = pickStock(); return `查一下 ${s.code}（${s.name}）的财务摘要`; },
  "事件研究 CAR": () => { const s = pickStock(); return `对 ${s.code}（${s.name}）做一次事件研究 CAR 分析`; },
  "宏观指标": () => "看下最新宏观指标（CPI / PMI / M2）",
  "龙虎榜": () => "看下最新龙虎榜",
  "融资融券": () => { const s = pickStock(); return `查 ${s.code}（${s.name}）的融资融券数据`; },
  "研报评级": () => { const s = pickStock(); return `查 ${s.code}（${s.name}）的最新研报评级`; },
};

const HOT_CACHE_KEY = "fever.hot_topics.v1";
const HOT_TTL_MS = 10 * 60 * 1000; // 10 分钟

function isValidSuggestion(x: unknown): x is Suggestion {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  // 老结构（icon 是 React element）一律视为脏数据，避免历史 localStorage 把页面渲染挂掉
  if ("icon" in o && o.icon !== undefined) return false;
  // 必须有 icon_hint 字符串
  return typeof o.icon_hint === "string" && typeof o.text === "string";
}

function loadCachedTopics(): { items: Suggestion[]; ts: number } | null {
  try {
    const raw = localStorage.getItem(HOT_CACHE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { items?: unknown[]; ts?: number };
    if (!j?.ts || Date.now() - j.ts > HOT_TTL_MS) return null;
    const items = Array.isArray(j.items) ? j.items.filter(isValidSuggestion) : [];
    if (items.length === 0) {
      // 全是脏数据 → 直接清掉，避免再次触发
      try { localStorage.removeItem(HOT_CACHE_KEY); } catch { /* ignore */ }
      return null;
    }
    return { items: items as Suggestion[], ts: j.ts };
  } catch {
    return null;
  }
}

function saveCachedTopics(items: Suggestion[]) {
  try {
    localStorage.setItem(HOT_CACHE_KEY, JSON.stringify({ items, ts: Date.now() }));
  } catch {
    /* ignore quota errors */
  }
}

/** 空态 hero */
function Hero() {
  const sendMessage = useStore((s) => s.sendMessage);
  const setMode = useStore((s) => s.setMode);
  const streaming = useStore((s) => s.streaming);
  const setPromptSeed = useStore((s) => s.setPromptSeed);

  // 初始建议：优先 localStorage 缓存；空时用兜底
  const [suggestions, setSuggestions] = useState<Suggestion[]>(() => {
    const cached = loadCachedTopics();
    if (cached?.items?.length) return cached.items;
    return FALLBACK_SUGGESTIONS;
  });
  const [refreshing, setRefreshing] = useState(false);

  // 首次挂载：拉一次新鲜数据
  useEffect(() => {
    let aborted = false;
    api
      .hotTopics(false)
      .then((r) => {
        if (aborted) return;
        if (r?.items?.length) {
          const mapped: Suggestion[] = r.items.map((it) => ({
            text: it.title,
            desc: it.desc,
            mode: it.mode,
            icon_hint: it.icon_hint,
            query: it.query,
          }));
          setSuggestions(mapped);
          saveCachedTopics(mapped);
        }
      })
      .catch(() => {
        /* 静默兜底 */
      });
    return () => {
      aborted = true;
    };
  }, []);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const r = await api.hotTopics(true);
      if (r?.items?.length) {
        const mapped: Suggestion[] = r.items.map((it) => ({
          text: it.title,
          desc: it.desc,
          mode: it.mode,
          icon_hint: it.icon_hint,
          query: it.query,
        }));
        setSuggestions(mapped);
        saveCachedTopics(mapped);
      }
    } catch {
      /* 静默 */
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-2xl animate-fadeUp">
        <div className="flex items-center gap-2 text-[11.5px] font-medium tracking-widest text-jade">
          <Sparkles size={13} />
          FIN EVENT RESEARCH WORKBENCH
        </div>
        <h2 className="mt-3 font-serif text-[34px] font-bold leading-tight text-ink">
          Hunt events. <span className="text-brand">Trace echoes.</span>
        </h2>
        <p className="mt-3 max-w-xl text-[13.5px] leading-[1.9] text-mute">
          对话式 AI 金融事件分析工作台：提问即研究。主理人 Agent 调用 akshare 真实数据技能，
          流式输出结论，并把 K 线、曲线、数据表、证据与研究报告沉淀为可回看的产出物。
          深度问题可切换「研究团队」模式，多专家并行作业、复核员把关。
        </p>

        {/* 建议问题 */}
        <div className="mt-7 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {suggestions.map((s, i) => (
            <button
              key={`${s.text}-${i}`}
              disabled={streaming}
              onClick={() => {
                setMode(s.mode);
                void sendMessage(s.query ?? s.text, s.mode);
              }}
              className="group flex items-start gap-3 rounded-card border border-edge bg-card px-4 py-3.5 text-left shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-pop disabled:opacity-50"
            >
              <span className="flex shrink-0 flex-col items-center gap-1">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-brand transition-colors group-hover:bg-brand group-hover:text-card">
                  {ICON_BY_HINT[s.icon_hint] ?? <Newspaper size={16} />}
                </span>
                {s.mode === "team" && (
                  <span className="rounded bg-jade-soft px-1.5 py-px text-[10px] font-semibold text-jade">团队</span>
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium leading-snug text-ink">{s.text}</span>
                <span className="mt-1 block text-[11.5px] text-faint">{s.desc}</span>
              </span>
            </button>
          ))}
        </div>

        {/* 换一批：放在建议问题下方居中 */}
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing || streaming}
            className="flex items-center gap-1 rounded-full border border-edge bg-card px-2.5 py-1 text-[11px] text-mute transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-50"
            title="根据当前热点事件刷新推荐"
          >
            <RefreshIcon spinning={refreshing} />
            换一批
          </button>
        </div>

        {/* 能力 chips */}
        <div className="mt-6 flex flex-wrap items-center gap-1.5">
          <LineChart size={13} className="text-faint" />
          {CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              title="点击填入示例 prompt 到输入框"
              onClick={() => setPromptSeed((CHIP_PROMPTS[c] ?? (() => c))())}
              className="rounded-full border border-edge bg-card px-2.5 py-1 text-[11.5px] text-mute transition-all hover:border-jade/40 hover:bg-jade-soft hover:text-jade active:scale-95"
            >
              {c}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? "animate-spin" : ""}
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

/** 加载历史时的骨架屏 */
function Skeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-6 py-8">
      {[0.55, 0.8, 0.4].map((w, i) => (
        <div key={i} className={i % 2 === 0 ? "flex justify-end" : "flex"}>
          <div
            className="h-16 rounded-card border border-edge bg-gradient-to-r from-[#F1EFEB] via-[#FAF9F7] to-[#F1EFEB] bg-[length:400px_100%] animate-shimmer"
            style={{ width: `${w * 100}%` }}
          />
        </div>
      ))}
    </div>
  );
}

export default function ChatPanel() {
  const messages = useStore((s) => s.messages);
  const loadingCase = useStore((s) => s.loadingCase);
  const currentCaseId = useStore((s) => s.currentCaseId);
  const streaming = useStore((s) => s.streaming);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // 流式期间自动吸底（用户上翻则暂停吸底）
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  useEffect(() => {
    stickRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [currentCaseId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const empty = messages.length === 0 && !loadingCase;

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-paper">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <Hero />
        ) : loadingCase ? (
          <Skeleton />
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-7">
            {messages.map((m) => (
              <MessageItem key={m.id} message={m} />
            ))}
            <div className="h-2" />
          </div>
        )}
      </div>
      <Composer />
    </section>
  );
}
