import { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '@/components/ui/icon';

const REMOVE_BG_URL = 'https://functions.poehali.dev/30c6090a-e6b1-43f0-86a9-b216df2359d2';

type CameraStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'error';
type AppStep = 'upload' | 'processing' | 'tryon';
type PhotoStatus = 'idle' | 'flash' | 'done';
type Lang = 'ru' | 'en';

const T = {
  ru: {
    title: 'AR Примерочная',
    subtitle: 'Примеряй одежду не выходя из дома',
    uploadBtn: 'Загрузить одежду',
    uploadHint: 'Из галереи: фото куртки, платья, обуви...',
    processing: 'Убираю фон...',
    processingHint: 'ИИ вырезает одежду из фотографии',
    startCamera: 'Включить камеру',
    cameraHint: 'Нужен доступ к камере',
    active: '● Камера активна',
    denied: 'Доступ к камере запрещён',
    deniedHint: 'Разреши доступ в настройках браузера',
    error: 'Камера недоступна',
    errorHint: 'Возможно, камера занята другим приложением',
    retry: 'Повторить',
    size: 'Размер',
    position: 'Положение',
    posAbove: 'Выше',
    posCenter: 'Центр',
    posBelow: 'Ниже',
    save: 'Сохранить',
    saved: 'Сохранено!',
    photoSaved: '✓ Фото сохранено на устройство',
    changeCloth: 'Сменить одежду',
    tips: [
      '💡 Встань прямо, лицом к камере',
      '💡 Хорошее освещение — залог красивой примерки',
      '💡 Держи телефон на уровне груди',
      '💡 Отойди на 1–2 метра от камеры',
      '💡 Фото на белом фоне работают лучше всего',
    ],
    errBg: 'Не удалось обработать фото. Попробуй другое изображение.',
  },
  en: {
    title: 'AR Fitting Room',
    subtitle: 'Try on clothes without leaving home',
    uploadBtn: 'Upload clothing',
    uploadHint: 'From gallery: jacket, dress, shoes...',
    processing: 'Removing background...',
    processingHint: 'AI is cutting out the clothing',
    startCamera: 'Start camera',
    cameraHint: 'Camera access required',
    active: '● Camera active',
    denied: 'Camera access denied',
    deniedHint: 'Allow access in browser settings',
    error: 'Camera unavailable',
    errorHint: 'Another app may be using the camera',
    retry: 'Retry',
    size: 'Size',
    position: 'Position',
    posAbove: 'Up',
    posCenter: 'Center',
    posBelow: 'Down',
    save: 'Save',
    saved: 'Saved!',
    photoSaved: '✓ Photo saved to device',
    changeCloth: 'Change clothing',
    tips: [
      '💡 Stand straight, facing the camera',
      '💡 Good lighting makes try-on look better',
      '💡 Hold your phone at chest level',
      '💡 Stand 1–2 meters from camera',
      '💡 Photos on white background work best',
    ],
    errBg: 'Could not process photo. Try a different image.',
  },
};

interface TryOnProps {
  lang?: Lang;
}

export default function TryOn({ lang = 'ru' }: TryOnProps) {
  const t = T[lang];

  const [step, setStep] = useState<AppStep>('upload');
  const [clothImage, setClothImage] = useState<string | null>(null); // PNG с прозрачным фоном
  const [bgError, setBgError] = useState('');
  const [size, setSize] = useState(50);
  const [posY, setPosY] = useState(40);
  const [saved, setSaved] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [scanning, setScanning] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [photoStatus, setPhotoStatus] = useState<PhotoStatus>('idle');
  const [tipIndex, setTipIndex] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clothImgRef = useRef<HTMLImageElement | null>(null);

  // Ротация подсказок
  useEffect(() => {
    const id = setInterval(() => setTipIndex(i => (i + 1) % t.tips.length), 4000);
    return () => clearInterval(id);
  }, [t.tips.length]);

  // Камера
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(tr => tr.stop());
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
      const e = err as { name?: string };
      setCameraStatus(e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError' ? 'denied' : 'error');
      setScanning(false);
    }
  }, [stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // Загрузка фото из галереи
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBgError('');
    setStep('processing');

    // Читаем файл как base64
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target?.result as string;
      try {
        const res = await fetch(REMOVE_BG_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64 }),
        });
        const data = await res.json();
        if (data.ok && data.image) {
          setClothImage(data.image);
          // Предзагружаем img для canvas
          const img = new Image();
          img.src = data.image;
          clothImgRef.current = img;
          setStep('tryon');
          setCameraStatus('idle');
        } else {
          setBgError(t.errBg);
          setStep('upload');
        }
      } catch {
        setBgError(t.errBg);
        setStep('upload');
      }
    };
    reader.readAsDataURL(file);
    // Сбрасываем input чтобы можно было выбрать тот же файл снова
    e.target.value = '';
  };

  const handleFlip = () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    startCamera(next);
  };

  // Вычисляемые параметры наложения
  const clothScale = 0.6 + size * 0.006;
  const clothTopPct = 20 + (posY - 50) * 0.6;

  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const handlePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const clothEl = clothImgRef.current;
    if (!video || !canvas) return;

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (facingMode === 'user') { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, w, h);
    if (facingMode === 'user') ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (clothEl && clothEl.complete) {
      const cw = w * clothScale * 0.8;
      const ch = cw * (clothEl.naturalHeight / clothEl.naturalWidth);
      const cx = (w - cw) / 2;
      const cy = (clothTopPct / 100) * h;
      ctx.drawImage(clothEl, cx, cy, cw, ch);
    }

    setPhotoStatus('flash');
    setTimeout(() => setPhotoStatus('done'), 200);
    setTimeout(() => setPhotoStatus('idle'), 2500);

    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fitar-${Date.now()}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/jpeg', 0.92);
  }, [facingMode, clothScale, clothTopPct]);

  const sizeLabel = size < 33 ? 'XS' : size < 50 ? 'S' : size < 67 ? 'M' : size < 84 ? 'L' : 'XL';

  return (
    <div className="flex flex-col h-full relative">
      {/* Скрытые элементы */}
      <canvas ref={canvasRef} className="hidden" />
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

      {/* Заголовок */}
      <div className="px-5 pt-6 pb-3 flex items-center justify-between animate-fade-in-up flex-shrink-0">
        <div>
          <h1 className="font-montserrat font-900 text-2xl text-white leading-tight">
            {lang === 'ru' ? <>AR <span className="text-gradient">Примерочная</span></> : <><span className="text-gradient">AR</span> Fitting Room</>}
          </h1>
          <p className="text-xs text-white/40 mt-0.5">
            {step === 'tryon' && cameraStatus === 'active' ? t.active : t.subtitle}
          </p>
        </div>
        {step === 'tryon' && (
          <button
            onClick={() => { stopCamera(); setStep('upload'); setClothImage(null); setCameraStatus('idle'); }}
            className="glass rounded-2xl px-3 py-2 flex items-center gap-1.5">
            <Icon name="Upload" size={14} className="text-purple-400" />
            <span className="text-xs text-white/60 font-600">{t.changeCloth}</span>
          </button>
        )}
      </div>

      {/* ШАГ 1: Загрузка */}
      {step === 'upload' && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-5 animate-scale-in">
          <div className="w-32 h-32 rounded-3xl glass flex items-center justify-center animate-float"
            style={{ border: '2px solid rgba(168,85,247,0.4)' }}>
            <div className="text-center">
              <div className="text-5xl mb-1">👗</div>
            </div>
          </div>

          <div className="text-center">
            <h2 className="font-montserrat font-800 text-xl text-white mb-1">{t.uploadBtn}</h2>
            <p className="text-sm text-white/40">{t.uploadHint}</p>
          </div>

          {bgError && (
            <div className="glass rounded-2xl px-4 py-3 border border-red-500/30 text-red-400 text-sm text-center">
              {bgError}
            </div>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn-primary px-8 py-4 font-montserrat font-700 text-base flex items-center gap-3 rounded-2xl">
            <Icon name="ImagePlus" size={22} className="text-white" />
            {t.uploadBtn}
          </button>

          <p className="text-xs text-white/25 text-center max-w-xs">
            {lang === 'ru'
              ? 'ИИ автоматически уберёт фон и оставит только одежду'
              : 'AI will automatically remove background, keeping only the clothing'}
          </p>

          {/* Подсказка */}
          <div className="absolute bottom-4 left-4 right-4">
            <div className="glass rounded-2xl px-4 py-3 text-center">
              <p className="text-xs text-white/50 transition-all duration-500">{t.tips[tipIndex]}</p>
            </div>
          </div>
        </div>
      )}

      {/* ШАГ 2: Обработка */}
      {step === 'processing' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 animate-scale-in">
          <div className="relative w-24 h-24">
            <div className="w-24 h-24 rounded-full border-2 border-purple-500/20 border-t-purple-500 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center text-3xl">✂️</div>
          </div>
          <div className="text-center">
            <p className="font-montserrat font-700 text-white text-lg">{t.processing}</p>
            <p className="text-sm text-white/40 mt-1">{t.processingHint}</p>
          </div>
          {/* Анимированные точки прогресса */}
          <div className="flex gap-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"
                style={{ animationDelay: `${i * 0.2}s` }} />
            ))}
          </div>
        </div>
      )}

      {/* ШАГ 3: Примерка с камерой */}
      {step === 'tryon' && (
        <>
          {/* AR Вьюпорт */}
          <div className="mx-5 relative rounded-3xl overflow-hidden flex-shrink-0" style={{ height: '320px' }}>
            <video ref={videoRef} playsInline muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none', display: cameraStatus === 'active' ? 'block' : 'none' }} />

            {cameraStatus !== 'active' && (
              <div className="absolute inset-0"
                style={{ background: 'linear-gradient(160deg, #0f1729 0%, #1a0f2e 50%, #0d1a2e 100%)' }}>
                <div className="absolute inset-0 opacity-10"
                  style={{ backgroundImage: 'linear-gradient(rgba(6,182,212,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.5) 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
              </div>
            )}

            {cameraStatus === 'active' && (
              <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.1)' }} />
            )}

            {/* AR уголки */}
            <div className="ar-corner ar-corner-tl animate-ar-pulse" />
            <div className="ar-corner ar-corner-tr animate-ar-pulse" />
            <div className="ar-corner ar-corner-bl animate-ar-pulse" />
            <div className="ar-corner ar-corner-br animate-ar-pulse" />

            {scanning && (
              <div className="absolute left-0 right-0 h-0.5 animate-ar-scan z-10"
                style={{ background: 'linear-gradient(90deg, transparent, #06b6d4, transparent)' }} />
            )}

            {/* Наложение одежды поверх видео — живая ткань */}
            {clothImage && cameraStatus === 'active' && (
              <div className="absolute inset-0 flex justify-center pointer-events-none" style={{ zIndex: 5 }}>
                {/* Тень на полу под одеждой */}
                <div className="absolute"
                  style={{
                    bottom: `${100 - clothTopPct - clothScale * 80}%`,
                    width: `${clothScale * 70}%`,
                    height: '12px',
                    background: 'radial-gradient(ellipse, rgba(0,0,0,0.35) 0%, transparent 70%)',
                    filter: 'blur(4px)',
                    transform: 'translateX(-50%)',
                    left: '50%',
                  }}
                />
                <img
                  src={clothImage}
                  alt="clothing"
                  className={facingMode === 'user' ? 'animate-cloth-sway-mirror' : 'animate-cloth-sway'}
                  style={{
                    position: 'absolute',
                    top: `${clothTopPct}%`,
                    width: `${clothScale * 100}%`,
                    maxWidth: '88%',
                    objectFit: 'contain',
                    /* Реалистичная тень как от настоящей одежды */
                    filter: [
                      'drop-shadow(0 8px 16px rgba(0,0,0,0.55))',
                      'drop-shadow(0 2px 4px rgba(0,0,0,0.35))',
                    ].join(' '),
                    /* Лёгкое смягчение краёв */
                    WebkitMaskImage: 'radial-gradient(ellipse 100% 100% at 50% 50%, black 85%, transparent 100%)',
                    maskImage: 'radial-gradient(ellipse 100% 100% at 50% 50%, black 85%, transparent 100%)',
                    /* Переход плавный при движении ползунков */
                    transition: 'top 0.15s ease, width 0.15s ease',
                  }}
                />
              </div>
            )}

            {/* Превью одежды (камера не активна) */}
            {clothImage && cameraStatus !== 'active' && cameraStatus !== 'requesting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                <img src={clothImage} alt="clothing"
                  className="w-32 object-contain animate-float"
                  style={{ filter: 'drop-shadow(0 0 20px rgba(168,85,247,0.6))' }} />
                <button onClick={() => startCamera(facingMode)} className="btn-primary px-5 py-3 font-montserrat font-700 text-sm flex items-center gap-2 rounded-xl">
                  <Icon name="Camera" size={16} className="text-white" />
                  {t.startCamera}
                </button>
              </div>
            )}

            {cameraStatus === 'requesting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <div className="w-10 h-10 rounded-full border-2 border-purple-500/30 border-t-purple-500 animate-spin" />
                <p className="text-white/50 text-sm">{lang === 'ru' ? 'Запрашиваю доступ...' : 'Requesting access...'}</p>
              </div>
            )}

            {cameraStatus === 'denied' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
                <Icon name="CameraOff" size={28} className="text-red-400" />
                <p className="text-white/70 text-sm font-600">{t.denied}</p>
                <p className="text-white/30 text-xs">{t.deniedHint}</p>
                <button onClick={() => startCamera(facingMode)} className="btn-secondary px-4 py-2 text-sm rounded-xl">{t.retry}</button>
              </div>
            )}

            {cameraStatus === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
                <Icon name="AlertTriangle" size={28} className="text-orange-400" />
                <p className="text-white/70 text-sm font-600">{t.error}</p>
                <p className="text-white/30 text-xs">{t.errorHint}</p>
                <button onClick={() => startCamera(facingMode)} className="btn-secondary px-4 py-2 text-sm rounded-xl">{t.retry}</button>
              </div>
            )}

            {/* Кнопка переключения камеры */}
            {cameraStatus === 'active' && (
              <button onClick={handleFlip}
                className="absolute top-3 left-3 glass rounded-xl p-2.5 z-10 transition-all hover:scale-110 active:scale-95">
                <Icon name="RefreshCw" size={16} className="text-white/70" />
              </button>
            )}

            {/* Лейбл размера */}
            {cameraStatus === 'active' && (
              <div className="absolute top-3 right-3 glass rounded-xl px-3 py-1.5 z-10">
                <span className="text-xs font-montserrat font-700 text-cyan-400">{sizeLabel}</span>
              </div>
            )}

            {/* Вспышка */}
            {photoStatus === 'flash' && (
              <div className="absolute inset-0 z-50 pointer-events-none"
                style={{ background: 'rgba(255,255,255,0.85)' }} />
            )}

            <div className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none z-10"
              style={{ background: 'linear-gradient(to top, rgba(8,11,20,0.7), transparent)' }} />
          </div>

          {/* Регуляторы */}
          {cameraStatus === 'active' && (
            <div className="mx-5 mt-3 glass rounded-2xl p-3 animate-scale-in space-y-2 flex-shrink-0">
              <div className="flex items-center gap-3">
                <Icon name="Maximize2" size={15} className="text-purple-400 flex-shrink-0" />
                <div className="flex-1">
                  <div className="flex justify-between text-xs text-white/40 mb-1">
                    <span>{t.size}</span>
                    <span className="text-purple-400 font-600">{sizeLabel}</span>
                  </div>
                  <input type="range" min="0" max="100" value={size}
                    onChange={e => setSize(Number(e.target.value))} className="w-full cursor-pointer" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Icon name="MoveVertical" size={15} className="text-cyan-400 flex-shrink-0" />
                <div className="flex-1">
                  <div className="flex justify-between text-xs text-white/40 mb-1">
                    <span>{t.position}</span>
                    <span className="text-cyan-400 font-600">
                      {posY > 60 ? t.posBelow : posY < 40 ? t.posAbove : t.posCenter}
                    </span>
                  </div>
                  <input type="range" min="0" max="100" value={posY}
                    onChange={e => setPosY(Number(e.target.value))} className="w-full cursor-pointer" />
                </div>
              </div>
            </div>
          )}

          {/* Кнопки действий */}
          {cameraStatus === 'active' && (
            <div className="px-5 mt-3 flex gap-3 animate-slide-in-bottom flex-shrink-0">
              <button onClick={handlePhoto}
                className="flex-shrink-0 w-14 h-12 rounded-2xl flex items-center justify-center transition-all duration-200 active:scale-90"
                style={{
                  background: photoStatus === 'done' ? 'rgba(34,197,94,0.2)' : 'linear-gradient(135deg, #06b6d4, #6366f1)',
                  boxShadow: photoStatus !== 'done' ? '0 0 20px rgba(6,182,212,0.5)' : '0 0 20px rgba(34,197,94,0.4)',
                  border: '2px solid rgba(255,255,255,0.15)',
                }}>
                <Icon name={photoStatus === 'done' ? 'Check' : 'Camera'} size={20} className="text-white" />
              </button>
              <button onClick={handleSave}
                className={`flex-1 py-3 rounded-2xl font-montserrat font-700 text-sm flex items-center justify-center gap-2 transition-all duration-300 ${saved ? 'border text-green-400' : 'btn-primary'}`}
                style={saved ? { background: 'rgba(34,197,94,0.15)', borderColor: 'rgba(34,197,94,0.4)' } : {}}>
                <Icon name={saved ? 'Check' : 'Heart'} size={16} />
                {saved ? t.saved : t.save}
              </button>
              <button className="btn-secondary w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0">
                <Icon name="Share2" size={17} className="text-white/70" />
              </button>
            </div>
          )}

          {photoStatus === 'done' && (
            <p className="text-center text-xs text-cyan-400 mt-2 animate-fade-in-up flex-shrink-0">{t.photoSaved}</p>
          )}

          {/* Подсказка внизу */}
          <div className="mx-5 mt-3 mb-1 flex-shrink-0">
            <div className="glass rounded-xl px-4 py-2.5">
              <p className="text-xs text-white/40 text-center">{t.tips[tipIndex]}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}