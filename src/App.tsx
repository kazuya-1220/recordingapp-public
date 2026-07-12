import { useState, useEffect } from 'react';
import { Radio, RefreshCw, ArchiveRestore, Settings, AudioLines, MessageCircle, HelpCircle, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { onAuthStateChanged, signOut, User as FirebaseUser } from 'firebase/auth';
import { auth, signInWithGoogle, getRedirectResult } from './lib/firebase';
import { ThemeProvider } from './contexts/ThemeContext';
import { RecordingProvider, useRecording } from './contexts/RecordingContext';
import { Dashboard } from './components/Dashboard';
import { Recorder } from './components/Recorder';
import { LiveView } from './components/LiveView';
import { SettingsView } from './components/SettingsView';
import { VoiceprintRecorder } from './components/VoiceprintRecorder';
import { BetaFeedback } from './components/BetaFeedback';
import { ReviewDashboard } from './components/ReviewDashboard';
import { HelpPage } from './components/HelpPage';
import { OnboardingTutorial, hasCompletedOnboarding, markOnboardingDone } from './components/OnboardingTutorial';
import { FeedbackChatPopup } from './components/FeedbackChatPopup';
import { PromptSettings } from './components/PromptSettings';

export type ViewState = 'dashboard' | 'record' | 'live' | 'settings' | 'voiceprint' | 'feedback' | 'reviews' | 'help' | 'prompt-settings';

const BETA_USERS = new Set(['kazuya@tax-brain.page']);

function GoogleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function AppContent() {
  // Deep-link: opening /?record=<id> jumps straight to the history view and
  // scrolls that record card into view (used by the Kintone backlink field).
  const initialFocusId = (() => {
    try { return new URL(window.location.href).searchParams.get('record'); }
    catch { return null; }
  })();
  const getInitialView = (): ViewState => {
    if (initialFocusId) return 'dashboard';
    const hash = window.location.hash.replace('#', '') as ViewState;
    const valid: ViewState[] = ['dashboard', 'record', 'live', 'settings', 'voiceprint', 'feedback', 'reviews', 'help'];
    return valid.includes(hash) ? hash : 'record';
  };
  const [currentView, setCurrentView] = useState<ViewState>(getInitialView);
  const [focusRecordId, setFocusRecordId] = useState<string | null>(initialFocusId);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [hasUnsynced, setHasUnsynced] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [feedbackPopupOpen, setFeedbackPopupOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar_collapsed') === '1'; } catch { return false; }
  });
  const { isRecording } = useRecording();
  const isBetaUser = BETA_USERS.has(user?.email || '');

  const navigate = (view: ViewState) => {
    setCurrentView(view);
    window.history.pushState({ view }, '', '#' + view);
  };

  // Browser back/forward button support
  // Reduce the mobile browser's auto-zoom when focusing form fields, and restore
  // the normal (pinch-zoomable) scale once the field loses focus. iOS Safari zooms
  // in on focus; pinning maximum-scale=1 while a field is focused prevents that jump
  // and, because the page never zoomed in, it stays at its original scale on blur.
  useEffect(() => {
    const vp = document.querySelector('meta[name="viewport"]');
    if (!vp) return;
    const BASE = 'width=device-width, initial-scale=1.0';
    const LOCKED = 'width=device-width, initial-scale=1.0, maximum-scale=1.0';
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement && !!el.closest('input, textarea, select');
    const onFocusIn = (e: FocusEvent) => { if (isField(e.target)) vp.setAttribute('content', LOCKED); };
    const onFocusOut = (e: FocusEvent) => { if (isField(e.target)) vp.setAttribute('content', BASE); };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      vp.setAttribute('content', BASE);
    };
  }, []);

  useEffect(() => {
    window.history.replaceState({ view: currentView }, '', '#' + currentView);
    const handle = (e: PopStateEvent) => {
      const v = (e.state?.view || window.location.hash.replace('#', '') || 'record') as ViewState;
      const valid: ViewState[] = ['dashboard', 'record', 'live', 'settings', 'voiceprint', 'feedback', 'reviews', 'help'];
      if (valid.includes(v)) setCurrentView(v);
    };
    window.addEventListener('popstate', handle);
    return () => window.removeEventListener('popstate', handle);
  }, []);

  // Clear the ?record= param out of the URL once we've consumed it so a refresh
  // doesn't keep re-focusing (and doesn't leave the noisy param behind).
  useEffect(() => {
    if (!initialFocusId) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('record');
    window.history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
    // Keep focusRecordId in state for one Dashboard render, then null it out
    // so navigating away and back doesn't re-scroll.
    const t = window.setTimeout(() => setFocusRecordId(null), 3000);
    return () => window.clearTimeout(t);
  }, [initialFocusId]);

  useEffect(() => {
    getRedirectResult(auth).catch(() => {});
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setSigningIn(false);
      if (u && !u.email?.endsWith('@tax-brain.page')) {
        await signOut(auth);
        setLoginError('@tax-brain.page のアカウントのみ使用できます。');
        setUser(null);
      } else {
        setUser(u);
        if (u && !hasCompletedOnboarding()) setShowOnboarding(true);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    setLoginError(null);
    setSigningIn(true);
    try {
      const result = await signInWithGoogle();
      if (!result) {
        // User dismissed the popup — no error, just stop the spinner
        setSigningIn(false);
      }
      // On success, onAuthStateChanged will fire and clear signingIn
    } catch (err: any) {
      setSigningIn(false);
      console.error('Login error:', err);
      if (err.message === 'POPUP_BLOCKED') {
        setLoginError('ポップアップがブロックされています。Safariの場合は「設定 → Safari → ポップアップをブロック」をオフにするか、Chromeでお試しください。');
      } else {
        setLoginError('ログインに失敗しました。再試行してください。');
      }
    }
  };

  if (loading || signingIn) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center gap-3">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
        {signingIn && <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Googleでログイン中...</p>}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-bold mb-6 shadow-xl shadow-blue-200">
          <Radio className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight mb-2">レコーディングアプリ</h1>
        <p className="text-slate-500 dark:text-slate-400 mb-8 max-w-sm text-base leading-relaxed">
          CRMとすべてのデバイス間で、音声セッションを安全に録音・文字起こし・同期できます。
        </p>
        <button
          onClick={handleSignIn}
          className="flex items-center justify-center gap-3 bg-white border border-[#dadce0] px-6 py-3 rounded shadow-md hover:bg-[#f8fafe] active:bg-[#f1f3f4] transition-colors text-[#3c4043] font-medium text-sm min-w-[240px] select-none"
          style={{ fontFamily: "'Google Sans', Roboto, Arial, sans-serif" }}
        >
          <GoogleIcon />
          Googleでログイン
        </button>
        {loginError && (
          <p className="mt-4 text-sm text-red-500">{loginError}</p>
        )}
      </div>
    );
  }

  // All views expand to fill the window (minus the desktop sidebar); each view
  // manages its own inner max-width for narrow sub-sections.
  const containerMax = 'max-w-none';
  // LiveView gets a subtly emerald-tinted page background so it reads as distinct
  // from the Recorder while staying cohesive with the app's palette.
  const pageBg = currentView === 'live'
    ? 'bg-emerald-50/60 dark:bg-slate-900'
    : 'bg-slate-50 dark:bg-slate-900';

  // Navigation targets
  const navItems: { view: ViewState; Icon: typeof Radio; label: string; dot?: boolean; desktopOnly?: boolean }[] = [
    { view: 'record', Icon: AudioLines, label: '録音', dot: isRecording },
    { view: 'live', Icon: Radio, label: 'ライブ同期' },
    { view: 'dashboard', Icon: ArchiveRestore, label: '履歴', dot: hasUnsynced },
    { view: 'feedback', Icon: MessageCircle, label: 'フィードバック', desktopOnly: true },
    { view: 'help', Icon: HelpCircle, label: 'ヘルプ', desktopOnly: true },
    { view: 'settings', Icon: Settings, label: '設定' },
  ];

  return (
    <div className={`min-h-screen ${pageBg} font-sans text-slate-800 dark:text-slate-200 transition-colors duration-300`}>
      {/* Fixed header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 fixed top-0 left-0 right-0 z-10">
        <div className="w-full px-4 md:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('dashboard')}>
            <div className="w-7 h-7 bg-blue-600 rounded flex items-center justify-center text-white">
              <Radio className="w-4 h-4" />
            </div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">レコーディングアプリ</h1>
          </div>
          {isRecording && (
            <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/30 px-3 py-1 rounded-full border border-red-200 dark:border-red-800">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              <span className="text-xs font-bold text-red-600 dark:text-red-400">録音中</span>
            </div>
          )}
        </div>
      </header>

      {/* Scrollable content — offset for the desktop sidebar; padded for fixed header + mobile bottom nav */}
      <div className={sidebarCollapsed ? 'md:pl-14' : 'md:pl-56'}>
        <main className={`${containerMax} w-full mx-auto px-4 md:px-8 pt-16 pb-28 md:pb-12 transition-[max-width] duration-300`}>
          <div className={currentView === 'dashboard' ? '' : 'hidden'}><Dashboard onViewChange={navigate} user={user} onUnsyncedChange={setHasUnsynced} focusRecordId={focusRecordId} /></div>
          <div className={currentView === 'record' ? '' : 'hidden'}><Recorder onViewChange={navigate} user={user} isActive={currentView === 'record'} /></div>
          <div className={currentView === 'live' ? '' : 'hidden'}><LiveView onViewChange={navigate} isActive={currentView === 'live'} /></div>
          <div className={currentView === 'settings' ? '' : 'hidden'}><SettingsView onViewChange={navigate} userEmail={user.email || ''} /></div>
          {isBetaUser && <div className={currentView === 'voiceprint' ? '' : 'hidden'}><VoiceprintRecorder onViewChange={navigate} user={user} /></div>}
          <div className={currentView === 'feedback' ? '' : 'hidden'}><BetaFeedback onViewChange={navigate} userEmail={user.email || ''} userName={user.displayName || user.email || ''} isActive={currentView === 'feedback'} onPopupMode={() => { navigate('record'); setFeedbackPopupOpen(true); }} /></div>
          <div className={currentView === 'reviews' ? '' : 'hidden'}><ReviewDashboard onViewChange={navigate} isAdmin={isBetaUser} /></div>
          <div className={currentView === 'help' ? '' : 'hidden'}><HelpPage onViewChange={navigate} /></div>
          <div className={currentView === 'prompt-settings' ? '' : 'hidden'}><PromptSettings onViewChange={navigate} userEmail={user.email || ''} /></div>
        </main>
      </div>

      {/* Floating feedback button (hidden when full-page feedback is open or popup is open) */}
      {currentView !== 'feedback' && !feedbackPopupOpen && (
        <button
          onClick={() => setFeedbackPopupOpen(true)}
          title="フィードバックを送る"
          className="hidden md:flex fixed md:bottom-8 md:right-6 z-30 w-[4.5rem] h-[4.5rem] bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg items-center justify-center transition-colors active:scale-95"
        >
          <MessageCircle className="w-9 h-9" />
        </button>
      )}

      {feedbackPopupOpen && (
        <FeedbackChatPopup
          userEmail={user.email || ''}
          userName={user.displayName || user.email || ''}
          onClose={() => setFeedbackPopupOpen(false)}
          onFullScreen={() => { setFeedbackPopupOpen(false); navigate('feedback'); }}
        />
      )}

      {showOnboarding && (
        <OnboardingTutorial onComplete={() => { markOnboardingDone(); setShowOnboarding(false); }} />
      )}

      {/* Nav: bottom bar on mobile, left sidebar on desktop (録音 → ライブ同期 → 履歴 → 設定) */}
      <nav
        className={`bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 fixed z-20 bottom-0 left-0 right-0 border-t flex justify-around md:top-14 md:bottom-0 md:right-auto md:flex-col md:justify-start md:gap-1 md:border-t-0 md:border-r md:py-5 transition-all duration-200 ${sidebarCollapsed ? 'md:w-14 md:px-1' : 'md:w-56 md:px-3'}`}
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        {navItems.map(({ view, Icon, label, dot, desktopOnly }) => {
          const active = currentView === view;
          return (
            <button
              key={view}
              onClick={() => navigate(view)}
              title={sidebarCollapsed ? label : undefined}
              className={`relative flex flex-col items-center justify-center w-full py-5 rounded-lg transition-all duration-150 active:scale-95 md:py-3 ${sidebarCollapsed ? 'md:flex-col md:gap-0 md:px-1' : 'md:flex-row md:justify-start md:gap-4 md:px-4 md:py-5'} ${desktopOnly ? 'hidden md:flex' : ''} ${active ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
            >
              <Icon className={`shrink-0 ${sidebarCollapsed ? 'w-6 h-6' : 'w-6 h-6 mb-1 md:mb-0 md:w-7 md:h-7'}`} />
              <span className={`text-xs font-bold ${sidebarCollapsed ? 'hidden md:hidden' : 'md:text-base'}`}>{label}</span>
              {dot && <span className="absolute top-2 right-3 md:top-1 md:right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
            </button>
          );
        })}
        {/* Collapse toggle (desktop only) */}
        <button
          type="button"
          onClick={() => setSidebarCollapsed(v => {
            const next = !v;
            try { localStorage.setItem('sidebar_collapsed', next ? '1' : '0'); } catch {}
            return next;
          })}
          className="hidden md:flex items-center justify-center mt-auto py-3 px-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors w-full"
          title={sidebarCollapsed ? 'メニューを展開' : 'メニューを折りたたむ'}
        >
          {sidebarCollapsed
            ? <PanelLeftOpen className="w-5 h-5" />
            : <><PanelLeftClose className="w-5 h-5 mr-2" /><span className="text-sm font-bold">折りたたむ</span></>
          }
        </button>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <RecordingProvider>
        <AppContent />
      </RecordingProvider>
    </ThemeProvider>
  );
}
