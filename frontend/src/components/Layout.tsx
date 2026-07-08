import { Outlet, Link, useLocation } from 'react-router-dom';
import { Activity, GitMerge, Cpu, Terminal, Globe2, Power, PowerOff, Clock } from 'lucide-react';
import { useFeverStore } from '../store';
import { clsx } from 'clsx';
import { useLiveMarket } from '../hooks/useLiveMarket';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ConsoleLog from './ConsoleLog';

const MARKETS = ['Global', 'US', 'EU', 'Asia'] as const;

export default function Layout() {
  const location = useLocation();
  const { globalFever, activeMarket, setActiveMarket, isLive, toggleLive, events, isInitializing, initializeSystem } = useFeverStore();
  
  // Initialize system
  useEffect(() => {
    if (isInitializing) {
      initializeSystem();
    }
  }, [isInitializing, initializeSystem]);
  
  // Initialize background live market engine
  useLiveMarket();

  // Toast Notification state
  const [toast, setToast] = useState<{ id: string, title: string, fever: number, market: string } | null>(null);

  // Watch for new high-fever events
  useEffect(() => {
    if (events.length > 0) {
      const latest = events[0];
      if (latest.feverLevel > 85 && latest.id.startsWith('evt-live-')) {
        setToast({ id: latest.id, title: latest.title, fever: latest.feverLevel, market: latest.market });
        const timer = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(timer);
      }
    }
  }, [events]);

  const navItems = [
    { path: '/', label: '信号总览', subLabel: 'SIGNAL SCAN', icon: Activity },
    { path: '/graph', label: '事件图谱', subLabel: 'EVENT GRAPH', icon: GitMerge },
    { path: '/simulation', label: '仿真推演', subLabel: 'SIMULATION', icon: Cpu },
    { path: '/timeline', label: '时间线', subLabel: 'TIMELINE', icon: Clock },
  ];

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-obsidian-950 flex flex-col items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-cyber-grid opacity-10" />
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 flex flex-col items-center"
        >
          <Terminal className="w-16 h-16 text-fever-500 animate-pulse mb-6" />
          <h1 className="text-4xl font-bold text-fever-500 tracking-[0.3em] mb-2">FEVER</h1>
          <p className="text-xs text-fever-400 uppercase tracking-widest mb-8 flex flex-col items-center gap-1">
            <span>Fin Event Research</span>
          </p>
          
          <div className="w-64 h-1 bg-obsidian-900 overflow-hidden rounded-full border border-fever-500/30">
            <motion.div
              className="h-full bg-fever-500"
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          </div>
          <p className="text-[10px] text-gray-500 mt-4 font-mono animate-pulse flex flex-col items-center gap-1">
            <span>同步全球市场数据...</span>
            <span className="opacity-60 text-[9px]">SYNCING GLOBAL MARKET DATA...</span>
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#050505] text-gray-300 font-sans">
      {/* Top Navigation */}
      <header className="sticky top-0 h-16 border-b border-gray-800 bg-[#050505]/90 backdrop-blur-md flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-8 h-8 bg-gray-900 rounded-md flex items-center justify-center border border-gray-800 group-hover:border-fever-900 transition-colors">
              <Activity className="w-5 h-5 text-fever-500" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-base font-semibold text-gray-100 tracking-wide">FEVER</h1>
              <span className="text-[10px] text-fever-500/70 -mt-1 tracking-widest uppercase">Fin Event Research</span>
            </div>
          </Link>
          
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={clsx(
                    'px-4 py-2 rounded-md text-sm font-medium transition-colors',
                    isActive 
                      ? 'bg-gray-800 text-gray-100' 
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-900'
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
            <Link
              to="/evidence"
              className={clsx(
                'px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2',
                location.pathname === '/evidence'
                  ? 'bg-blue-900/30 text-blue-400 border border-blue-800/50'
                  : 'text-gray-400 hover:text-blue-400 hover:bg-gray-900 border border-transparent'
              )}
            >
              <GitMerge className="w-4 h-4" />
              Evidence Graph
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={clsx("w-2 h-2 rounded-full", isLive ? "bg-green-500" : "bg-gray-600")} />
            <span className="text-xs font-medium text-gray-400">{isLive ? 'Live Data' : 'Paused'}</span>
          </div>
          <button 
            onClick={toggleLive}
            className="p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-md transition-colors"
          >
            {isLive ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main Content Area (Central Reading Flow) */}
      <main className="flex-1 w-full max-w-[960px] mx-auto px-6 py-8">
        <Outlet />

        {/* Toast Notification */}
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              className="fixed bottom-6 right-6 z-50 bg-gray-900 border border-gray-700 p-4 shadow-2xl rounded-lg w-80"
            >
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] text-gray-400 uppercase tracking-widest flex items-center gap-1 font-semibold">
                  <Activity className="w-3 h-3" /> High Signal
                </span>
              </div>
              <h4 className="text-sm font-semibold text-gray-100 mb-1">{toast.title}</h4>
              <p className="text-xs text-gray-500">
                Market: {toast.market}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <ConsoleLog />
    </div>
  );
}
