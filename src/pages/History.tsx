import { useState } from 'react';
import Icon from '@/components/ui/icon';

type StatIcon = 'Shirt' | 'Heart' | 'Calendar';

const SAVED = [
  { id: 1, emoji: '🧥', name: 'Бомбер', date: '20 апр', size: 'M', liked: true, color: '#a855f7' },
  { id: 2, emoji: '👗', name: 'Платье миди', date: '19 апр', size: 'S', liked: true, color: '#ec4899' },
  { id: 3, emoji: '👕', name: 'Худи оверсайз', date: '18 апр', size: 'L', liked: false, color: '#06b6d4' },
  { id: 4, emoji: '👖', name: 'Джинсы slim', date: '17 апр', size: 'M', liked: true, color: '#3b82f6' },
  { id: 5, emoji: '🥻', name: 'Куртка кожа', date: '15 апр', size: 'M', liked: false, color: '#f97316' },
];

export default function History() {
  const [items, setItems] = useState(SAVED);
  const [activeTab, setActiveTab] = useState<'all' | 'liked'>('all');

  const toggle = (id: number) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, liked: !i.liked } : i));
  };

  const filtered = activeTab === 'liked' ? items.filter(i => i.liked) : items;

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-6 pb-4 animate-fade-in-up">
        <h1 className="font-montserrat font-900 text-2xl text-white">
          Мои <span className="text-gradient">примерки</span>
        </h1>
        <p className="text-sm text-white/40 mt-0.5">{items.filter(i => i.liked).length} избранных вещей</p>
      </div>

      {/* Статистика */}
      <div className="px-5 mb-4 grid grid-cols-3 gap-3 animate-fade-in-up delay-100">
        {([
          { label: 'Примерок', value: items.length, icon: 'Shirt' as StatIcon, color: '#a855f7' },
          { label: 'Сохранено', value: items.filter(i => i.liked).length, icon: 'Heart' as StatIcon, color: '#ec4899' },
          { label: 'Дней', value: 6, icon: 'Calendar' as StatIcon, color: '#06b6d4' },
        ]).map(stat => (
          <div key={stat.label} className="glass rounded-2xl p-3 text-center">
            <div className="w-8 h-8 rounded-xl mx-auto mb-2 flex items-center justify-center"
              style={{ background: `${stat.color}20` }}>
              <Icon name={stat.icon} size={16} style={{ color: stat.color }} />
            </div>
            <div className="font-montserrat font-900 text-xl text-white">{stat.value}</div>
            <div className="text-xs text-white/40">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Табы */}
      <div className="px-5 mb-4 animate-fade-in-up delay-200">
        <div className="glass rounded-2xl p-1 flex">
          {[
            { key: 'all', label: 'Все' },
            { key: 'liked', label: '❤️ Избранные' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as 'all' | 'liked')}
              className={`flex-1 py-2 rounded-xl text-sm font-montserrat font-600 transition-all duration-300 ${
                activeTab === tab.key
                  ? 'bg-purple-500/30 text-purple-300 shadow-lg'
                  : 'text-white/40'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Список */}
      <div className="px-5 flex-1 overflow-y-auto no-scrollbar space-y-3 pb-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center animate-scale-in">
            <div className="text-5xl mb-4">🌟</div>
            <p className="text-white/40 text-sm">Пока пусто</p>
            <p className="text-white/20 text-xs mt-1">Сохраняй понравившиеся вещи</p>
          </div>
        ) : (
          filtered.map((item, i) => (
            <div key={item.id}
              className="glass rounded-2xl p-4 flex items-center gap-4 animate-fade-in-up clothes-card"
              style={{ animationDelay: `${i * 0.08}s` }}>
              {/* Иконка */}
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0"
                style={{ background: `${item.color}15`, border: `1px solid ${item.color}30` }}>
                {item.emoji}
              </div>

              {/* Инфо */}
              <div className="flex-1 min-w-0">
                <div className="font-600 text-white text-sm">{item.name}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs px-2 py-0.5 rounded-full font-montserrat font-700"
                    style={{ background: `${item.color}20`, color: item.color }}>
                    {item.size}
                  </span>
                  <span className="text-xs text-white/30">{item.date}</span>
                </div>
              </div>

              {/* Действия */}
              <div className="flex gap-2">
                <button onClick={() => toggle(item.id)}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300 ${
                    item.liked ? 'bg-pink-500/20 text-pink-400' : 'glass text-white/30'
                  }`}>
                  <Icon name="Heart" size={16} />
                </button>
                <button className="w-9 h-9 rounded-xl glass flex items-center justify-center text-white/30">
                  <Icon name="RotateCcw" size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
