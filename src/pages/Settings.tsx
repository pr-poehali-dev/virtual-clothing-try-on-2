import { useState } from 'react';
import Icon from '@/components/ui/icon';

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange}
      className={`toggle-track ${on ? 'on' : ''}`}
      style={{ background: on ? 'linear-gradient(135deg, #a855f7, #06b6d4)' : 'rgba(255,255,255,0.1)' }}>
      <div className="toggle-thumb" />
    </button>
  );
}

export default function Settings() {
  const [notifs, setNotifs] = useState(true);
  const [camera, setCamera] = useState(false);
  const [sound, setSound] = useState(true);
  const [analytics, setAnalytics] = useState(false);
  const [lang, setLang] = useState('ru');

  const sections = [
    {
      title: 'Разрешения',
      icon: 'Shield',
      color: '#06b6d4',
      items: [
        { label: 'Доступ к камере', desc: 'Для AR примерки', value: camera, toggle: () => setCamera(v => !v), icon: 'Camera' },
      ]
    },
    {
      title: 'Уведомления',
      icon: 'Bell',
      color: '#a855f7',
      items: [
        { label: 'Push-уведомления', desc: 'Новинки и акции', value: notifs, toggle: () => setNotifs(v => !v), icon: 'Bell' },
        { label: 'Звуки', desc: 'Звуки интерфейса', value: sound, toggle: () => setSound(v => !v), icon: 'Volume2' },
      ]
    },
    {
      title: 'Конфиденциальность',
      icon: 'Lock',
      color: '#f97316',
      items: [
        { label: 'Аналитика', desc: 'Помогает улучшить приложение', value: analytics, toggle: () => setAnalytics(v => !v), icon: 'BarChart2' },
      ]
    },
  ];

  return (
    <div className="flex flex-col h-full overflow-y-auto no-scrollbar">
      <div className="px-5 pt-6 pb-4 animate-fade-in-up">
        <h1 className="font-montserrat font-900 text-2xl text-white">
          Настрой<span className="text-gradient">ки</span>
        </h1>
        <p className="text-sm text-white/40 mt-0.5">Персонализируй приложение</p>
      </div>

      {/* Язык */}
      <div className="px-5 mb-4 animate-fade-in-up delay-100">
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: '#ec489920' }}>
              <Icon name="Globe" size={18} style={{ color: '#ec4899' }} />
            </div>
            <span className="font-600 text-white text-sm">Язык интерфейса</span>
          </div>
          <div className="flex gap-2">
            {[
              { code: 'ru', label: '🇷🇺 Русский' },
              { code: 'en', label: '🇬🇧 English' },
              { code: 'tr', label: '🇹🇷 Türkçe' },
            ].map(l => (
              <button key={l.code} onClick={() => setLang(l.code)}
                className={`flex-1 py-2.5 rounded-xl text-xs font-montserrat font-600 transition-all duration-300 ${
                  lang === l.code
                    ? 'text-white glow-purple'
                    : 'glass text-white/40'
                }`}
                style={lang === l.code ? {
                  background: 'linear-gradient(135deg, rgba(168,85,247,0.3), rgba(6,182,212,0.3))',
                  border: '1px solid rgba(168,85,247,0.5)'
                } : {}}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Секции настроек */}
      <div className="px-5 space-y-4 pb-6">
        {sections.map((section, si) => (
          <div key={section.title} className={`glass rounded-2xl overflow-hidden animate-fade-in-up`}
            style={{ animationDelay: `${(si + 2) * 0.1}s` }}>
            <div className="px-4 py-3 flex items-center gap-2"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: `${section.color}20` }}>
                <Icon name={section.icon as 'Shield' | 'Bell' | 'Lock'} size={14} style={{ color: section.color }} />
              </div>
              <span className="text-xs font-montserrat font-700 uppercase tracking-wider text-white/50">
                {section.title}
              </span>
            </div>

            {section.items.map((item, ii) => (
              <div key={item.label}
                className="px-4 py-4 flex items-center gap-3"
                style={ii < section.items.length - 1 ? { borderBottom: '1px solid rgba(255,255,255,0.04)' } : {}}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${section.color}15` }}>
                  <Icon name={item.icon as 'Camera' | 'Bell' | 'Volume2' | 'BarChart2'} size={16} style={{ color: section.color }} />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-600 text-white">{item.label}</div>
                  <div className="text-xs text-white/30 mt-0.5">{item.desc}</div>
                </div>
                <Toggle on={item.value} onChange={item.toggle} />
              </div>
            ))}
          </div>
        ))}

        {/* Версия */}
        <div className="text-center pt-2">
          <p className="text-xs text-white/20">FitAR v1.0.0 · 2026</p>
          <p className="text-xs text-white/10 mt-1">Made with ✨ on poehali.dev</p>
        </div>
      </div>
    </div>
  );
}
