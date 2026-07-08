import { useState } from 'react';
import { useFeverStore } from '../store';
import { Sliders, RefreshCw, Cpu, Activity } from 'lucide-react';
import { motion } from 'framer-motion';

export default function Simulation() {
  const { events, globalFever, updateGlobalFever, activeMarket, language } = useFeverStore();
  const [running, setRunning] = useState(false);
  const [params, setParams] = useState({
    volatility: 50,
    liquidity: 30,
    sentiment: 20
  });

  const filteredEvents = events.filter(e => activeMarket === 'Global' || e.market === activeMarket || e.market === 'Global');

  const runSimulation = () => {
    setRunning(true);
    let iter = 0;
    const interval = setInterval(() => {
      iter++;
      const fluctuation = (Math.random() - 0.5) * (params.volatility / 10);
      const newFever = Math.min(100, Math.max(0, globalFever + fluctuation));
      updateGlobalFever(newFever);
      
      if (iter > 20) {
        clearInterval(interval);
        setRunning(false);
      }
    }, 100);
  };

  return (
    <div className="h-full flex flex-col gap-6">
      <div className="glass-panel px-6 py-4 border-b-2 border-cyber-purple/50">
        <h2 className="text-sm uppercase tracking-[0.2em] text-gray-400 flex items-start gap-3">
          <Cpu className="w-4 h-4 text-fever-500 mt-0.5" />
          <div className="flex flex-col gap-1">
            <span>突发事件仿真推演</span>
            <span className="text-[9px] opacity-60">EVENT SIMULATION ENGINE</span>
          </div>
        </h2>
        <p className="text-xs text-gray-500 uppercase tracking-widest mt-2 flex flex-col gap-1 ml-8">
          <span>随机压力测试</span>
          <span className="text-[9px] opacity-60">STOCHASTIC STRESS TESTING</span>
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 flex-1">
        {/* Controls */}
        <div className="w-full lg:w-1/3 glass-panel p-6 flex flex-col gap-8">
          <div className="flex items-start gap-3 text-sm text-cyber-blue uppercase tracking-widest border-b border-obsidian-600/50 pb-2">
            <Sliders className="w-4 h-4 mt-0.5" />
            <div className="flex flex-col gap-1">
              <span>环境参数</span>
              <span className="text-[9px] opacity-60">ENVIRONMENT PARAMS</span>
            </div>
          </div>

          <div className="space-y-6">
            {Object.entries(params).map(([key, value]) => {
              const displayKey = key === 'volatility' ? '波动率' : key === 'liquidity' ? '流动性' : '情绪';
              return (
                <div key={key}>
                  <div className="flex justify-between mb-2">
                    <span className="text-xs uppercase text-gray-400 flex flex-col gap-1">{displayKey} <span className="text-[8px] opacity-60">{key}</span></span>
                    <span className="text-xs font-mono text-gray-200 mt-auto">{value}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" max="100" 
                    value={value}
                    onChange={(e) => setParams(p => ({ ...p, [key]: Number(e.target.value) }))}
                    className="w-full h-1 bg-obsidian-700 rounded-none appearance-none cursor-pointer accent-cyber-blue"
                    style={{
                      background: `linear-gradient(to right, #00f0ff ${value}%, #1a1a1a ${value}%)`
                    }}
                  />
                </div>
              );
            })}
          </div>

          <button
                onClick={runSimulation}
                disabled={running}
                className="mt-auto relative group overflow-hidden bg-obsidian-800 border border-fever-600 text-fever-500 px-4 py-3 uppercase tracking-widest text-sm hover:bg-fever-500/10 transition-all disabled:opacity-50"
              >
                <div className="absolute inset-0 w-0 bg-fever-600/20 transition-all duration-300 ease-out group-hover:w-full" />
                <span className="relative flex items-center justify-center gap-2">
                  <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} />
                  {running ? (
                    <span className="flex items-baseline gap-1">计算中... <span className="text-[9px] opacity-70">COMPUTING</span></span>
                  ) : (
                    <span className="flex items-baseline gap-1">运行仿真 <span className="text-[9px] opacity-70">RUN SIMULATION</span></span>
                  )}
                </span>
              </button>
        </div>

        {/* Output */}
        <div className="flex-1 flex flex-col gap-6">
          <div className="glass-panel flex-1 p-6 relative overflow-hidden flex flex-col items-center justify-center">
            {running && (
              <div className="absolute inset-0 bg-obsidian-900/50 backdrop-blur-[2px] z-10 flex items-center justify-center">
                <div className="text-fever-500 animate-pulse flex flex-col items-center gap-4">
                  <Activity className="w-12 h-12" />
                  <span className="text-xs uppercase tracking-[0.3em] flex flex-col items-center gap-1">
                    <span>处理向量空间...</span>
                    <span className="text-[9px] opacity-60">PROCESSING VECTOR SPACE</span>
                  </span>
                </div>
              </div>
            )}
            
            <div className="w-64 h-64 rounded-full border border-obsidian-600 relative flex items-center justify-center">
              <motion.div 
                className="absolute inset-0 rounded-full border-2 border-t-fever-500 border-r-transparent border-b-fever-700 border-l-transparent"
                animate={{ rotate: 360 }}
                transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
              />
              <div className="text-center">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 flex flex-col items-center gap-1">
                  <span>预测热度</span>
                  <span className="text-[8px] opacity-60">PROJECTED FEVER</span>
                </p>
                <div className="text-5xl font-bold font-mono text-gray-200">
                  {globalFever.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          <div className="h-48 glass-panel p-6 overflow-y-auto">
             <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-4 flex items-start justify-between">
               <span className="flex flex-col gap-1">
                 <span>仿真日志</span>
                 <span className="text-[8px] opacity-60">SIMULATION LOG</span>
               </span>
               <span className="text-fever-500 flex flex-col items-end gap-1">{activeMarket} 市场 <span className="text-[8px] opacity-60">MARKET</span></span>
             </h3>
             <div className="space-y-2 font-mono text-[10px]">
                {filteredEvents.map((e, i) => (
                  <div key={i} className="flex gap-4 text-gray-500">
                    <span className="text-fever-500/70">[{new Date(e.timestamp).toLocaleTimeString()}]</span>
                    <span>分析影响 <span className="opacity-60 text-[9px]">IMPACT:</span> {e.title}</span>
                    <span className={e.feverLevel > 80 ? 'text-fever-500' : 'text-gray-400'}>
                      向量 <span className="opacity-60 text-[9px]">VECTOR</span> {e.feverLevel.toFixed(1)}
                    </span>
                  </div>
                ))}
                {running && (
                  <div className="text-fever-500 animate-pulse">
                    &gt; 计算传播概率 <span className="opacity-60 text-[9px]">CALCULATING PROB:</span> {activeMarket}...
                  </div>
                )}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
