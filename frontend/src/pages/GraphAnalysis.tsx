import { useCallback, useEffect, useState } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position,
  NodeProps
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useFeverStore } from '../store';
import { Zap, Activity, Cpu, RefreshCw, Loader2, ExternalLink, TrendingUp, TrendingDown, Minus, Target, X, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { predictGraphDownstream, generateDeepDiveReport } from '../services/llm';
import { clsx } from 'clsx';

// Custom Node Component
function CyberNode({ data, selected }: { data: any; selected: boolean }) {
  const isHistorical = data.status === 'historical';
  
  const renderTrendIcon = () => {
    if (!data.trend) return null;
    if (data.trend === 'bullish') return <TrendingUp className="w-3 h-3 text-green-500" />;
    if (data.trend === 'bearish') return <TrendingDown className="w-3 h-3 text-fever-500" />;
    return <Minus className="w-3 h-3 text-gray-400" />;
  };

  return (
    <div className={clsx(
      "relative px-4 py-2 rounded-lg border-2 transition-all shadow-lg backdrop-blur-sm",
      selected ? "border-fever-400 bg-fever-900/30 scale-105 shadow-fever-500/20 z-10" : 
      isHistorical ? "border-obsidian-600 bg-obsidian-900/80" : "border-gray-500 bg-gray-900/80",
      data.fever > 80 && !selected && "border-fever-700/50"
    )}>
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-none !-ml-1" />
      
      <div className="flex justify-between items-start mb-1 gap-4">
        <span className={clsx(
          "text-[8px] uppercase tracking-wider px-1",
          isHistorical ? "text-cyber-blue bg-cyber-blue/10" : "text-cyber-purple bg-cyber-purple/10"
        )}>
          {data.status}
        </span>
        <span className="text-[8px] text-gray-500 font-mono">
          {new Date(data.timestamp).toLocaleDateString()}
        </span>
      </div>
      
      <div className="font-bold text-gray-200 text-sm whitespace-nowrap">{data.label}</div>
      
      <div className="text-[10px] text-gray-400 uppercase mt-1 flex items-center justify-between">
        <span>{data.category}</span>
        {renderTrendIcon()}
      </div>

      <div className={`absolute -top-3 -right-3 bg-obsidian-900 border ${selected ? 'border-cyber-yellow text-cyber-yellow' : 'border-obsidian-600 text-gray-300'} px-1 text-[10px]`}>
        {data.fever as number}°
      </div>

      <Handle type="source" position={Position.Right} className="!bg-transparent !border-none !-mr-1" />
    </div>
  );
}

const nodeTypes = {
  cyber: CyberNode,
};

export default function GraphAnalysis() {
  const { 
    sessions, 
    activeSessionId, 
    setActiveSession, 
    selectedNodeId, 
    setSelectedNodeId, 
    addElementsToActiveSession, 
    activeMarket,
    updateNodeFever,
    targetAssets
  } = useFeverStore();

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];
  const storeNodes = activeSession?.nodes || [];
  const storeEdges = activeSession?.edges || [];

  const [isSimulating, setIsSimulating] = useState(false);
  const [simScenario, setSimScenario] = useState('normal');
  
  const [isDeepDiving, setIsDeepDiving] = useState(false);
  const [deepDiveReport, setDeepDiveReport] = useState<any>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Sync Store -> React Flow
  useEffect(() => {
    // Filter nodes by active market
    const filteredStoreNodes = storeNodes.filter(n => activeMarket === 'Global' || n.market === activeMarket || n.market === 'Global');
    const filteredNodeIds = new Set(filteredStoreNodes.map(n => n.id));
    
    // Only show edges where both source and target are in the filtered nodes
    const filteredStoreEdges = storeEdges.filter(e => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target));

    setNodes(filteredStoreNodes.map(n => ({
      id: n.id,
      type: 'cyber',
      data: { label: n.label, category: n.category, fever: n.fever, status: n.status, timestamp: n.timestamp, trend: n.trend },
      position: n.position || { x: Math.random() * 500, y: Math.random() * 500 },
      selected: n.id === selectedNodeId
    })));

    setEdges(filteredStoreEdges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.relation,
      animated: true,
      style: { stroke: e.probability > 0.8 ? '#ff4d4d' : '#00f0ff', strokeWidth: 2 },
      labelStyle: { fill: '#fff', fontSize: 10, fontFamily: 'monospace' },
      labelBgStyle: { fill: '#0a0a0a', stroke: '#333' },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: e.probability > 0.8 ? '#ff4d4d' : '#00f0ff',
      },
    })));
  }, [storeNodes, storeEdges, selectedNodeId, activeMarket, setNodes, setEdges]);

  const onNodeClick = useCallback((_: any, node: any) => {
    setSelectedNodeId(node.id);
  }, [setSelectedNodeId]);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  const handleSimulate = async () => {
    if (!selectedNodeId || isSimulating) return;
    setIsSimulating(true);
    
    const sourceNode = nodes.find(n => n.id === selectedNodeId);
    if (!sourceNode) {
      setIsSimulating(false);
      return;
    }

    try {
      const ts = Date.now();
      const futureTs = new Date(ts + 86400000).toISOString(); // +1 day
      const mkt = sourceNode.data.market || activeMarket;

      // LLM Prediction
      const result = await predictGraphDownstream(sourceNode.data, simScenario, mkt, targetAssets);
      
      const totalNodes = result.newNodes.length;
      const ySpacing = 250; // Increased vertical spacing
      const startY = sourceNode.position.y - ((totalNodes - 1) * ySpacing) / 2;

      const newNodes = result.newNodes.map((n: any, i: number) => ({
        id: `n-pred-${ts}-${i}`,
        label: n.label,
        category: n.category,
        fever: n.fever,
        position: { x: sourceNode.position.x + 500, y: startY + i * ySpacing }, // Increased X/Y distance
        status: 'predicted',
        timestamp: futureTs,
        market: n.market || mkt,
        reasoning: n.reasoning,
        trend: n.trend
      }));

      const newEdges = result.newEdges.map((e: any, i: number) => ({
        id: `e-pred-${ts}-${i}`,
        source: sourceNode.id,
        target: newNodes[i].id,
        relation: e.relation,
        probability: e.probability
      }));

      addElementsToActiveSession(newNodes, newEdges);
      
      // Update parent fever visually
      updateNodeFever(sourceNode.id, Math.min(100, sourceNode.data.fever + 5));
    } catch (err) {
      console.error("LLM Graph Prediction Failed:", err);
      alert('AI 推演失败。请检查控制台。 / AI Prediction Failed. Check console.');
    } finally {
      setIsSimulating(false);
    }
  };

  const handleDeepDive = async () => {
    if (!selectedNodeId || isDeepDiving) return;
    const sourceNode = nodes.find(n => n.id === selectedNodeId);
    if (!sourceNode) return;

    setIsDeepDiving(true);
    try {
      const report = await generateDeepDiveReport(sourceNode.data);
      setDeepDiveReport({ nodeLabel: sourceNode.data.label, ...report });
    } catch (err) {
      console.error("Deep Dive Failed:", err);
      alert('生成深度研报失败。 / Failed to generate Deep Dive Report.');
    } finally {
      setIsDeepDiving(false);
    }
  };

  const selectedNodeData = storeNodes.find(n => n.id === selectedNodeId);

  return (
    <div className="h-full flex flex-col gap-4 relative">
      {/* Session Tabs */}
      <div className="flex gap-2 w-full overflow-x-auto pb-2 custom-scrollbar px-1">
        {sessions.map(s => (
          <button 
            key={s.id} 
            onClick={() => setActiveSession(s.id)}
            className={clsx(
              "px-4 py-2 text-xs font-bold border transition-all whitespace-nowrap",
              activeSessionId === s.id 
                ? "border-fever-500 bg-fever-900/30 text-fever-400 shadow-[0_0_10px_rgba(255,0,0,0.2)]" 
                : "border-obsidian-600 bg-obsidian-900/80 text-gray-400 hover:border-obsidian-500"
            )}
          >
            {s.title && s.title.length > 25 ? s.title.substring(0, 25) + '...' : s.title}
          </button>
        ))}
      </div>

      <div className="flex justify-between items-center glass-panel px-5 py-3">
        <div>
          <h2 className="text-xl font-bold text-gray-200 tracking-wider flex flex-col gap-1">
            <span>事件图谱</span>
            <span className="text-xs opacity-60">EVENT GRAPH</span>
          </h2>
          <p className="text-xs text-gray-500 uppercase tracking-widest flex flex-col gap-1 mt-2">
            <span>信号传播网络</span>
            <span className="text-[9px] opacity-60">SIGNAL PROPAGATION NETWORK</span>
          </p>
        </div>
        <div className="flex gap-4 items-center flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-obsidian-900 border-2 border-obsidian-600" />
            <span className="text-xs text-gray-400">已发生事件</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-gray-900 border-2 border-gray-500" />
            <span className="text-xs text-gray-400">推演节点</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-fever-900/30 border-2 border-fever-400" />
            <span className="text-xs text-gray-400">高亮选中</span>
          </div>
          <div className="flex items-center gap-2 ml-2">
            <div className="w-3 h-1 bg-fever-500" />
            <span className="text-[10px] text-gray-400 uppercase flex items-baseline gap-1">高概率 <span className="text-[8px] opacity-60">HIGH PROBABILITY</span></span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-1 bg-cyber-blue" />
            <span className="text-[10px] text-gray-400 uppercase flex items-baseline gap-1">标准流动 <span className="text-[8px] opacity-60">STANDARD FLOW</span></span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        <div className="flex-1 glass-panel relative overflow-hidden border border-obsidian-600/50">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            className="bg-obsidian-900/50"
          >
            <Background color="#333" gap={16} size={1} />
            <Controls className="!bg-obsidian-800 !border-obsidian-600 !fill-gray-300" />
            <MiniMap 
              nodeColor={(n) => (n.data?.fever as number) > 80 ? '#ff4d4d' : '#00f0ff'} 
              maskColor="rgba(0,0,0,0.8)"
              className="!bg-obsidian-900 !border-obsidian-600"
            />
          </ReactFlow>
        </div>

        {/* Side Panel for Node-based Simulation */}
        {selectedNodeId && selectedNodeData && (
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            className="w-80 glass-panel border border-obsidian-600/50 flex flex-col z-10"
          >
            <div className="p-4 border-b border-obsidian-600/50 bg-obsidian-900/50 shrink-0">
              <h3 className="text-sm uppercase tracking-widest text-gray-400 mb-2 flex flex-col gap-1">
                <span>选定节点</span>
                <span className="text-[9px] opacity-60">SELECTED NODE</span>
              </h3>
              <div className="flex justify-between items-start">
                <div className="text-xl font-bold text-cyber-blue text-glow flex-1 pr-2">{selectedNodeData.label}</div>
                {selectedNodeData.sourceUrl ? (
                  <a 
                    href={selectedNodeData.sourceUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-gray-500 hover:text-cyber-blue transition-colors shrink-0 mt-1"
                    title="查看来源 / View Source"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                ) : (
                  <a 
                    href={`https://www.google.com/search?q=${encodeURIComponent(selectedNodeData.label + ' finance news')}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-gray-500 hover:text-cyber-yellow transition-colors shrink-0 mt-1"
                    title="搜索来源 / Search Source"
                  >
                    <Search className="w-4 h-4" />
                  </a>
                )}
              </div>
              <div className="flex gap-2 mt-2">
                <span className="text-[10px] px-2 py-0.5 bg-obsidian-700 text-gray-300 border border-obsidian-600 uppercase">{selectedNodeData.category}</span>
                <span className={`text-[10px] px-2 py-0.5 border uppercase flex items-center gap-1 ${selectedNodeData.fever > 80 ? 'bg-fever-900/30 text-fever-500 border-fever-700/50' : 'bg-obsidian-700 text-gray-300 border-obsidian-600'}`}>
                  热度 <span className="opacity-70">FEVER:</span> {selectedNodeData.fever}°
                </span>
                {selectedNodeData.trend && (
                  <span className={clsx(
                    "text-[10px] px-2 py-0.5 border uppercase flex items-center gap-1",
                    selectedNodeData.trend === 'bullish' ? "bg-green-900/30 text-green-500 border-green-700/50" :
                    selectedNodeData.trend === 'bearish' ? "bg-fever-900/30 text-fever-500 border-fever-700/50" :
                    "bg-gray-800 text-gray-400 border-gray-600"
                  )}>
                    {selectedNodeData.trend === 'bullish' ? <TrendingUp className="w-3 h-3" /> :
                     selectedNodeData.trend === 'bearish' ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                    {selectedNodeData.trend}
                  </span>
                )}
              </div>
              {selectedNodeData.reasoning && (
                <div className="mt-4 p-3 bg-obsidian-800/80 border border-obsidian-600/50 text-xs text-gray-300 italic">
                  <div className="text-cyber-purple font-bold uppercase mb-1 flex items-center gap-1">
                    <Zap className="w-3 h-3" /> 大模型推理 <span className="text-[9px] opacity-70">LLM REASONING</span>
                  </div>
                  "{selectedNodeData.reasoning}"
                </div>
              )}
            </div>

            <div className="p-4 flex-1 overflow-y-auto custom-scrollbar">
                {/* Deep Dive Action */}
              <button 
                onClick={handleDeepDive}
                disabled={isDeepDiving}
                className="w-full mb-6 bg-cyber-blue/10 border border-cyber-blue text-cyber-blue py-3 font-bold uppercase tracking-widest hover:bg-cyber-blue/20 hover:shadow-[0_0_15px_rgba(0,240,255,0.4)] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isDeepDiving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Target className="w-5 h-5" />}
                {isDeepDiving ? (
                  <span className="flex items-baseline gap-1">分析中... <span className="text-[9px] opacity-70">ANALYZING</span></span>
                ) : (
                  <span className="flex items-baseline gap-1">AI 深度研报 <span className="text-[9px] opacity-70">AI DEEP DIVE</span></span>
                )}
              </button>

              <h4 className="text-xs uppercase tracking-widest text-gray-500 mb-4 flex items-start gap-2">
                <Activity className="w-4 h-4 mt-0.5" /> 
                <div className="flex flex-col gap-1">
                  <span>情景推演</span>
                  <span className="text-[9px] opacity-60">SIMULATION SCENARIOS</span>
                </div>
              </h4>
              
              <div className="space-y-3 mb-6">
                <label className={`block p-3 border cursor-pointer transition-all ${simScenario === 'optimistic' ? 'border-green-500 bg-green-900/10' : 'border-obsidian-600 bg-obsidian-900/50 hover:border-obsidian-500'}`}>
                  <input type="radio" name="scenario" value="optimistic" checked={simScenario === 'optimistic'} onChange={(e) => setSimScenario(e.target.value)} className="hidden" />
                  <div className="text-sm font-bold text-gray-200">乐观情景 <span className="text-[10px] text-gray-500 ml-1">OPTIMISTIC</span></div>
                  <div className="text-xs text-gray-500 mt-1">假设市场能迅速消化冲击，政策干预有效，资产价格呈现修复或上行趋势。</div>
                </label>
                <label className={`block p-3 border cursor-pointer transition-all ${simScenario === 'normal' ? 'border-cyber-blue bg-cyber-blue/10' : 'border-obsidian-600 bg-obsidian-900/50 hover:border-obsidian-500'}`}>
                  <input type="radio" name="scenario" value="normal" checked={simScenario === 'normal'} onChange={(e) => setSimScenario(e.target.value)} className="hidden" />
                  <div className="text-sm font-bold text-gray-200">正常情景 <span className="text-[10px] text-gray-500 ml-1">NORMAL</span></div>
                  <div className="text-xs text-gray-500 mt-1">基于历史均值和当前基本面进行基准推演，反映最可能发生的市场常态波动。</div>
                </label>
                <label className={`block p-3 border cursor-pointer transition-all ${simScenario === 'pessimistic' ? 'border-fever-500 bg-fever-900/10' : 'border-obsidian-600 bg-obsidian-900/50 hover:border-obsidian-500'}`}>
                  <input type="radio" name="scenario" value="pessimistic" checked={simScenario === 'pessimistic'} onChange={(e) => setSimScenario(e.target.value)} className="hidden" />
                  <div className="text-sm font-bold text-gray-200">悲观情景 <span className="text-[10px] text-gray-500 ml-1">PESSIMISTIC</span></div>
                  <div className="text-xs text-gray-500 mt-1">模拟尾部风险爆发，流动性枯竭和恐慌情绪蔓延导致的资产大幅下挫。</div>
                </label>
              </div>

              <button
                onClick={handleSimulate}
                disabled={isSimulating}
                className="w-full relative group overflow-hidden bg-obsidian-800 border border-cyber-blue text-cyber-blue px-4 py-3 uppercase tracking-widest text-sm hover:bg-cyber-blue/10 transition-all disabled:opacity-50"
              >
                <div className="absolute inset-0 w-0 bg-cyber-blue/20 transition-all duration-300 ease-out group-hover:w-full" />
                <span className="relative flex items-center justify-center gap-2">
                  {isSimulating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />}
                  {isSimulating ? (
                    <span className="flex items-baseline gap-1">计算中... <span className="text-[9px] opacity-70">COMPUTING</span></span>
                  ) : (
                    <span className="flex items-baseline gap-1">运行节点推演 <span className="text-[9px] opacity-70">RUN ANALYSIS</span></span>
                  )}
                </span>
              </button>
            </div>
          </motion.div>
        )}
      </div>

      {/* Deep Dive Modal */}
      <AnimatePresence>
        {deepDiveReport && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] flex items-center justify-center bg-obsidian-950/80 backdrop-blur-sm p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-2xl bg-obsidian-900 border border-cyber-blue shadow-[0_0_30px_rgba(0,240,255,0.2)] flex flex-col max-h-full"
            >
              <div className="p-4 border-b border-obsidian-600 flex justify-between items-start bg-obsidian-950">
                <h2 className="text-lg font-bold text-cyber-blue uppercase tracking-widest flex items-start gap-2">
                  <Target className="w-5 h-5 mt-0.5" />
                  <div className="flex flex-col gap-1">
                    <span>AI 深度研报</span>
                    <span className="text-[10px] opacity-60">DEEP DIVE REPORT</span>
                  </div>
                </h2>
                <button onClick={() => setDeepDiveReport(null)} className="text-gray-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto custom-scrollbar flex flex-col gap-6">
                <div>
                  <h3 className="text-xs uppercase text-gray-500 tracking-widest mb-1 flex flex-col gap-1">
                    <span>目标节点</span>
                    <span className="text-[8px] opacity-60">TARGET NODE</span>
                  </h3>
                  <div className="text-xl font-bold text-white mt-2">{deepDiveReport.nodeLabel}</div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-1 p-4 bg-obsidian-950 border border-obsidian-700">
                    <h3 className="text-xs uppercase text-gray-500 tracking-widest mb-2 flex flex-col gap-1">
                      <span>市场情绪</span>
                      <span className="text-[8px] opacity-60">MARKET SENTIMENT</span>
                    </h3>
                    <div className={clsx(
                      "text-lg font-bold uppercase mt-3",
                      deepDiveReport.marketSentiment === 'Bullish' || deepDiveReport.marketSentiment === '看涨' ? "text-green-500" :
                      deepDiveReport.marketSentiment === 'Bearish' || deepDiveReport.marketSentiment === '看跌' || deepDiveReport.marketSentiment === 'Panic' || deepDiveReport.marketSentiment === '恐慌' ? "text-fever-500" : "text-cyber-yellow"
                    )}>{deepDiveReport.marketSentiment}</div>
                  </div>
                  <div className="flex-1 p-4 bg-obsidian-950 border border-obsidian-700">
                    <h3 className="text-xs uppercase text-gray-500 tracking-widest mb-2 flex flex-col gap-1">
                      <span>系统性风险</span>
                      <span className="text-[8px] opacity-60">SYSTEMIC RISK</span>
                    </h3>
                    <div className={clsx(
                      "text-lg font-bold uppercase mt-3",
                      deepDiveReport.systemicRiskLevel === 'Critical' || deepDiveReport.systemicRiskLevel === '危急' || deepDiveReport.systemicRiskLevel === 'High' || deepDiveReport.systemicRiskLevel === '高' ? "text-fever-500" : "text-cyber-yellow"
                    )}>{deepDiveReport.systemicRiskLevel}</div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs uppercase text-gray-500 tracking-widest mb-2 flex flex-col gap-1">
                    <span>执行摘要</span>
                    <span className="text-[8px] opacity-60">EXECUTIVE SUMMARY</span>
                  </h3>
                  <p className="text-sm text-gray-300 leading-relaxed border-l-2 border-cyber-blue pl-4 mt-3">
                    {deepDiveReport.summary}
                  </p>
                </div>

                <div>
                  <h3 className="text-xs uppercase text-gray-500 tracking-widest mb-2 flex flex-col gap-1">
                    <span>关键驱动因素</span>
                    <span className="text-[8px] opacity-60">KEY DRIVERS</span>
                  </h3>
                  <ul className="list-disc pl-5 text-sm text-gray-300 space-y-1 mt-3">
                    {deepDiveReport.keyDrivers?.map((driver: string, i: number) => (
                      <li key={i}>{driver}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="text-xs uppercase text-gray-500 tracking-widest mb-2 flex flex-col gap-1">
                    <span>资产影响</span>
                    <span className="text-[8px] opacity-60">ASSET IMPLICATIONS</span>
                  </h3>
                  <div className="space-y-2">
                    {deepDiveReport.assetImplications?.map((asset: any, i: number) => (
                      <div key={i} className="p-3 bg-obsidian-950 border border-obsidian-700 flex flex-col gap-1">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-cyber-yellow">{asset.asset}</span>
                          <span className={clsx(
                            "text-[10px] px-2 py-0.5 uppercase border",
                            asset.impact === 'Positive' || asset.impact === '正面' ? "text-green-500 border-green-500/50 bg-green-500/10" :
                            asset.impact === 'Negative' || asset.impact === '负面' ? "text-fever-500 border-fever-500/50 bg-fever-500/10" :
                            "text-gray-400 border-gray-600 bg-gray-800"
                          )}>{asset.impact}</span>
                        </div>
                        <span className="text-xs text-gray-400 mt-1">{asset.rationale}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}