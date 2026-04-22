import { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '@/components/ui/icon';

const REMOVE_BG_URL = 'https://functions.poehali.dev/30c6090a-e6b1-43f0-86a9-b216df2359d2';

type CameraStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'error';
type AppStep = 'upload' | 'processing' | 'tryon';
type PhotoStatus = 'idle' | 'flash' | 'done';
type Lang = 'ru' | 'en';

// MediaPipe Pose landmarks индексы
const POSE = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
};

interface Landmark { x: number; y: number; z: number; visibility?: number; }

declare global {
  interface Window {
    Pose: new (config: object) => {
      setOptions: (opts: object) => void;
      onResults: (cb: (results: PoseResults) => void) => void;
      send: (data: { image: HTMLVideoElement }) => Promise<void>;
      close: () => void;
    };
  }
}

interface PoseResults {
  poseLandmarks?: Landmark[];
}

const T = {
  ru: {
    subtitle: 'Примеряй одежду не выходя из дома',
    uploadBtn: 'Загрузить одежду',
    uploadHint: 'Фото куртки, платья, рубашки, обуви...',
    processing: 'Нейросеть вырезает одежду...',
    processingHint: 'remove.bg убирает фон с фотографии',
    startCamera: 'Включить камеру',
    active: '● Нейросеть активна',
    denied: 'Доступ к камере запрещён',
    deniedHint: 'Разреши доступ в настройках браузера',
    error: 'Камера недоступна',
    errorHint: 'Возможно, камера занята другим приложением',
    retry: 'Повторить',
    save: 'Сохранить',
    saved: 'Сохранено!',
    photoSaved: '✓ Фото сохранено',
    changeCloth: 'Сменить',
    detectingPose: 'Ищу тело...',
    poseFound: 'Тело найдено!',
    tips: [
      '💡 Встань прямо, лицом к камере',
      '💡 Отойди на 1–2 метра, чтобы было видно всё тело',
      '💡 Хорошее освещение улучшает точность',
      '💡 Держи телефон на уровне груди',
      '💡 Не двигайся резко — нейросеть обновляется каждый кадр',
    ],
    errBg: 'Не удалось обработать фото. Попробуй другое изображение.',
    noAI: 'Загрузка нейросети...',
  },
  en: {
    subtitle: 'Try on clothes without leaving home',
    uploadBtn: 'Upload clothing',
    uploadHint: 'Photo of jacket, dress, shirt, shoes...',
    processing: 'AI removing background...',
    processingHint: 'remove.bg cuts out the clothing',
    startCamera: 'Start camera',
    active: '● AI active',
    denied: 'Camera access denied',
    deniedHint: 'Allow access in browser settings',
    error: 'Camera unavailable',
    errorHint: 'Another app may be using the camera',
    retry: 'Retry',
    save: 'Save',
    saved: 'Saved!',
    photoSaved: '✓ Photo saved',
    changeCloth: 'Change',
    detectingPose: 'Detecting body...',
    poseFound: 'Body detected!',
    tips: [
      '💡 Stand straight, facing the camera',
      '💡 Step back 1–2 meters so your full body is visible',
      '💡 Good lighting improves accuracy',
      '💡 Hold phone at chest level',
      '💡 Move smoothly — AI updates every frame',
    ],
    errBg: 'Could not process photo. Try a different image.',
    noAI: 'Loading AI model...',
  },
};

interface TryOnProps { lang?: Lang; }

// Интерполяция координат для плавности
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

