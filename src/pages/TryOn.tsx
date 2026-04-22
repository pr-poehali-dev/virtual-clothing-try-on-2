import { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '@/components/ui/icon';

const REMOVE_BG_URL = 'https://functions.poehali.dev/30c6090a-e6b1-43f0-86a9-b216df2359d2';

type CameraStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'error';
type AppStep = 'upload' | 'processing' | 'tryon';
type PhotoStatus = 'idle' | 'flash' | 'done';
type Lang = 'ru' | 'en';

const T = {
  ru: {
    subtitle: 'Примеряй одежду не выходя из дома',
    uploadBtn: 'Загрузить одежду',
    uploadHint: 'Фото куртки, платья, рубашки, обуви...',
    processing: 'Нейросеть вырезает одежду...',
    processingHint: 'remove.bg убирает фон с фотографии',
    startCamera: 'Включить камеру',
    denied: 'Доступ к камере запрещён',
    deniedHint: 'Разреши доступ в настройках браузера',
    error: 'Камера недоступна',
    errorHint: 'Возможно, камера занята другим приложением',
    retry: 'Повторить',
    save: 'Сохранить',
    saved: 'Сохранено!',
    photoSaved: '✓ Фото сохранено',
    changeCloth: 'Сменить',
    poseFound: '● Тело найдено',
    poseSearch: '○ Поиск тела...',
    manualMode: 'Ручная настройка',
    size: 'Размер',
    position: 'Положение',
    errBg: 'Не удалось обработать фото. Попробуй другое изображение.',
    aiHint: 'ИИ уберёт фон → нейросеть наденет одежду на тебя',
    tips: [
      '💡 Встань прямо, лицом к камере',
      '💡 Отойди на 1–2 метра — тело должно быть видно целиком',
      '💡 Хорошее освещение улучшает точность',
      '💡 Держи телефон на уровне груди',
      '💡 Двигайся плавно — нейросеть обновляется каждый кадр',
    ],
  },
  en: {
    subtitle: 'Try on clothes without leaving home',
    uploadBtn: 'Upload clothing',
    uploadHint: 'Photo of jacket, dress, shirt, shoes...',
    processing: 'AI removing background...',
    processingHint: 'remove.bg cuts out the clothing',
    startCamera: 'Start camera',
    denied: 'Camera access denied',
    deniedHint: 'Allow access in browser settings',
    error: 'Camera unavailable',
    errorHint: 'Another app may be using the camera',
    retry: 'Retry',
    save: 'Save',
    saved: 'Saved!',
    photoSaved: '✓ Photo saved',
    changeCloth: 'Change',
    poseFound: '● Body found',
    poseSearch: '○ Searching...',
    manualMode: 'Manual adjustment',
    size: 'Size',
    position: 'Position',
    errBg: 'Could not process photo. Try a different image.',
    aiHint: 'AI removes background → neural net fits clothing on you',
    tips: [
      '💡 Stand straight, facing the camera',
      '💡 Step back 1–2 m so your full body is visible',
      '💡 Good lighting improves accuracy',
      '💡 Hold phone at chest level',
      '💡 Move smoothly — AI updates every frame',
    ],
  },
};

interface TryOnProps { lang?: Lang; }

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

export default function TryOn({ lang = 'ru' }: TryOnProps) {
  const t = T[lang];

  const [step, setStep] = useState<AppStep>('upload');
  const [clothImage, setClothImage] = useState<string | null>(null);
  const [bgError, setBgError] = useState('');
  const [saved, setSaved] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [photoStatus, setPhotoStatus] = useState<PhotoStatus>('idle');
  const [tipIndex, setTipIndex] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [manualSize, setManualSize] = useState(55);
  const [manualPosY, setManualPosY] = useState(30);
  const [poseFoundUI, setPoseFoundUI] = useState(false);

  // Refs — не вызывают ре-рендер, безопасны в RAF
  const poseActiveRef = useRef(false);
  const poseResultRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const smooth = useRef({ cx: 0.5, cy: 0.15, cw: 0.55, ch: 0.6, ready: false });
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const clothImgRef = useRef<HTMLImageElement | null>(null);
  const facingModeRef = useRef(facingMode);
  const manualSizeRef = useRef(manualSize);
  const manualPosYRef = useRef(manualPosY);

  // Синхронизируем refs со state
  useEffect(() => { facingModeRef.current = facingMode; }, [facingMode]);
  useEffect(() => { manualSizeRef.current = manualSize; }, [manualSize]);
  useEffect(() => { manualPosYRef.current = manualPosY; }, [manualPosY]);

  // Подсказки
  useEffect(() => {
    const id = setInterval(() => setTipIndex(i => (i + 1) % t.tips.length), 4000);
    return () => clearInterval(id);
  }, [t.tips.length]);

  // Камера
  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(tr => tr.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    poseActiveRef.current = false;
    poseResultRef.current = null;
    smooth.current.ready = false;
    setPoseFoundUI(false);
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
      const video = videoRef.current;
      if (video) { video.srcObject = stream; await video.play(); }
      setCameraStatus('active');
      setTimeout(() => setScanning(false), 1200);
    } catch (err: unknown) {
      stopCamera();
      const e = err as { name?: string };
      setCameraStatus(e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError' ? 'denied' : 'error');
      setScanning(false);
    }
  }, [stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // MediaPipe Pose — запускаем когда камера активна
  useEffect(() => {
    if (cameraStatus !== 'active') return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const W = window as any;
    if (!W.Pose) return; // MediaPipe ещё не загружен — ничего страшного, работает ручной режим

    let pose: { send: (d: { image: HTMLVideoElement }) => Promise<void>; close: () => void } | null = null;
    let destroyed = false;

    try {
      pose = new W.Pose({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
      });

      pose!.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pose as any).onResults((results: any) => {
        if (destroyed) return;
        const lm = results.poseLandmarks;
        if (!lm || lm.length < 25) {
          poseActiveRef.current = false;
          poseResultRef.current = null;
          setPoseFoundUI(false);
          return;
        }
        const ls = lm[11]; const rs = lm[12];
        const lh = lm[23]; const rh = lm[24];
        if ((ls.visibility ?? 0) < 0.3 || (rs.visibility ?? 0) < 0.3) {
          poseActiveRef.current = false;
          poseResultRef.current = null;
          setPoseFoundUI(false);
          return;
        }
        const shoulderW = Math.abs(ls.x - rs.x);
        const topY = Math.min(ls.y, rs.y) - 0.05;
        const clothW = shoulderW * 1.6;
        const centerX = (ls.x + rs.x) / 2 - clothW / 2;
        const hVis = Math.min(lh.visibility ?? 0, rh.visibility ?? 0);
        const bodyH = hVis > 0.25
          ? Math.abs(((lh.y + rh.y) / 2) - topY) + 0.08
          : shoulderW * 1.5;

        poseResultRef.current = { x: centerX, y: topY, w: clothW, h: bodyH };
        poseActiveRef.current = true;
        setPoseFoundUI(true);
      });
    } catch {
      return; // MediaPipe недоступен — работаем в ручном режиме
    }

    const video = videoRef.current;
    const poseInterval = setInterval(async () => {
      if (destroyed || !video || video.readyState < 2 || !streamRef.current) return;
      try { await pose!.send({ image: video }); } catch { /* ignore */ }
    }, 120);

    return () => {
      destroyed = true;
      clearInterval(poseInterval);
      try { pose?.close(); } catch { /* ignore */ }
    };
  }, [cameraStatus]);

  // RAF цикл — рисует одежду на overlay canvas
  useEffect(() => {
    if (cameraStatus !== 'active') return;

    const video = videoRef.current;
    const canvas = overlayCanvasRef.current;
    if (!video || !canvas) return;

    const render = () => {
      rafRef.current = requestAnimationFrame(render);
      if (video.readyState < 2) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;
      if (canvas.width !== vw) canvas.width = vw;
      if (canvas.height !== vh) canvas.height = vh;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, vw, vh);

      const clothEl = clothImgRef.current;
      if (!clothEl?.complete || !clothEl.naturalWidth) return;

      let tx: number, ty: number, tw: number;

      const pr = poseResultRef.current;
      if (pr && poseActiveRef.current) {
        const s = smooth.current;
        const speed = s.ready ? 0.14 : 0.7;
        s.cx = lerp(s.cx, pr.x, speed);
        s.cy = lerp(s.cy, pr.y, speed);
        s.cw = lerp(s.cw, pr.w, speed);
        s.ch = lerp(s.ch, pr.h, speed);
        s.ready = true;

        // canvas зеркалится через CSS transform — поэтому X не инвертируем
        tw = s.cw * vw;
        tx = s.cx * vw;
        ty = s.cy * vh;
      } else {
        tw = vw * (0.3 + manualSizeRef.current * 0.005);
        tx = (vw - tw) / 2;
        ty = vh * (manualPosYRef.current / 100);
      }

      const aspect = clothEl.naturalWidth / clothEl.naturalHeight;
      const drawH = tw / aspect;
      const sway = Math.sin(Date.now() / 1800) * 0.013;

      // Мягкая тень под одеждой
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.filter = 'blur(10px)';
      ctx.drawImage(clothEl, tx + tw * 0.1, ty + drawH * 0.92, tw * 0.8, drawH * 0.1);
      ctx.restore();

      // Одежда с покачиванием
      ctx.save();
      ctx.translate(tx + tw / 2, ty);
      ctx.rotate(sway);
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 5;
      ctx.drawImage(clothEl, -tw / 2, 0, tw, drawH);
      ctx.restore();
    };

    render();
    return () => cancelAnimationFrame(rafRef.current);
  }, [cameraStatus]); // только cameraStatus — всё остальное через refs

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
          const img = new Image();
          img.onload = () => { clothImgRef.current = img; };
          img.src = data.image;
          setClothImage(data.image);
          setStep('tryon');
          setCameraStatus('idle');
          smooth.current.ready = false;
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
    poseResultRef.current = null;
    smooth.current.ready = false;
    startCamera(next);
  };

  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const handlePhoto = useCallback(() => {
    const video = videoRef.current;
    const overlay = overlayCanvasRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const mirrored = facingModeRef.current === 'user';
    if (mirrored) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, w, h);
    if (mirrored) { ctx.translate(w, 0); ctx.scale(-1, 1); } // reset
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // overlay canvas тоже зеркалится через CSS — рисуем его зеркально
    if (overlay) {
      if (mirrored) { ctx.translate(w, 0); ctx.scale(-1, 1); }
      ctx.drawImage(overlay, 0, 0, w, h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    setPhotoStatus('flash');
    setTimeout(() => setPhotoStatus('done'), 180);
    setTimeout(() => setPhotoStatus('idle'), 2500);
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `fitar-${Date.now()}.jpg`; a.click();
      URL.revokeObjectURL(url);
    }, 'image/jpeg', 0.92);
  }, []);

  const sizeLabel = manualSize < 30 ? 'XS' : manualSize < 46 ? 'S' : manualSize < 62 ? 'M' : manualSize < 78 ? 'L' : 'XL';

  const resetToUpload = () => {
    stopCamera();
    setStep('upload');
    setClothImage(null);
    setCameraStatus('idle');
    clothImgRef.current = null;
    poseResultRef.current = null;
  };

  return (
    <div className="flex flex-col h-full relative">
      <canvas ref={captureCanvasRef} className="hidden" />
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

      {/* Заголовок */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between flex-shrink-0 animate-fade-in-up">
        <div>
          <h1 className="font-montserrat font-900 text-2xl text-white leading-tight">
            {lang === 'ru' ? <>AR <span className="text-gradient">Примерочная</span></> : <><span className="text-gradient">AR</span> Fitting</>}
          </h1>
          <p className="text-xs mt-0.5 transition-colors duration-500"
            style={{ color: poseFoundUI ? '#4ade80' : 'rgba(255,255,255,0.4)' }}>
            {cameraStatus === 'active' ? (poseFoundUI ? t.poseFound : t.poseSearch) : t.subtitle}
          </p>
        </div>
        {step === 'tryon' && (
          <button onClick={resetToUpload} className="glass rounded-2xl px-3 py-2 flex items-center gap-1.5">
            <Icon name="Upload" size={13} className="text-purple-400" />
            <span className="text-xs text-white/60 font-600">{t.changeCloth}</span>
          </button>
        )}
      </div>

      {/* ШАГ 1: Загрузка */}
      {step === 'upload' && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-5 animate-scale-in pb-16">
          <div className="w-36 h-36 rounded-3xl glass flex items-center justify-center animate-float"
            style={{ border: '2px solid rgba(168,85,247,0.4)' }}>
            <span className="text-6xl">👗</span>
          </div>
          <div className="text-center">
            <h2 className="font-montserrat font-800 text-xl text-white mb-1">{t.uploadBtn}</h2>
            <p className="text-sm text-white/40">{t.uploadHint}</p>
          </div>
          {bgError && (
            <div className="glass rounded-2xl px-4 py-3 w-full text-center text-sm"
              style={{ border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
              {bgError}
            </div>
          )}
          <button onClick={() => fileInputRef.current?.click()}
            className="btn-primary px-8 py-4 font-montserrat font-700 text-base flex items-center gap-3 rounded-2xl w-full justify-center">
            <Icon name="ImagePlus" size={22} className="text-white" />
            {t.uploadBtn}
          </button>
          <p className="text-xs text-white/20 text-center">{t.aiHint}</p>
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
              style={{ animationDirection: 'reverse', animationDuration: '1.4s' }} />
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
          <div className="mx-5 relative rounded-3xl overflow-hidden flex-shrink-0" style={{ height: '320px' }}>
            {/* Видео */}
            <video ref={videoRef} playsInline muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none', display: cameraStatus === 'active' ? 'block' : 'none' }}
            />
            {/* Overlay canvas — зеркалится вместе с видео */}
            <canvas ref={overlayCanvasRef}
              className="absolute inset-0 w-full h-full"
              style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none', display: cameraStatus === 'active' ? 'block' : 'none', pointerEvents: 'none' }}
            />

            {/* Фон */}
            {cameraStatus !== 'active' && (
              <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #0f1729 0%, #1a0f2e 50%, #0d1a2e 100%)' }}>
                <div className="absolute inset-0 opacity-10"
                  style={{ backgroundImage: 'linear-gradient(rgba(6,182,212,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.5) 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
              </div>
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

            {/* Pose статус */}
            {cameraStatus === 'active' && (
              <div className="absolute bottom-3 left-3 z-20 glass rounded-xl px-2.5 py-1.5 flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${poseFoundUI ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
                <span className="text-xs font-600" style={{ color: poseFoundUI ? '#4ade80' : '#facc15' }}>
                  {poseFoundUI ? t.poseFound : t.poseSearch}
                </span>
              </div>
            )}

            {/* Flip */}
            {cameraStatus === 'active' && (
              <button onClick={handleFlip} className="absolute top-3 right-3 glass rounded-xl p-2 z-20 active:scale-90 transition-transform">
                <Icon name="RefreshCw" size={15} className="text-white/70" />
              </button>
            )}

            {/* Превью + старт */}
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
                <p className="text-white/50 text-sm">{lang === 'ru' ? 'Запрашиваю камеру...' : 'Starting camera...'}</p>
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

            {photoStatus === 'flash' && <div className="absolute inset-0 z-50 pointer-events-none bg-white/90" />}

            <div className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none z-10"
              style={{ background: 'linear-gradient(to top, rgba(8,11,20,0.5), transparent)' }} />
          </div>

          {/* Ручные регуляторы */}
          {cameraStatus === 'active' && (
            <div className="mx-5 mt-3 glass rounded-2xl p-3 space-y-2 flex-shrink-0">
              <p className="text-xs text-white/30 text-center">
                {poseFoundUI ? (lang === 'ru' ? 'Нейросеть управляет · коррекция вручную' : 'AI tracking · manual correction') : t.manualMode}
              </p>
              <div className="flex items-center gap-3">
                <Icon name="Maximize2" size={14} className="text-purple-400 flex-shrink-0" />
                <div className="flex-1">
                  <div className="flex justify-between text-xs text-white/40 mb-1">
                    <span>{t.size}</span>
                    <span className="text-purple-400 font-600">{sizeLabel}</span>
                  </div>
                  <input type="range" min="10" max="100" value={manualSize}
                    onChange={e => { setManualSize(Number(e.target.value)); poseResultRef.current = null; smooth.current.ready = false; }}
                    className="w-full cursor-pointer" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Icon name="MoveVertical" size={14} className="text-cyan-400 flex-shrink-0" />
                <div className="flex-1">
                  <div className="flex justify-between text-xs text-white/40 mb-1">
                    <span>{t.position}</span>
                    <span className="text-cyan-400 font-600">
                      {manualPosY < 25 ? (lang === 'ru' ? 'Выше' : 'Up') : manualPosY > 55 ? (lang === 'ru' ? 'Ниже' : 'Down') : (lang === 'ru' ? 'Центр' : 'Center')}
                    </span>
                  </div>
                  <input type="range" min="5" max="80" value={manualPosY}
                    onChange={e => { setManualPosY(Number(e.target.value)); poseResultRef.current = null; smooth.current.ready = false; }}
                    className="w-full cursor-pointer" />
                </div>
              </div>
            </div>
          )}

          {/* Кнопки */}
          {cameraStatus === 'active' && (
            <div className="px-5 mt-3 flex gap-3 flex-shrink-0">
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
            <p className="text-center text-xs text-cyan-400 mt-2 flex-shrink-0 animate-fade-in-up">{t.photoSaved}</p>
          )}

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
