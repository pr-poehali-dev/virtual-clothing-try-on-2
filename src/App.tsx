import { useState } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Icon from '@/components/ui/icon';
import TryOn from '@/pages/TryOn';
import History from '@/pages/History';
import Settings from '@/pages/Settings';
import Profile from '@/pages/Profile';

type Tab = 'tryon' | 'history' | 'settings' | 'profile';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'tryon', label: 'Примерка', icon: 'Shirt' },
  { key: 'history', label: 'История', icon: 'Clock' },
  { key: 'settings', label: 'Настройки', icon: 'Settings' },
  { key: 'profile', label: 'Профиль', icon: 'User' },
];

function AppContent() {
  const [tab, setTab] = useState<Tab>('tryon');

  const renderPage = () => {
    switch (tab) {
      case 'tryon': return <TryOn />;
      case 'history': return <History />;
      case 'settings': return <Settings />;
      case 'profile': return <Profile />;
    }
  };

  return (
    <div style={{ background: '#080b14', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>

      {/* Фоновые блобы */}
      <div className="fixed pointer-events-none" style={{ inset: 0, zIndex: 0 }}>
        <div className="absolute"
          style={{
            top: '-20%', left: '-10%',
            width: '500px', height: '500px',
            background: 'radial-gradient(ellipse, rgba(168,85,247,0.12) 0%, transparent 70%)',
          }} />
        <div className="absolute"
          style={{
            bottom: '-20%', right: '-10%',
            width: '400px', height: '400px',
            background: 'radial-gradient(ellipse, rgba(6,182,212,0.1) 0%, transparent 70%)',
          }} />
        <div className="absolute"
          style={{
            top: '40%', right: '20%',
            width: '200px', height: '200px',
            background: 'radial-gradient(ellipse, rgba(249,115,22,0.06) 0%, transparent 70%)',
          }} />
      </div>

      {/* Контейнер приложения */}
      <div className="relative z-10 flex flex-col"
        style={{
          width: '100%',
          maxWidth: '390px',
          height: '100vh',
          maxHeight: '844px',
        }}>

        {/* Контент страницы */}
        <div className="flex-1 overflow-hidden relative" key={tab}>
          <div className="absolute inset-0 overflow-y-auto no-scrollbar animate-fade-in-up">
            {renderPage()}
          </div>
        </div>

        {/* Нижняя навигация */}
        <div className="flex-shrink-0 px-3 pt-2 relative z-20"
          style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
          <div className="glass-strong rounded-3xl py-2 flex items-center"
            style={{ boxShadow: '0 -4px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)' }}>
            {TABS.map(t => {
              const isActive = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className="flex-1 flex flex-col items-center gap-0.5 py-1 rounded-2xl transition-all duration-300"
                  style={isActive ? { background: 'rgba(168,85,247,0.15)' } : {}}>

                  <div className="w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-300"
                    style={{
                      background: isActive ? 'linear-gradient(135deg, rgba(168,85,247,0.4), rgba(6,182,212,0.4))' : 'transparent',
                      transform: isActive ? 'scale(1.1)' : 'scale(1)',
                    }}>
                    <Icon
                      name={t.icon as 'Shirt' | 'Clock' | 'Settings' | 'User'}
                      size={18}
                      style={{ color: isActive ? '#c084fc' : 'rgba(255,255,255,0.3)' }}
                    />
                  </div>

                  <span className="text-xs font-montserrat font-600 transition-all duration-300 leading-tight"
                    style={{ color: isActive ? '#c084fc' : 'rgba(255,255,255,0.25)' }}>
                    {t.label}
                  </span>

                  <div style={{
                    width: '4px', height: '4px', borderRadius: '50%',
                    background: '#a855f7',
                    opacity: isActive ? 1 : 0,
                    transform: isActive ? 'scale(1)' : 'scale(0)',
                    transition: 'all 0.3s',
                  }} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <Toaster />
    </div>
  );
}

export default function App() {
  return (
    <TooltipProvider>
      <AppContent />
    </TooltipProvider>
  );
}