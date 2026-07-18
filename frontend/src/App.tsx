import { useEffect } from "react";
import Sidebar from "./components/Sidebar";
import ChatPanel from "./components/ChatPanel";
import RightPanel from "./components/RightPanel";
import { useStore } from "./store";

export default function App() {
  const init = useStore((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-paper font-sans text-ink antialiased">
      <Sidebar />
      <ChatPanel />
      <RightPanel />
    </div>
  );
}
