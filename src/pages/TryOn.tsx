import { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '@/components/ui/icon';

const CLOTHES = [
  { id: 1, name: 'Бомбер', emoji: '🧥', color: '#a855f7', category: 'Верх' },
  { id: 2, name: 'Худи', emoji: '👕', color: '#06b6d4', category: 'Верх' },
  { id: 3, name: 'Платье', emoji: '👗', color: '#ec4899', category: 'Платья' },
  { id: 4, name: 'Куртка', emoji: '🥻', color: '#f97316', category: 'Верх' },
  { id: 5, name: 'Пальто', emoji: '🧣', color: '#6366f1', category: 'Верх' },
  { id: 6, name: 'Джинсы', emoji: '👖', color: '#3b82f6', category: 'Низ' },
];

type CameraStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'error';

export default function TryOn() {
  const [selected, setSelected] = useState(CLOTHES[0]);
  const [size, setSize] = useState(50);
  const [posY, setPosY] = useState(50);
  const [saved, setSaved] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [scanning, setScanning] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async (facing: 'user' | 'environment') => {
    stopCamera();
    setCameraStatus('requesting');
    setScanning(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraStatus('active');
      setTimeout(() => setScanning(false), 1500);
    } catch (err: unknown) {
      stopCamera();
      const error = err as { name?: string };
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setCameraStatus('denied');
      } else {
        setCameraStatus('error');
      }
      setScanning(false);
    }
  }, [stopCamera]);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const handleFlip = () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    startCamera(next);
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const sizeLabel = size < 33 ? 'XS' : size < 50 ? 'S' : size < 67 ? 'M' : size < 84 ? 'L' : 'XL';

  const emojiScale = 0.8 + size * 0.008;
  const emojiTop = 30 + (posY - 50) * 0.5;

  return (
    <div className="flex flex-col h-full relative">
      {/* Заголовок */}
      <div className="px-5 pt-6 pb-4 flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="font-montserrat font-900 text-2xl text-white leading-tight">
            AR <span className="text-gradient">Примерочная</span>
          </h1>
          <p className="text-sm text-white/40 mt-0.5">
            {cameraStatus === 'active' ? '● Камера активна' : 'Примеряй не выходя из дома'}
          </p>
        </div>
        <button className="glass rounded-2xl p-3 relative">
          <Icon name="Sparkles" size={20} className="text-purple-400" />
          {cameraStatus === 'active' && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full animate-pulse" />
          )}
        </button>
      </div>

      {/* AR Вьюпорт */}
      <div className="mx-5 relative rounded-3xl overflow-hidden" style={{ height: '340px' }}>

        {/* Видео с камеры */}
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
            display: cameraStatus === 'active' ? 'block' : 'none',
          }}
        />

        {/* Фон (когда камера не активна) */}
        {cameraStatus !== 'active' && (
          <div className="absolute inset-0"
            style={{ background: 'linear-gradient(160deg, #0f1729 0%, #1a0f2e 50%, #0d1a2e 100%)' }}>
            <div className="absolute inset-0 opacity-10"
              style={{
                backgroundImage: 'linear-gradient(rgba(6,182,212,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.5) 1px, transparent 1px)',
                backgroundSize: '30px 30px'
              }} />
          </div>
        )}

        {/* Затемнение поверх видео */}
        {cameraStatus === 'active' && (
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.15)' }} />
        )}

        {/* AR уголки */}
        <div className="ar-corner ar-corner-tl animate-ar-pulse" />
        <div className="ar-corner ar-corner-tr animate-ar-pulse" />
        <div className="ar-corner ar-corner-bl animate-ar-pulse" />
        <div className="ar-corner ar-corner-br animate-ar-pulse" />

        {/* Линия сканирования */}
        {scanning && (
          <div className="absolute left-0 right-0 h-0.5 animate-ar-scan"
            style={{ background: 'linear-gradient(90deg, transparent, #06b6d4, transparent)', zIndex: 10 }} />
        )}

        {/* Состояния экрана */}
        {cameraStatus === 'idle' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div className="w-20 h-20 rounded-full glass flex items-center justify-center animate-float"
              style={{ border: '2px solid rgba(168,85,247,0.5)' }}>
              <Icon name="Camera" size={32} className="text-purple-400" />
            </div>
            <button
              onClick={() => startCamera(facingMode)}
              className="btn-primary px-6 py-3 font-montserrat font-700 text-sm relative z-10">
              Запустить камеру
            </button>
            <p className="text-white/30 text-xs">Нужен доступ к камере</p>
          </div>
        )}

        {cameraStatus === 'requesting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-full border-2 border-purple-500/30 border-t-purple-500 animate-spin" />
            <p className="text-white/50 text-sm">Запрашиваю доступ...</p>
          </div>
        )}

        {cameraStatus === 'denied' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(239,68,68,0.15)' }}>
              <Icon name="CameraOff" size={24} className="text-red-400" />
            </div>
            <p className="text-white/70 text-sm font-600">Доступ к камере запрещён</p>
            <p className="text-white/30 text-xs">Разреши доступ в настройках браузера и попробуй снова</p>
            <button onClick={() => startCamera(facingMode)}
              className="btn-secondary px-4 py-2 text-sm rounded-xl">
              Попробовать снова
            </button>
          </div>
        )}

        {cameraStatus === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(249,115,22,0.15)' }}>
              <Icon name="AlertTriangle" size={24} className="text-orange-400" />
            </div>
            <p className="text-white/70 text-sm font-600">Камера недоступна</p>
            <p className="text-white/30 text-xs">Возможно, камера занята другим приложением</p>
            <button onClick={() => startCamera(facingMode)}
              className="btn-secondary px-4 py-2 text-sm rounded-xl">
              Повторить
            </button>
          </div>
        )}

        {/* Наложение одежды поверх камеры */}
        {cameraStatus === 'active' && (
          <div className="absolute inset-0 pointer-events-none flex justify-center"
            style={{ zIndex: 5 }}>
            <div
              className="absolute transition-all duration-300"
              style={{
                top: `${emojiTop}%`,
                fontSize: `${80 * emojiScale}px`,
                lineHeight: 1,
                filter: `drop-shadow(0 0 20px ${selected.color}) drop-shadow(0 0 40px ${selected.color}80)`,
                transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
              }}>
              {selected.emoji}
            </div>

            {/* Лейбл размера */}
            <div className="absolute top-3 right-3 glass rounded-xl px-3 py-1.5 pointer-events-auto">
              <span className="text-xs font-montserrat font-700 text-cyan-400">{sizeLabel}</span>
            </div>

            {/* Лейбл вещи */}
            <div className="absolute bottom-3 left-3 glass rounded-xl px-3 py-1.5 flex items-center gap-2 pointer-events-auto">
              <span className="text-sm">{selected.emoji}</span>
              <span className="text-xs font-600 text-white">{selected.name}</span>
            </div>
          </div>
        )}

        {/* Кнопка переключения камеры */}
        {cameraStatus === 'active' && (
          <button
            onClick={handleFlip}
            className="absolute top-3 left-3 glass rounded-xl p-2.5 z-10 transition-all hover:scale-110 active:scale-95"
            title="Перевернуть камеру">
            <Icon name="RefreshCw" size={16} className="text-white/70" />
          </button>
        )}

        {/* Градиент снизу */}
        <div className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none z-10"
          style={{ background: 'linear-gradient(to top, rgba(8,11,20,0.7), transparent)' }} />
      </div>

      {/* Регуляторы */}
      {cameraStatus === 'active' && (
        <div className="mx-5 mt-3 glass rounded-2xl p-4 animate-scale-in space-y-3">
          <div className="flex items-center gap-3">
            <Icon name="Maximize2" size={16} className="text-purple-400 flex-shrink-0" />
            <div className="flex-1">
              <div className="flex justify-between text-xs text-white/40 mb-1">
                <span>Размер одежды</span>
                <span className="text-purple-400 font-600">{sizeLabel}</span>
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
                className="w-full cursor-pointer" />
            </div>
          </div>
        </div>
      )}

      {/* Каталог */}
      <div className="mt-4 px-5">
        <p className="text-xs text-white/40 uppercase tracking-widest mb-3 font-montserrat">Каталог</p>
        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
          {CLOTHES.map((item, i) => (
            <button
              key={item.id}
              onClick={() => setSelected(item)}
              className="clothes-card flex-shrink-0 glass rounded-2xl p-3 flex flex-col items-center gap-1.5 w-20 animate-fade-in-up"
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
      {cameraStatus === 'active' && (
        <div className="px-5 mt-4 flex gap-3 animate-slide-in-bottom">
          <button onClick={handleSave}
            className={`flex-1 py-3 rounded-2xl font-montserrat font-700 text-sm flex items-center justify-center gap-2 transition-all duration-300 ${
              saved
                ? 'border text-green-400'
                : 'btn-primary'
            }`}
            style={saved ? { background: 'rgba(34,197,94,0.15)', borderColor: 'rgba(34,197,94,0.4)' } : {}}>
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
