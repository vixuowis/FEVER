import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useFeverStore } from '../store';
import { Terminal, ChevronUp, ChevronDown, Trash2, Filter } from 'lucide-react';
import { clsx } from 'clsx';

export default function ConsoleLog() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'All' | 'LLM' | 'QVeris' | 'Argus'>('All');
  
  const logs = useFeverStore(state => state.logs);
  const clearLogs = useFeverStore(state => state.clearLogs);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const filteredLogs = useMemo(() => {
    if (activeTab === 'All') return logs;
    return logs.filter(log => log.source === activeTab);
  }, [logs, activeTab]);

  useEffect(() => {
    if (isOpen && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredLogs, isOpen]);

  const tabs = ['All', 'LLM', 'QVeris', 'Argus'] as const;

  return (
    <div className={clsx(
      "fixed bottom-0 right-4 w-[450px] bg-gray-900 border border-gray-800 rounded-t-lg shadow-2xl transition-all duration-300 z-50 flex flex-col",
      isOpen ? "h-[350px]" : "h-10 cursor-pointer hover:bg-gray-800"
    )}>
      {/* Header */}
      <div 
        className="flex items-center justify-between px-3 h-10 cursor-pointer bg-gray-950 border-b border-gray-800 rounded-t-lg hover:bg-gray-900 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-fever-500" />
              <span className="text-xs font-semibold text-gray-200">System Logs</span>
            </div>
          {isOpen && (
            <div className="flex items-center gap-1 ml-2 border-l border-gray-800 pl-3" onClick={e => e.stopPropagation()}>
              {tabs.map(tab => (
                <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={clsx(
                      "px-2 py-0.5 text-[10px] rounded uppercase tracking-wider transition-colors",
                      activeTab === tab 
                        ? "bg-gray-800 text-gray-200" 
                        : "text-gray-500 hover:text-gray-300"
                    )}
                  >
                    {tab}
                  </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isOpen && (
            <button 
              onClick={(e) => { e.stopPropagation(); clearLogs(); }}
              className="p-1 hover:bg-gray-800 rounded text-gray-500 hover:text-red-400 transition-colors"
              title="Clear Logs"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          {isOpen ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronUp className="w-4 h-4 text-gray-500" />}
        </div>
      </div>

      {/* Body */}
      {isOpen && (
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-3 bg-[#0a0a0a]">
          {filteredLogs.length === 0 ? (
            <div className="text-gray-600 text-xs italic">No logs available for {activeTab}.</div>
          ) : (
            filteredLogs.map(log => (
              <div key={log.id} className="text-xs font-mono break-all leading-relaxed">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-gray-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                  <span className={clsx(
                    "px-1.5 rounded text-[10px] uppercase",
                    log.source === 'LLM' ? 'bg-blue-900/40 text-blue-400' : 
                    log.source === 'QVeris' ? 'bg-purple-900/40 text-purple-400' :
                    'bg-green-900/40 text-green-400'
                  )}>
                    {log.source}
                  </span>
                  <span className={clsx(
                    "uppercase text-[10px] font-bold tracking-widest",
                    log.type === 'error' ? 'text-red-400' :
                    log.type === 'request' ? 'text-blue-400' : 'text-green-400'
                  )}>
                    {log.type}
                  </span>
                </div>
                <div className={clsx(
                  "pl-4 border-l-2 py-1",
                  log.type === 'error' ? 'border-red-900/50 text-red-300/80' :
                  log.type === 'request' ? 'border-blue-900/50 text-blue-300/80' : 'border-green-900/50 text-green-300/80'
                )}>
                  {typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}
                </div>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      )}
    </div>
  );
}