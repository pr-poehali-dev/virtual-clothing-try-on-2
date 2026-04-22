import { useState } from 'react';
import Icon from '@/components/ui/icon';

const SIZES = {
  chest: 92,
  waist: 76,
  hips: 98,
  height: 172,
};

export default function Profile() {
  const [name, setName] = useState('Александра');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const [sizes, setSizes] = useState(SIZES);

  const save = () => {
    setName(editName);
    setEditing(false);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto no-scrollbar">
      {/* Шапка профиля */}
      <div className="relative px-5 pt-6 pb-8 animate-fade-in-up">
        {/* Градиентный фон шапки */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(180deg, rgba(168,85,247,0.15) 0%, transparent 100%)',
          }} />

        <div className="relative flex items-start gap-4">
          {/* Аватар */}
          <div className="relative">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl"
              style={{
                background: 'linear-gradient(135deg, rgba(168,85,247,0.3), rgba(6,182,212,0.3))',
                border: '2px solid rgba(168,85,247,0.5)',
                boxShadow: '0 0 30px rgba(168,85,247,0.3)',
              }}>
              👩
            </div>
            <button className="absolute -bottom-1 -right-1 w-7 h-7 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #a855f7, #06b6d4)' }}>
              <Icon name="Camera" size={13} className="text-white" />
            </button>
          </div>

          {/* Имя */}
          <div className="flex-1 pt-1">
            {editing ? (
              <div className="flex gap-2">
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="flex-1 bg-white/10 border border-purple-500/50 rounded-xl px-3 py-1.5 text-white text-lg font-montserrat font-700 outline-none"
                  autoFocus
                />
                <button onClick={save}
                  className="px-3 py-1.5 rounded-xl font-montserrat font-700 text-sm text-white"
                  style={{ background: 'linear-gradient(135deg, #a855f7, #06b6d4)' }}>
                  ✓
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="font-montserrat font-900 text-xl text-white">{name}</h2>
                <button onClick={() => setEditing(true)}
                  className="w-7 h-7 rounded-lg glass flex items-center justify-center">
                  <Icon name="Pencil" size={12} className="text-white/50" />
                </button>
              </div>
            )}
            <p className="text-sm text-white/40 mt-1">Профиль покупателя</p>
            <div className="flex items-center gap-1.5 mt-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-400">Активен</span>
            </div>
          </div>
        </div>
      </div>

      {/* Мои размеры */}
      <div className="px-5 mb-4 animate-fade-in-up delay-100">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-white/40 uppercase tracking-widest font-montserrat">Мои размеры</p>
          <span className="text-xs text-purple-400 font-600">Размер M</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { key: 'chest', label: 'Грудь', unit: 'см', icon: '📏', color: '#a855f7' },
            { key: 'waist', label: 'Талия', unit: 'см', icon: '📐', color: '#06b6d4' },
            { key: 'hips', label: 'Бёдра', unit: 'см', icon: '📏', color: '#ec4899' },
            { key: 'height', label: 'Рост', unit: 'см', icon: '📊', color: '#f97316' },
          ].map((param) => (
            <div key={param.key} className="glass rounded-2xl p-4"
              style={{ border: `1px solid ${param.color}20` }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-lg">{param.icon}</span>
                <span className="text-xs text-white/30">{param.unit}</span>
              </div>
              <div className="font-montserrat font-900 text-2xl mb-0.5"
                style={{ color: param.color }}>
                {sizes[param.key as keyof typeof sizes]}
              </div>
              <div className="text-xs text-white/40">{param.label}</div>
              <input
                type="range"
                min={param.key === 'height' ? 150 : 60}
                max={param.key === 'height' ? 200 : 130}
                value={sizes[param.key as keyof typeof sizes]}
                onChange={e => setSizes(prev => ({ ...prev, [param.key]: Number(e.target.value) }))}
                className="w-full mt-3 cursor-pointer"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Действия аккаунта */}
      <div className="px-5 space-y-3 pb-6 animate-fade-in-up delay-200">
        <p className="text-xs text-white/40 uppercase tracking-widest font-montserrat">Аккаунт</p>
        {[
          { label: 'Мой стиль', desc: 'Casuals, спорт, элегант', icon: 'Sparkles', color: '#a855f7' },
          { label: 'Любимые бренды', desc: '3 бренда добавлено', icon: 'Star', color: '#f97316' },
          { label: 'Поделиться', desc: 'Пригласи друга', icon: 'Share2', color: '#06b6d4' },
        ].map((item, i) => (
          <button key={item.label}
            className="w-full glass rounded-2xl p-4 flex items-center gap-3 text-left clothes-card"
            style={{ animationDelay: `${i * 0.08}s` }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: `${item.color}20` }}>
              <Icon name={item.icon as 'Sparkles' | 'Star' | 'Share2'} size={18} style={{ color: item.color }} />
            </div>
            <div className="flex-1">
              <div className="text-sm font-600 text-white">{item.label}</div>
              <div className="text-xs text-white/30 mt-0.5">{item.desc}</div>
            </div>
            <Icon name="ChevronRight" size={16} className="text-white/20" />
          </button>
        ))}

        <button className="w-full mt-2 py-3 rounded-2xl text-sm font-montserrat font-600 text-red-400/70 glass transition-all hover:bg-red-500/10">
          Выйти из аккаунта
        </button>
      </div>
    </div>
  );
}
