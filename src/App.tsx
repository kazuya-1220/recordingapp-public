import { useState, useEffect } from 'react';
import { Mic, Radio, Settings, FileAudio, ExternalLink, RefreshCw, ArchiveRestore, LogIn, LogOut, User, PanelBottomClose, PanelBottomOpen } from 'lucide-react';
import { onAuthStateChanged, User as FirebaseUser, signOut } from 'firebase/auth';
import { auth, signInWithGoogle } from './lib/firebase';
import { Dashboard } from './components/Dashboard';
import { Recorder } from './components/Recorder';
import { LiveView } from './components/LiveView';
import { SettingsView } from './components/SettingsView';

export type ViewState = 'dashboard' | 'record' | 'live' | 'settings';

export default function App() {
  const [currentView, setCurrentView] = useState<ViewState>('dashboard');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [navCollapsed, setNavCollapsed] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSignOut = () => {
    signOut(auth);
    setCurrentView('dashboard');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-bold mb-6 shadow-xl shadow-blue-200">
          <Radio className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-2">レコーディングアプリ</h1>
        <p className="text-slate-500 mb-8 max-w-sm">
          Securely record, transcribe, and sync your voice sessions across all your devices and Kintone.
        </p>
        <button
          onClick={signInWithGoogle}
          className="flex items-center gap-3 bg-white border border-slate-200 px-6 py-3 rounded-xl shadow-sm hover:bg-slate-50 transition-all font-bold text-slate-700"
        >
          <LogIn className="w-5 h-5 text-blue-600" />
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCurrentView('dashboard')}>
            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-white font-bold">
              <Radio className="w-5 h-5" />
            </div>
            <h1 className="text-lg font-bold tracking-tight text-slate-900">レコーディングアプリ</h1>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCurrentView('settings')}
              className="p-2 text-slate-500 hover:text-slate-900 transition-colors rounded-lg hover:bg-slate-50"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button 
              onClick={handleSignOut}
              className="p-2 text-slate-500 hover:text-red-600 transition-colors rounded-lg hover:bg-slate-50"
              title="Sign Out"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className={`flex-1 ${currentView === 'live' ? 'max-w-7xl' : 'max-w-3xl'} w-full mx-auto p-4 md:p-8 overflow-y-auto`}>
        {currentView === 'dashboard' && <Dashboard onViewChange={setCurrentView} user={user} />}
        {currentView === 'record' && <Recorder onViewChange={setCurrentView} />}
        {currentView === 'live' && <LiveView onViewChange={setCurrentView} user={user} />}
        {currentView === 'settings' && <SettingsView onViewChange={setCurrentView} />}
      </main>

      {/* Bottom Navigation */}
      <nav className={`bg-white border-t border-slate-200 sticky bottom-0 transition-all duration-200 ${navCollapsed ? 'py-1' : 'p-2'}`}>
        <div className="flex justify-around items-center">
          <button
            onClick={() => setCurrentView('dashboard')}
            className={`flex flex-col items-center justify-center w-full py-2 rounded-lg transition-colors ${currentView === 'dashboard' ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <ArchiveRestore className="w-5 h-5" />
            {!navCollapsed && <span className="text-[10px] uppercase font-bold tracking-widest mt-1">Archive</span>}
          </button>

          <button
            onClick={() => setCurrentView('record')}
            className={`flex flex-col items-center justify-center w-full ${navCollapsed ? '' : '-mt-6'}`}
          >
            <div className={`${navCollapsed ? 'p-2' : 'p-4'} rounded-xl shadow-md text-white transition-all ${currentView === 'record' ? 'bg-blue-700 scale-105' : 'bg-blue-600 hover:bg-blue-700'}`}>
              <Mic className={navCollapsed ? 'w-4 h-4' : 'w-6 h-6'} />
            </div>
            {!navCollapsed && <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-1">Record</span>}
          </button>

          <button
            onClick={() => setCurrentView('live')}
            className={`flex flex-col items-center justify-center w-full py-2 rounded-lg transition-colors ${currentView === 'live' ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <Radio className="w-5 h-5" />
            {!navCollapsed && <span className="text-[10px] uppercase font-bold tracking-widest mt-1">Live Sync</span>}
          </button>

          {/* ナビ折りたたみトグル */}
          <button
            onClick={() => setNavCollapsed(!navCollapsed)}
            className="flex flex-col items-center justify-center px-3 py-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
            title={navCollapsed ? 'ナビを展開' : 'ナビを折りたたむ'}
          >
            {navCollapsed
              ? <PanelBottomOpen className="w-4 h-4" />
              : <PanelBottomClose className="w-4 h-4" />
            }
          </button>
        </div>
      </nav>
    </div>
  );
}