export default function TryOn({ lang = 'ru' }: TryOnProps) {
  const t = T[lang];

  const [step, setStep] = useState<AppStep>('upload');
  const [clothImage, setClothImage] = useState<string | null>(null);
  const [bgError, setBgError] = useState('');
  const [saved, setSaved] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [scanning, setScanning] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [photoStatus, setPhotoStatus] = useState<PhotoStatus>('idle');
  const [tipIndex, setTipIndex] = useState(0);
  const [poseStatus, setPoseStatus] = useState<'none' | 'detecting' | 'found'>('none');
  const [poseModelReady, setPoseModelReady] = useState(false);

  // Мануальные регуляторы (если поза не найдена)
  const [manualSize, setManualSize] = useState(55);
  const [manualPosY, setManualPosY] = useState(35);
  const [showManual, setShowManual] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const poseRef = useRef<ReturnType<typeof window.Pose> | null>(null);
  const rafRef = useRef<number>(0);
  const clothImgElRef = useRef<HTMLImageElement | null>(null);

  // Плавные текущие координаты наложения (интерполируются для живости)
  const smoothRef = useRef({ x: 0.5, y: 0.25, w: 0.5, h: 0.5, active: false });

  // Подсказки
  useEffect(() => {
    const id = setInterval(() => setTipIndex(i => (i + 1) % t.tips.length), 4000);
    return () => clearInterval(id);
  }, [t.tips.length]);

  // Инициализация MediaPipe Pose
  const initPose = useCallback(() => {
    if (!window.Pose || poseRef.current) return;
    try {
      const pose = new window.Pose({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
      });
      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        smoothSegmentation: false,
        minDetectionConfidence: 0.55,
        minTrackingConfidence: 0.55,
      });
      pose.onResults((results: PoseResults) => {
        const lm = results.poseLandmarks;
        if (!lm || lm.length < 25) {
          setPoseStatus('detecting');
          smoothRef.current.active = false;
          return;
        }

        const ls = lm[POSE.LEFT_SHOULDER];
        const rs = lm[POSE.RIGHT_SHOULDER];
        const lh = lm[POSE.LEFT_HIP];
        const rh = lm[POSE.RIGHT_HIP];

        // Видимость плечей
        const shoulderVis = Math.min(ls.visibility ?? 0, rs.visibility ?? 0);
        if (shoulderVis < 0.3) {
          setPoseStatus('detecting');
          smoothRef.current.active = false;
          return;
        }

        setPoseStatus('found');

        // Центр и размер одежды по скелету
        const centerX = (ls.x + rs.x) / 2;
        const topY = Math.min(ls.y, rs.y) - 0.04; // чуть выше плеч
        const shoulderW = Math.abs(ls.x - rs.x);

        // Высота = от плеч до бёдер (если видны)
        const hipVis = Math.min(lh.visibility ?? 0, rh.visibility ?? 0);
        const bodyH = hipVis > 0.3
          ? Math.abs(((lh.y + rh.y) / 2) - topY) + 0.06
          : shoulderW * 1.4;

        // Ширина одежды = ширина плеч × коэффициент (одежда шире тела)
        const clothW = shoulderW * 1.55;

        // Плавная интерполяция
        const s = smoothRef.current;
        const speed = s.active ? 0.18 : 0.6; // быстро при первом появлении
        s.x = lerp(s.x, centerX - clothW / 2, speed);
        s.y = lerp(s.y, topY, speed);
        s.w = lerp(s.w, clothW, speed);
        s.h = lerp(s.h, bodyH, speed);
        s.active = true;
      });
      poseRef.current = pose;
      setPoseModelReady(true);
    } catch { /* MediaPipe ещё не загружен */ }
  }, []);

  // Ждём загрузки MediaPipe
  useEffect(() => {
    const check = () => {
      if (window.Pose) { initPose(); }
      else { setTimeout(check, 300); }
    };
    check();
    return () => { poseRef.current?.close(); poseRef.current = null; };
  }, [initPose]);

  // Камера
  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(tr => tr.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    smoothRef.current.active = false;
    setPoseStatus('none');
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
      setPoseStatus('detecting');
      setTimeout(() => setScanning(false), 1200);
    } catch (err: unknown) {
      stopCamera();
      const e = err as { name?: string };
      setCameraStatus(e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError' ? 'denied' : 'error');
      setScanning(false);
    }
  }, [stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // Главный цикл рендера — pose + наложение на canvas
  useEffect(() => {
    if (cameraStatus !== 'active' || !clothImgElRef.current) return;

    const video = videoRef.current;
    const canvas = overlayCanvasRef.current;
    if (!video || !canvas) return;

    let frameCount = 0;
    const POSE_EVERY = 3; // отправляем в pose каждые 3 кадра

    const render = async () => {
      rafRef.current = requestAnimationFrame(render);

      if (video.readyState < 2) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;

      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, vw, vh);

      // Отправляем кадр в MediaPipe Pose
      if (poseRef.current && frameCount % POSE_EVERY === 0) {
        try { await poseRef.current.send({ image: video }); } catch { /* ignore */ }
      }
      frameCount++;

      const clothEl = clothImgElRef.current;
      if (!clothEl || !clothEl.complete) return;

      const s = smoothRef.current;
      let cx: number, cy: number, cw: number, ch: number;

      if (s.active && poseStatus !== 'none') {
        // Позиция из нейросети (координаты 0–1 → пиксели)
        cw = s.w * vw;
        ch = s.h * vh;
        cx = s.x * vw;
        cy = s.y * vh;
      } else {
        // Ручное управление
        cw = vw * (0.35 + manualSize * 0.005);
        ch = cw * (clothEl.naturalHeight / clothEl.naturalWidth);
        cx = (vw - cw) / 2;
        cy = vh * (manualPosY / 100);
      }

      // Сохраняем пропорции одежды
      const aspectRatio = clothEl.naturalWidth / clothEl.naturalHeight;
      const targetH = cw / aspectRatio;

      // Тень под одеждой
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.filter = 'blur(8px)';
      ctx.drawImage(clothEl, cx + cw * 0.1, cy + targetH * 0.85, cw * 0.8, targetH * 0.12);
      ctx.restore();

      // Одежда с лёгким покачиванием
      const swayAngle = Math.sin(Date.now() / 1800) * 0.018;
      ctx.save();
      ctx.translate(cx + cw / 2, cy);
      ctx.rotate(swayAngle);
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 20;
      ctx.shadowOffsetY = 8;
      ctx.drawImage(clothEl, -cw / 2, 0, cw, targetH);
      ctx.restore();
    };

    render();
    return () => cancelAnimationFrame(rafRef.current);
  }, [cameraStatus, poseStatus, manualSize, manualPosY]);

  // Загрузка фото
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBgError('');
    setStep('processing');

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const b64 = ev.target?.result as string;
      try {
        const res = await fetch(REMOVE_BG_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: b64 }),
        });
        const data = await res.json();
        if (data.ok && data.image) {
          setClothImage(data.image);
          const img = new Image();
          img.src = data.image;
          img.onload = () => { clothImgElRef.current = img; };
          clothImgElRef.current = img;
          setStep('tryon');
          setCameraStatus('idle');
          smoothRef.current.active = false;
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
    e.target.value = '';
  };

  const handleFlip = () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    startCamera(next);
  };

  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const handlePhoto = useCallback(() => {
    const video = videoRef.current;
    const overlay = overlayCanvasRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Зеркалим для фронтальной
    if (facingMode === 'user') { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, w, h);
    if (facingMode === 'user') ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Накладываем одежду из overlay canvas
    if (overlay) ctx.drawImage(overlay, 0, 0, w, h);

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
  }, [facingMode]);

  const sizeLabel = manualSize < 30 ? 'XS' : manualSize < 46 ? 'S' : manualSize < 62 ? 'M' : manualSize < 78 ? 'L' : 'XL';

  return (
    <div className="flex flex-col h-full relative">
      <canvas ref={canvasRef} className="hidden" />
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

      {/* Заголовок */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between animate-fade-in-up flex-shrink-0">
        <div>
          <h1 className="font-montserrat font-900 text-2xl text-white leading-tight">
            {lang === 'ru' ? <>AR <span className="text-gradient">Примерочная</span></> : <><span className="text-gradient">AR</span> Fitting</>}
          </h1>
          <p className="text-xs mt-0.5" style={{
            color: poseStatus === 'found' ? '#4ade80' : poseStatus === 'detecting' ? '#facc15' : 'rgba(255,255,255,0.4)'
          }}>
            {step === 'tryon' && cameraStatus === 'active'
              ? poseStatus === 'found' ? t.active
              : poseStatus === 'detecting' ? t.detectingPose
              : t.subtitle
              : t.subtitle}
          </p>
        </div>
        <div className="flex gap-2">
          {step === 'tryon' && cameraStatus === 'active' && (
            <button onClick={() => setShowManual(v => !v)}
              className="glass rounded-2xl p-2.5"
              title="Ручное управление">
              <Icon name="SlidersHorizontal" size={16} className="text-white/50" />
            </button>
          )}
          {step === 'tryon' && (
            <button
              onClick={() => { stopCamera(); setStep('upload'); setClothImage(null); setCameraStatus('idle'); setPoseStatus('none'); }}
              className="glass rounded-2xl px-3 py-2 flex items-center gap-1.5">
              <Icon name="Upload" size={13} className="text-purple-400" />
              <span className="text-xs text-white/60 font-600">{t.changeCloth}</span>
            </button>
          )}
        </div>
      </div>

      {/* ШАГ 1: Загрузка */}
      {step === 'upload' && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-5 animate-scale-in pb-16">
          <div className="relative">
            <div className="w-36 h-36 rounded-3xl glass flex items-center justify-center animate-float"
              style={{ border: '2px solid rgba(168,85,247,0.4)' }}>
              <span className="text-6xl">👗</span>
            </div>
            {/* Нейросеть-индикатор */}
            <div className="absolute -bottom-2 -right-2 glass rounded-xl px-2 py-1 flex items-center gap-1"
              style={{ border: '1px solid rgba(6,182,212,0.4)' }}>
              <div className={`w-1.5 h-1.5 rounded-full ${poseModelReady ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
              <span className="text-xs text-white/50">{poseModelReady ? 'AI ready' : t.noAI}</span>
            </div>
          </div>

          <div className="text-center">
            <h2 className="font-montserrat font-800 text-xl text-white mb-1">{t.uploadBtn}</h2>
            <p className="text-sm text-white/40">{t.uploadHint}</p>
          </div>

          {bgError && (
            <div className="glass rounded-2xl px-4 py-3 w-full text-center"
              style={{ border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
              {bgError}
            </div>
          )}

          <button onClick={() => fileInputRef.current?.click()}
            className="btn-primary px-8 py-4 font-montserrat font-700 text-base flex items-center gap-3 rounded-2xl w-full justify-center">
            <Icon name="ImagePlus" size={22} className="text-white" />
            {t.uploadBtn}
          </button>

          <p className="text-xs text-white/20 text-center">
            {lang === 'ru' ? 'ИИ уберёт фон → нейросеть наденет одежду на тебя' : 'AI removes background → neural net fits clothing on you'}
          </p>

          {/* Подсказка */}
          <div className="absolute bottom-3 left-4 right-4">
            <div className="glass rounded-xl px-4 py-2.5 text-center">
              <p className="text-xs text-white/40">{t.tips[tipIndex]}</p>
            </div>
          </div>
        </div>
      )}

      {/* ШАГ 2: Обработка */}
      {step === 'processing' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 animate-scale-in">
          <div className="relative w-28 h-28">
            <div className="absolute inset-0 rounded-full border-2 border-purple-500/20 border-t-purple-500 animate-spin" />
            <div className="absolute inset-3 rounded-full border-2 border-cyan-500/20 border-b-cyan-400 animate-spin"
              style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
            <div className="absolute inset-0 flex items-center justify-center text-3xl">✂️</div>
          </div>
          <div className="text-center px-8">
            <p className="font-montserrat font-700 text-white text-lg">{t.processing}</p>
            <p className="text-sm text-white/40 mt-1">{t.processingHint}</p>
          </div>
          <div className="flex gap-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"
                style={{ animationDelay: `${i * 0.25}s` }} />
            ))}
          </div>
        </div>
      )}

      {/* ШАГ 3: Примерка */}
      {step === 'tryon' && (
        <>
          {/* AR Вьюпорт */}
          <div className="mx-5 relative rounded-3xl overflow-hidden flex-shrink-0" style={{ height: '330px' }}>

            {/* Видео с камеры */}
            <video ref={videoRef} playsInline muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{
                transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
                display: cameraStatus === 'active' ? 'block' : 'none',
              }}
            />

            {/* Overlay canvas — одежда рендерится сюда нейросетью */}
            <canvas ref={overlayCanvasRef}
              className="absolute inset-0 w-full h-full"
              style={{
                transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
                display: cameraStatus === 'active' ? 'block' : 'none',
                objectFit: 'cover',
                pointerEvents: 'none',
              }}
            />

            {/* Фон когда камера не активна */}
            {cameraStatus !== 'active' && (
              <div className="absolute inset-0"
                style={{ background: 'linear-gradient(160deg, #0f1729 0%, #1a0f2e 50%, #0d1a2e 100%)' }}>
                <div className="absolute inset-0 opacity-10"
                  style={{ backgroundImage: 'linear-gradient(rgba(6,182,212,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.5) 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
              </div>
            )}

            {/* AR уголки */}
            <div className="ar-corner ar-corner-tl animate-ar-pulse" />
            <div className="ar-corner ar-corner-tr animate-ar-pulse" />
            <div className="ar-corner ar-corner-bl animate-ar-pulse" />
            <div className="ar-corner ar-corner-br animate-ar-pulse" />

            {/* Линия сканирования */}
            {scanning && (
              <div className="absolute left-0 right-0 h-0.5 animate-ar-scan z-10"
                style={{ background: 'linear-gradient(90deg, transparent, #06b6d4, transparent)' }} />
            )}

            {/* Статус нейросети поверх камеры */}
            {cameraStatus === 'active' && (
              <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 glass rounded-xl px-2.5 py-1.5">
                <div className={`w-2 h-2 rounded-full ${poseStatus === 'found' ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
                <span className="text-xs font-600" style={{ color: poseStatus === 'found' ? '#4ade80' : '#facc15' }}>
                  {poseStatus === 'found' ? (lang === 'ru' ? 'Поза найдена' : 'Pose found') : (lang === 'ru' ? 'Поиск...' : 'Searching...')}
                </span>
              </div>
            )}

            {/* Кнопка переключения камеры */}
            {cameraStatus === 'active' && (
              <button onClick={handleFlip}
                className="absolute top-3 right-3 glass rounded-xl p-2 z-20 transition-all hover:scale-110 active:scale-95">
                <Icon name="RefreshCw" size={15} className="text-white/70" />
              </button>
            )}

            {/* Превью одежды + кнопка старта (камера не активна) */}
            {clothImage && cameraStatus !== 'active' && cameraStatus !== 'requesting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10">
                <img src={clothImage} alt="" className="w-28 object-contain animate-float"
                  style={{ filter: 'drop-shadow(0 0 20px rgba(168,85,247,0.7))' }} />
                <button onClick={() => startCamera(facingMode)}
                  className="btn-primary px-5 py-3 font-montserrat font-700 text-sm flex items-center gap-2 rounded-xl">
                  <Icon name="Camera" size={16} className="text-white" />
                  {t.startCamera}
                </button>
              </div>
            )}

            {cameraStatus === 'requesting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
                <div className="w-10 h-10 rounded-full border-2 border-purple-500/30 border-t-purple-500 animate-spin" />
                <p className="text-white/50 text-sm">{lang === 'ru' ? 'Запрашиваю камеру...' : 'Requesting camera...'}</p>
              </div>
            )}

            {cameraStatus === 'denied' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center z-10">
                <Icon name="CameraOff" size={28} className="text-red-400" />
                <p className="text-white/70 text-sm font-600">{t.denied}</p>
                <p className="text-white/30 text-xs">{t.deniedHint}</p>
                <button onClick={() => startCamera(facingMode)} className="btn-secondary px-4 py-2 text-sm rounded-xl">{t.retry}</button>
              </div>
            )}

            {cameraStatus === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center z-10">
                <Icon name="AlertTriangle" size={28} className="text-orange-400" />
                <p className="text-white/70 text-sm font-600">{t.error}</p>
                <p className="text-white/30 text-xs">{t.errorHint}</p>
                <button onClick={() => startCamera(facingMode)} className="btn-secondary px-4 py-2 text-sm rounded-xl">{t.retry}</button>
              </div>
            )}

            {/* Вспышка фото */}
            {photoStatus === 'flash' && (
              <div className="absolute inset-0 z-50 pointer-events-none"
                style={{ background: 'rgba(255,255,255,0.9)' }} />
            )}

            <div className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none z-10"
              style={{ background: 'linear-gradient(to top, rgba(8,11,20,0.6), transparent)' }} />
          </div>

          {/* Ручные регуляторы (когда поза не найдена или пользователь открыл) */}
          {cameraStatus === 'active' && (showManual || poseStatus !== 'found') && (
            <div className="mx-5 mt-3 glass rounded-2xl p-3 animate-scale-in space-y-2 flex-shrink-0">
              <p className="text-xs text-white/30 text-center mb-1">
                {lang === 'ru' ? 'Ручная настройка' : 'Manual adjustment'}
              </p>
              <div className="flex items-center gap-3">
                <Icon name="Maximize2" size={14} className="text-purple-400 flex-shrink-0" />
                <div className="flex-1">
                  <div className="flex justify-between text-xs text-white/40 mb-1">
                    <span>{lang === 'ru' ? 'Размер' : 'Size'}</span>
                    <span className="text-purple-400 font-600">{sizeLabel}</span>
                  </div>
                  <input type="range" min="10" max="100" value={manualSize}
                    onChange={e => setManualSize(Number(e.target.value))} className="w-full cursor-pointer" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Icon name="MoveVertical" size={14} className="text-cyan-400 flex-shrink-0" />
                <div className="flex-1">
                  <div className="flex justify-between text-xs text-white/40 mb-1">
                    <span>{lang === 'ru' ? 'Положение' : 'Position'}</span>
                    <span className="text-cyan-400 font-600">{manualPosY < 30 ? (lang === 'ru' ? 'Выше' : 'Up') : manualPosY > 60 ? (lang === 'ru' ? 'Ниже' : 'Down') : (lang === 'ru' ? 'Центр' : 'Center')}</span>
                  </div>
                  <input type="range" min="5" max="80" value={manualPosY}
                    onChange={e => setManualPosY(Number(e.target.value))} className="w-full cursor-pointer" />
                </div>
              </div>
            </div>
          )}

          {/* Кнопки */}
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

          {/* Подсказка */}
          <div className="mx-5 mt-3 mb-1 flex-shrink-0">
            <div className="glass rounded-xl px-4 py-2.5">
              <p className="text-xs text-white/35 text-center">{t.tips[tipIndex]}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
