import { useState, useEffect } from 'react';
import { ChevronsUp } from 'lucide-react';

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="ページトップへ戻る"
      className="fixed bottom-36 right-4 z-40 w-14 h-[60px] bg-amber-500 hover:bg-amber-400 active:scale-95 text-white rounded-xl shadow-lg flex flex-col items-center justify-center gap-0.5 transition-all duration-150"
    >
      <ChevronsUp className="w-6 h-6" />
      <span className="text-[10px] font-bold tracking-widest">TOP</span>
    </button>
  );
}
