import { useState, useRef } from 'react';
import Icon from '@/components/ui/icon';

const CLOTHES = [
  { id: 1, name: 'Бомбер', emoji: '🧥', color: '#a855f7', category: 'Верх' },
  { id: 2, name: 'Худи', emoji: '👕', color: '#06b6d4', category: 'Верх' },
  { id: 3, name: 'Платье', emoji: '👗', color: '#ec4899', category: 'Платья' },
  { id: 4, name: 'Куртка', emoji: '🥻', color: '#f97316', category: 'Верх' },
  { id: 5, name: 'Пальто', emoji: '🧣', color: '#6366f1', category: 'Верх' },
  { id: 6, name: 'Джинсы', emoji: '👖', color: '#3b82f6', category: 'Низ' },
];

export default function TryOn() {
  const [selected, setSelected] = useState(CLOTHES[0]);
  const [size, setSize] = useState(50);
  const [posY, setPosY] = useState(50);
  const [isTrying, setIsTrying] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTry = () => {
    setIsTrying(true);
    setTimeout(() => setCameraActive(true), 800);
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Заголовок */}
      <div className="px-5 pt-6 pb-4 flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="font-montserrat font-900 text-2xl text-white leading-tight">
            AR <span className="text-gradient">Примерочная</span>
          </h1>
          <p className="text-sm text-white/40 mt-0.5">Примеряй не выходя из дома</p>
        </div>
        <button className="glass rounded-2xl p-3 relative">
          <Icon name="Sparkles" size={20} className="text-purple-400" />
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-purple-500 rounded-full animate-pulse" />
        </button>
      </div>

      {/* AR Вьюпорт */}
      <div className="mx-5 relative rounded-3xl overflow-hidden" style={{ height: '340px' }}>
        {/* Фон камеры / заглушка */}
        <div className={`absolute inset-0 transition-all duration-700 ${cameraActive ? 'opacity-100' : 'opacity-100'}`}
          style={{
            background: cameraActive
              ? 'linear-gradient(160deg, #0f172a 0%, #1e1040 50%, #0c1a2e 100%)'
              : 'linear-gradient(160deg, #0f1729 0%, #1a0f2e 50%, #0d1a2e 100%)'
          }}>
          {/* Сетка AR */}
          <div className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: 'linear-gradient(rgba(6,182,212,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.5) 1px, transparent 1px)',
              backgroundSize: '30px 30px'
            }} />
        </div>

        {/* AR уголки */}
        <div className="ar-corner ar-corner-tl animate-ar-pulse" />
        <div className="ar-corner ar-corner-tr animate-ar-pulse" />
        <div className="ar-corner ar-corner-bl animate-ar-pulse" />
        <div className="ar-corner ar-corner-br animate-ar-pulse" />

        {/* Сканирующая линия */}
        {isTrying && (
          <div className="absolute left-0 right-0 h-0.5 animate-ar-scan"
            style={{ background: 'linear-gradient(90deg, transparent, #06b6d4, transparent)', zIndex: 10 }} />
        )}

        {!cameraActive ? (
          /* Кнопка запуска */
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div className="w-20 h-20 rounded-full glass flex items-center justify-center animate-float"
              style={{ border: '2px solid rgba(168,85,247,0.5)' }}>
              <Icon name="Camera" size={32} className="text-purple-400" />
            </div>
            <button onClick={handleTry} className="btn-primary px-6 py-3 font-montserrat font-700 text-sm relative z-10">
              Запустить камеру
            </button>
            <p className="text-white/30 text-xs">Нужен доступ к камере</p>
          </div>
        ) : (
          /* AR режим активен */
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {/* Силуэт человека */}
            <div className="relative animate-float" style={{ filter: 'drop-shadow(0 0 20px rgba(168,85,247,0.6))' }}>
              <div className="text-center">
                {/* Голова */}
                <div className="w-14 h-14 rounded-full mx-auto mb-1 glass-strong"
                  style={{ border: '2px solid rgba(6,182,212,0.6)' }} />
                {/* Одежда */}
                <div className="relative mx-auto transition-all duration-500"
                  style={{
                    width: `${60 + size * 0.6}px`,
                    marginTop: `${(posY - 50) * 0.5}px`,
                  }}>
                  <div className="text-6xl text-center leading-none"
                    style={{ filter: `drop-shadow(0 0 15px ${selected.color})` }}>
                    {selected.emoji}
                  </div>
                  {/* Неоновый контур */}
                  <div className="absolute inset-0 rounded-2xl animate-ar-pulse"
                    style={{ border: `1px solid ${selected.color}40`, boxShadow: `0 0 20px ${selected.color}30` }} />
                </div>
                {/* Ноги */}
                <div className="text-4xl mt-1">🦵</div>
              </div>
            </div>

            {/* Лейбл размера */}
            <div className="absolute top-3 right-3 glass rounded-xl px-3 py-1.5">
              <span className="text-xs font-montserrat font-700 text-cyan-400">
                {size < 33 ? 'XS' : size < 50 ? 'S' : size < 67 ? 'M' : size < 84 ? 'L' : 'XL'}
              </span>
            </div>

            {/* Лейбл вещи */}
            <div className="absolute bottom-3 left-3 glass rounded-xl px-3 py-1.5 flex items-center gap-2">
              <span className="text-sm">{selected.emoji}</span>
              <span className="text-xs font-600 text-white">{selected.name}</span>
            </div>
          </div>
        )}

        {/* Оверлей градиент снизу */}
        <div className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
          style={{ background: 'linear-gradient(to top, rgba(8,11,20,0.8), transparent)' }} />
      </div>

      {/* Регуляторы (видны когда камера активна) */}
      {cameraActive && (
        <div className="mx-5 mt-3 glass rounded-2xl p-4 animate-scale-in space-y-3">
          <div className="flex items-center gap-3">
            <Icon name="Maximize2" size={16} className="text-purple-400 flex-shrink-0" />
            <div className="flex-1">
              <div className="flex justify-between text-xs text-white/40 mb-1">
                <span>Размер</span>
                <span className="text-purple-400 font-600">
                  {size < 33 ? 'XS' : size < 50 ? 'S' : size < 67 ? 'M' : size < 84 ? 'L' : 'XL'}
                </span>
              </div>
              <input type="range" min="0" max="100" value={size}
                onChange={e => setSize(Number(e.target.value))}
                className="w-full cursor-pointer" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Icon name="MoveVertical" size={16} className="text-cyan-400 flex-shrink-0" />
            <div className="flex-1">
              <div className="flex justify-between text-xs text-white/40 mb-1">
                <span>Положение</span>
                <span className="text-cyan-400 font-600">{posY > 60 ? 'Ниже' : posY < 40 ? 'Выше' : 'Центр'}</span>
              </div>
              <input type="range" min="0" max="100" value={posY}
                onChange={e => setPosY(Number(e.target.value))}
                className="w-full cursor-pointer"
                style={{ background: 'linear-gradient(to right, #06b6d4, #a855f7)' }} />
            </div>
          </div>
        </div>
      )}

      {/* Выбор одежды */}
      <div className="mt-4 px-5">
        <p className="text-xs text-white/40 uppercase tracking-widest mb-3 font-montserrat">Каталог</p>
        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
          {CLOTHES.map((item, i) => (
            <button
              key={item.id}
              onClick={() => setSelected(item)}
              className={`clothes-card flex-shrink-0 glass rounded-2xl p-3 flex flex-col items-center gap-1.5 w-20 animate-fade-in-up`}
              style={{
                animationDelay: `${i * 0.08}s`,
                border: selected.id === item.id ? `1px solid ${item.color}` : '1px solid rgba(255,255,255,0.06)',
                boxShadow: selected.id === item.id ? `0 0 20px ${item.color}40` : 'none',
              }}>
              <span className="text-2xl">{item.emoji}</span>
              <span className="text-xs text-white/70 font-500 text-center leading-tight">{item.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Кнопки действий */}
      {cameraActive && (
        <div className="px-5 mt-4 flex gap-3 animate-slide-in-bottom">
          <button onClick={handleSave}
            className={`flex-1 py-3 rounded-2xl font-montserrat font-700 text-sm flex items-center justify-center gap-2 transition-all duration-300 ${
              saved
                ? 'bg-green-500/20 border border-green-500/50 text-green-400'
                : 'btn-primary'
            }`}>
            <Icon name={saved ? 'Check' : 'Heart'} size={16} />
            {saved ? 'Сохранено!' : 'Сохранить'}
          </button>
          <button className="btn-secondary px-4 py-3 rounded-2xl flex items-center justify-center">
            <Icon name="Share2" size={18} className="text-white/70" />
          </button>
        </div>
      )}
    </div>
  );
}
