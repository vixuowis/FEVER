import React from 'react';
import { useFeverStore } from '../store';
import { motion } from 'framer-motion';
import { Activity, Clock, AlertTriangle, ExternalLink, Search } from 'lucide-react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';

export default function Timeline() {
  const { events, activeMarket, language } = useFeverStore();
  const navigate = useNavigate();
  
  const filteredEvents = events.filter(e => 
    activeMarket === 'Global' || e.market === activeMarket || e.market === 'Global'
  ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div className="h-full w-full glass-panel flex flex-col relative overflow-hidden bg-obsidian-950">
      <div className="p-5 border-b border-obsidian-600/50 flex justify-between items-center bg-obsidian-900/50">
        <h2 className="text-sm uppercase tracking-[0.2em] text-gray-400 flex items-start gap-3">
          <Activity className="w-4 h-4 text-fever-500 mt-0.5" />
          <div className="flex flex-col gap-1">
            <span>事件时间线与日志</span>
            <span className="text-[9px] opacity-60">EVENT TIMELINE & LOGS</span>
          </div>
        </h2>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        <div className="relative border-l border-obsidian-600/50 ml-4 space-y-6">
          {filteredEvents.map((evt, idx) => (
            <motion.div 
              key={evt.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="relative pl-8"
            >
              <div className={clsx(
                "absolute -left-2 top-1 w-4 h-4 rounded-full border-2 bg-obsidian-950 shadow-[0_0_10px_rgba(0,0,0,0.5)]",
                evt.feverLevel > 80 ? "border-fever-500 shadow-fever-500/50" : "border-gray-500"
              )} />
              
              <div className="glass-panel p-4 hover:bg-obsidian-800/50 transition-colors">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-mono text-gray-500">
                    {new Date(evt.timestamp).toLocaleString()}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 border border-obsidian-600 text-gray-300 uppercase">
                    {evt.market}
                  </span>
                  <span className={clsx(
                    "text-[10px] px-2 py-0.5 border font-bold uppercase",
                    evt.feverLevel > 80 ? "bg-fever-900/30 text-fever-500 border-fever-700/50" : "bg-gray-800 text-gray-300 border-gray-600"
                  )}>
                    {language === 'zh' ? '热度' : 'FEVER'} {evt.feverLevel}
                  </span>
                  {evt.sourceUrl ? (
                    <a 
                        href={evt.sourceUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-gray-500 hover:text-fever-400 transition-colors ml-auto"
                        title={language === 'zh' ? '查看来源' : 'View Source'}
                      >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  ) : (
                      <a 
                        href={`https://www.google.com/search?q=${encodeURIComponent(evt.title + ' finance news')}`} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-gray-500 hover:text-fever-400 transition-colors ml-auto"
                        title={language === 'zh' ? '搜索来源' : 'Search Source'}
                      >
                      <Search className="w-4 h-4" />
                    </a>
                  )}
                </div>
                
                <button
                  onClick={() => navigate(`/event/${evt.id}`)}
                  className="text-left text-lg font-bold text-gray-200 mb-2 flex items-center gap-2 hover:text-fever-400 transition-colors"
                >
                  {evt.feverLevel > 80 && <AlertTriangle className="w-4 h-4 text-fever-500" />}
                  {evt.title}
                </button>
                
                <p className="text-sm text-gray-400 mb-3">{evt.description}</p>
                
                {evt.impactAssets && evt.impactAssets.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {evt.impactAssets.map(asset => (
                      <span key={asset} className="text-[10px] px-2 py-1 bg-obsidian-900 text-gray-300 border border-obsidian-700 rounded-sm">
                        {asset}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
          
          {filteredEvents.length === 0 && (
            <div className="text-gray-500 italic pl-8">
              <span className="mr-2">未找到该市场的历史事件。</span>
              <span className="opacity-60 text-xs">No historical events found for this market.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
