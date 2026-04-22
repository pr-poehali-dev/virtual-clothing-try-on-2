import { useState, useRef, useCallback, useEffect } from 'react';
import Icon from '@/components/ui/icon';

const TRYON_URL = 'https://functions.poehali.dev/10335c79-d4db-4298-ad61-f7d9b5de3a10';

type Step = 'upload_person' | 'upload_garment' | 'generating' | 'result';
type Category = 'tops' | 'bottoms' | 'one-pieces';
type Lang = 'ru' | 'en';

interface TryOnProps { lang?: Lang; }

const CATEGORIES: { key: Category; label: string; icon: string }[] = [
  { key: 'tops', label: 'Верх', icon: 'Shirt' },
  { key: 'bottoms', label: 'Низ', icon: 'PersonStanding' },
  { key: 'one-pieces', label: 'Платье', icon: 'Sparkles' },
];

function compressAndBase64(file: File, maxSize = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        if (width > height) { height = Math.round(height * maxSize / width); width = maxSize; }
        else { width = Math.round(width * maxSize / height); height = maxSize; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function fileToUrl(file: File): string {
  return URL.createObjectURL(file);
}

export default function TryOn({ lang = 'ru' }: TryOnProps) {
  const [step, setStep] = useState<Step>('upload_person');
  const [personPreview, setPersonPreview] = useState<string | null>(null);
  const [personBase64, setPersonBase64] = useState<string | null>(null);
  const [garmentPreview, setGarmentPreview] = useState<string | null>(null);
  const [garmentBase64, setGarmentBase64] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>('tops');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [saved, setSaved] = useState(false);
  const [rotate3d, setRotate3d] = useState({ x: 0, y: 0 });
  const [isDragging3d, setIsDragging3d] = useState(false);
  const drag3dStart = useRef({ x: 0, y: 0, rx: 0, ry: 0 });
  const personInputRef = useRef<HTMLInputElement>(null);
  const garmentInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handlePersonUpload = useCallback(async (file: File) => {
    const url = fileToUrl(file);
    setPersonPreview(url);
    setError(null);
    try {
      const b64 = await compressAndBase64(file, 1024);
      setPersonBase64(b64);
      setTimeout(() => setStep('upload_garment'), 400);
    } catch {
      setError('Не удалось загрузить фото. Попробуй выбрать другое.');
    }
  }, []);

  const handleGarmentUpload = useCallback(async (file: File) => {
    const url = fileToUrl(file);
    setGarmentPreview(url);
    setError(null);
    try {
      const b64 = await compressAndBase64(file, 1024);
      setGarmentBase64(b64);
    } catch {
      setError('Не удалось загрузить фото одежды. Попробуй другое.');
    }
  }, []);

  const startGeneration = useCallback(async () => {
    if (!personBase64 || !garmentBase64) return;
    setStep('generating');
    setError(null);
    setProgress(5);

    const prog = setInterval(() => {
      setProgress(p => p < 85 ? p + Math.random() * 4 : p);
    }, 800);

    try {
      const resp = await fetch(TRYON_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'run',
          model_image: personBase64,
          garment_image: garmentBase64,
          category,
        }),
      });
      const data = await resp.json();

      if (!resp.ok || !data.id) {
        throw new Error(data.error || 'Ошибка запуска примерки');
      }

      const predId = data.id;
      const sessionHash = data.session_hash || predId;

      pollRef.current = setInterval(async () => {
        const statusResp = await fetch(TRYON_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status', id: predId, session_hash: sessionHash }),
        });
        const statusData = await statusResp.json();

        if (statusData.status === 'completed' && statusData.result_url) {
          clearInterval(pollRef.current!);
          clearInterval(prog);
          setProgress(100);
          setTimeout(() => {
            setResultUrl(statusData.result_url);
            setStep('result');
            setRotate3d({ x: 0, y: 0 });
          }, 400);
        } else if (statusData.status === 'failed' || statusData.error) {
          clearInterval(pollRef.current!);
          clearInterval(prog);
          setError(statusData.error || 'Генерация не удалась. Попробуй другое фото.');
          setStep('upload_person');
        }
      }, 2000);

    } catch (e: unknown) {
      clearInterval(prog);
      setError(e instanceof Error ? e.message : 'Произошла ошибка');
      setStep('upload_person');
    }
  }, [personBase64, garmentBase64, category]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleSave = useCallback(async () => {
    if (!resultUrl) return;
    try {
      const resp = await fetch(TRYON_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', image_url: resultUrl }),
      });
      const data = await resp.json();
      if (data.saved_url) {
        const saved_items = JSON.parse(localStorage.getItem('tryon_history') || '[]');
        saved_items.unshift({ url: data.saved_url, date: new Date().toISOString() });
        localStorage.setItem('tryon_history', JSON.stringify(saved_items.slice(0, 50)));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (_) { /* ignore */ }
  }, [resultUrl]);

  const onMouse3dDown = (e: React.MouseEvent) => {
    setIsDragging3d(true);
    drag3dStart.current = { x: e.clientX, y: e.clientY, rx: rotate3d.x, ry: rotate3d.y };
  };
  const onMouse3dMove = (e: React.MouseEvent) => {
    if (!isDragging3d) return;
    const dx = e.clientX - drag3dStart.current.x;
    const dy = e.clientY - drag3dStart.current.y;
    setRotate3d({ x: drag3dStart.current.rx - dy * 0.3, y: drag3dStart.current.ry + dx * 0.3 });
  };
  const onMouse3dUp = () => setIsDragging3d(false);

  const onTouch3dStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    drag3dStart.current = { x: t.clientX, y: t.clientY, rx: rotate3d.x, ry: rotate3d.y };
  };
  const onTouch3dMove = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const dx = t.clientX - drag3dStart.current.x;
    const dy = t.clientY - drag3dStart.current.y;
    setRotate3d({ x: drag3dStart.current.rx - dy * 0.3, y: drag3dStart.current.ry + dx * 0.3 });
  };

  const reset = () => {
    setStep('upload_person');
    setPersonPreview(null);
    setPersonBase64(null);
    setGarmentPreview(null);
    setGarmentBase64(null);
    setResultUrl(null);
    setError(null);
    setSaved(false);
    setProgress(0);
  };

  return (
    <div style={{ minHeight: '100%', padding: '0 0 16px', display: 'flex', flexDirection: 'column' }}>
      {/* Заголовок */}
      <div style={{ padding: '20px 20px 0', textAlign: 'center' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 6,
          background: 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(6,182,212,0.15))',
          border: '1px solid rgba(168,85,247,0.3)', borderRadius: 20, padding: '4px 14px',
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#a855f7', animation: 'pulse 2s infinite' }} />
          <span style={{ fontSize: 11, color: '#c084fc', fontWeight: 600, letterSpacing: 1 }}>AI ПРИМЕРКА</span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: 0, lineHeight: 1.2 }}>
          Виртуальная примерка
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: '4px 0 0' }}>
          Загрузи фото себя и одежды — ИИ наденет её на тебя
        </p>
      </div>

      {/* Шаги-индикатор */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, padding: '16px 20px 0' }}>
        {(['upload_person', 'upload_garment', 'generating', 'result'] as Step[]).map((s, i) => {
          const labels = ['Ты', 'Одежда', 'ИИ', 'Результат'];
          const isActive = step === s;
          const isDone = (['upload_person', 'upload_garment', 'generating', 'result'] as Step[]).indexOf(step) > i;
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, transition: 'all 0.3s',
                  background: isDone ? '#a855f7' : isActive ? 'linear-gradient(135deg, #a855f7, #06b6d4)' : 'rgba(255,255,255,0.08)',
                  border: isActive ? '2px solid rgba(168,85,247,0.8)' : '2px solid transparent',
                  color: isDone || isActive ? '#fff' : 'rgba(255,255,255,0.3)',
                  boxShadow: isActive ? '0 0 12px rgba(168,85,247,0.5)' : 'none',
                }}>
                  {isDone ? '✓' : i + 1}
                </div>
                <span style={{ fontSize: 10, color: isActive ? '#c084fc' : 'rgba(255,255,255,0.25)', whiteSpace: 'nowrap' }}>
                  {labels[i]}
                </span>
              </div>
              {i < 3 && (
                <div style={{ width: 40, height: 2, margin: '0 4px', marginBottom: 16, borderRadius: 2, background: isDone ? '#a855f7' : 'rgba(255,255,255,0.1)', transition: 'all 0.3s' }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Ошибка */}
      {error && (
        <div style={{ margin: '12px 20px 0', padding: '12px 14px', borderRadius: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <p style={{ margin: 0, fontSize: 13, color: '#f87171' }}>{error}</p>
        </div>
      )}

      {/* ШАГ 1: Загрузка фото себя */}
      {step === 'upload_person' && (
        <div style={{ flex: 1, padding: '16px 20px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input ref={personInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => e.target.files?.[0] && handlePersonUpload(e.target.files[0])} />

          <div
            onClick={() => personInputRef.current?.click()}
            style={{
              flex: 1, minHeight: 280, borderRadius: 20, cursor: 'pointer', position: 'relative', overflow: 'hidden',
              border: `2px dashed ${personPreview ? 'rgba(168,85,247,0.5)' : 'rgba(255,255,255,0.15)'}`,
              background: personPreview ? 'transparent' : 'rgba(255,255,255,0.03)',
              transition: 'all 0.3s', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {personPreview ? (
              <img src={personPreview} alt="person" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 18 }} />
            ) : (
              <div style={{ textAlign: 'center', padding: 24 }}>
                <div style={{
                  width: 72, height: 72, borderRadius: '50%', margin: '0 auto 16px',
                  background: 'linear-gradient(135deg, rgba(168,85,247,0.2), rgba(6,182,212,0.2))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid rgba(168,85,247,0.3)',
                }}>
                  <Icon name="User" size={32} style={{ color: '#a855f7' }} />
                </div>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#fff' }}>Загрузи своё фото</p>
                <p style={{ margin: '6px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
                  Встань прямо, в полный рост<br />На однотонном фоне — лучший результат
                </p>
              </div>
            )}
            {personPreview && (
              <div style={{
                position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(168,85,247,0.9)', borderRadius: 20, padding: '6px 16px',
                fontSize: 12, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap',
              }}>
                Нажми чтобы изменить
              </div>
            )}
          </div>

          <div style={{ padding: '12px 14px', borderRadius: 14, background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.15)' }}>
            <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
              💡 <strong style={{ color: 'rgba(255,255,255,0.7)' }}>Советы для лучшего результата:</strong><br />
              • Фото в полный рост, стой прямо<br />
              • Руки опущены вдоль тела<br />
              • Хорошее освещение, чёткое фото
            </p>
          </div>

          {personPreview && (
            <button
              onClick={() => setStep('upload_garment')}
              style={{
                padding: '14px 20px', borderRadius: 16, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 15,
                background: 'linear-gradient(135deg, #a855f7, #06b6d4)', color: '#fff',
                boxShadow: '0 4px 20px rgba(168,85,247,0.4)',
              }}
            >
              Далее — выбрать одежду →
            </button>
          )}
        </div>
      )}

      {/* ШАГ 2: Загрузка одежды */}
      {step === 'upload_garment' && (
        <div style={{ flex: 1, padding: '16px 20px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input ref={garmentInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => e.target.files?.[0] && handleGarmentUpload(e.target.files[0])} />

          {/* Категория */}
          <div style={{ display: 'flex', gap: 8 }}>
            {CATEGORIES.map(cat => (
              <button
                key={cat.key}
                onClick={() => setCategory(cat.key)}
                style={{
                  flex: 1, padding: '10px 4px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12,
                  transition: 'all 0.2s',
                  background: category === cat.key ? 'linear-gradient(135deg, rgba(168,85,247,0.4), rgba(6,182,212,0.4))' : 'rgba(255,255,255,0.06)',
                  color: category === cat.key ? '#fff' : 'rgba(255,255,255,0.4)',
                  boxShadow: category === cat.key ? '0 0 12px rgba(168,85,247,0.3)' : 'none',
                  border: category === cat.key ? '1px solid rgba(168,85,247,0.5)' : '1px solid transparent',
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div
            onClick={() => garmentInputRef.current?.click()}
            style={{
              flex: 1, minHeight: 260, borderRadius: 20, cursor: 'pointer', position: 'relative', overflow: 'hidden',
              border: `2px dashed ${garmentPreview ? 'rgba(6,182,212,0.5)' : 'rgba(255,255,255,0.15)'}`,
              background: garmentPreview ? 'transparent' : 'rgba(255,255,255,0.03)',
              transition: 'all 0.3s', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {garmentPreview ? (
              <img src={garmentPreview} alt="garment" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 12 }} />
            ) : (
              <div style={{ textAlign: 'center', padding: 24 }}>
                <div style={{
                  width: 72, height: 72, borderRadius: '50%', margin: '0 auto 16px',
                  background: 'linear-gradient(135deg, rgba(6,182,212,0.2), rgba(168,85,247,0.2))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid rgba(6,182,212,0.3)',
                }}>
                  <Icon name="Shirt" size={32} style={{ color: '#06b6d4' }} />
                </div>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#fff' }}>Загрузи фото одежды</p>
                <p style={{ margin: '6px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
                  Фото с магазина или личное фото<br />Лучше на белом фоне
                </p>
              </div>
            )}
            {garmentPreview && (
              <div style={{
                position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(6,182,212,0.9)', borderRadius: 20, padding: '6px 16px',
                fontSize: 12, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap',
              }}>
                Нажми чтобы изменить
              </div>
            )}
          </div>

          {/* Превью двух фото */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ flex: 1, position: 'relative', height: 64, borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,0.05)' }}>
              {personPreview && <img src={personPreview} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              <div style={{ position: 'absolute', bottom: 4, left: 4, fontSize: 10, color: 'rgba(255,255,255,0.6)', background: 'rgba(0,0,0,0.5)', borderRadius: 6, padding: '2px 6px' }}>Ты</div>
            </div>
            <Icon name="Plus" size={16} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
            <div style={{ flex: 1, height: 64, borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
              {garmentPreview
                ? <img src={garmentPreview} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                : <Icon name="Shirt" size={20} style={{ color: 'rgba(255,255,255,0.2)' }} />
              }
              {garmentPreview && <div style={{ position: 'absolute', bottom: 4, left: 4, fontSize: 10, color: 'rgba(255,255,255,0.6)', background: 'rgba(0,0,0,0.5)', borderRadius: 6, padding: '2px 6px' }}>Одежда</div>}
            </div>
            <Icon name="ArrowRight" size={16} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
            <div style={{ flex: 1, height: 64, borderRadius: 12, background: 'linear-gradient(135deg, rgba(168,85,247,0.1), rgba(6,182,212,0.1))', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(168,85,247,0.3)' }}>
              <Icon name="Sparkles" size={20} style={{ color: 'rgba(168,85,247,0.6)' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setStep('upload_person')}
              style={{
                padding: '14px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', fontWeight: 600, fontSize: 14,
                background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)',
              }}
            >
              ← Назад
            </button>
            <button
              disabled={!garmentPreview}
              onClick={startGeneration}
              style={{
                flex: 1, padding: '14px', borderRadius: 16, border: 'none', cursor: garmentPreview ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: 15,
                background: garmentPreview ? 'linear-gradient(135deg, #a855f7, #06b6d4)' : 'rgba(255,255,255,0.08)',
                color: garmentPreview ? '#fff' : 'rgba(255,255,255,0.3)',
                boxShadow: garmentPreview ? '0 4px 20px rgba(168,85,247,0.4)' : 'none',
                transition: 'all 0.3s',
              }}
            >
              ✨ Примерить
            </button>
          </div>
        </div>
      )}

      {/* ШАГ 3: Генерация */}
      {step === 'generating' && (
        <div style={{ flex: 1, padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
          <div style={{ position: 'relative', width: 120, height: 120 }}>
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              background: 'conic-gradient(from 0deg, #a855f7, #06b6d4, #a855f7)',
              animation: 'spin 2s linear infinite',
            }} />
            <div style={{
              position: 'absolute', inset: 6, borderRadius: '50%', background: '#080b14',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="Sparkles" size={36} style={{ color: '#a855f7' }} />
            </div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#fff' }}>ИИ примеряет одежду</h2>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Нейросеть анализирует фото...<br />Обычно занимает 15–30 секунд</p>
          </div>

          <div style={{ width: '100%', maxWidth: 280 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Прогресс</span>
              <span style={{ fontSize: 12, color: '#a855f7' }}>{Math.round(progress)}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 3, transition: 'width 0.8s ease',
                width: `${progress}%`,
                background: 'linear-gradient(90deg, #a855f7, #06b6d4)',
              }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            {[personPreview, garmentPreview].map((src, i) => (
              <div key={i} style={{ width: 80, height: 80, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                {src && <img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ШАГ 4: Результат с 3D эффектом */}
      {step === 'result' && resultUrl && (
        <div style={{ flex: 1, padding: '12px 20px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
              Перетащи пальцем для 3D просмотра
            </p>
          </div>

          {/* 3D просмотр */}
          <div
            style={{ flex: 1, minHeight: 340, position: 'relative', perspective: '800px', cursor: isDragging3d ? 'grabbing' : 'grab' }}
            onMouseDown={onMouse3dDown}
            onMouseMove={onMouse3dMove}
            onMouseUp={onMouse3dUp}
            onMouseLeave={onMouse3dUp}
            onTouchStart={onTouch3dStart}
            onTouchMove={onTouch3dMove}
          >
            <div style={{
              width: '100%', height: '100%', borderRadius: 20, overflow: 'hidden',
              transform: `rotateX(${rotate3d.x}deg) rotateY(${rotate3d.y}deg)`,
              transition: isDragging3d ? 'none' : 'transform 0.5s ease',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(168,85,247,0.2)',
              transformStyle: 'preserve-3d',
            }}>
              <img
                src={resultUrl}
                alt="result"
                draggable={false}
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 20, display: 'block', userSelect: 'none' }}
              />
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 20,
                background: 'linear-gradient(135deg, rgba(168,85,247,0.05), transparent, rgba(6,182,212,0.05))',
                pointerEvents: 'none',
              }} />
            </div>

            {/* Подсказка вращения */}
            {rotate3d.x === 0 && rotate3d.y === 0 && (
              <div style={{
                position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.6)', borderRadius: 20, padding: '6px 14px',
                fontSize: 11, color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', gap: 6,
                backdropFilter: 'blur(8px)', pointerEvents: 'none',
              }}>
                <Icon name="Move" size={12} style={{ color: '#a855f7' }} />
                Потяни для 3D вращения
              </div>
            )}
          </div>

          {/* Кнопки */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={handleSave}
              style={{
                flex: 1, padding: '14px', borderRadius: 16, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14,
                background: saved ? 'rgba(34,197,94,0.2)' : 'rgba(168,85,247,0.15)',
                color: saved ? '#4ade80' : '#c084fc',
                border: `1px solid ${saved ? 'rgba(34,197,94,0.3)' : 'rgba(168,85,247,0.3)'}`,
                transition: 'all 0.3s',
              }}
            >
              {saved ? '✓ Сохранено' : '↓ Сохранить'}
            </button>
            <button
              onClick={reset}
              style={{
                flex: 1, padding: '14px', borderRadius: 16, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14,
                background: 'linear-gradient(135deg, #a855f7, #06b6d4)', color: '#fff',
                boxShadow: '0 4px 20px rgba(168,85,247,0.4)',
              }}
            >
              Примерить ещё →
            </button>
          </div>

          {/* Мини-превью исходников */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 48, height: 56, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                {personPreview && <img src={personPreview} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </div>
              <p style={{ margin: '3px 0 0', fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Ты</p>
            </div>
            <Icon name="Plus" size={14} style={{ color: 'rgba(255,255,255,0.2)', marginBottom: 12 }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 48, height: 56, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                {garmentPreview && <img src={garmentPreview} style={{ width: '100%', height: '100%', objectFit: 'contain', background: 'rgba(255,255,255,0.05)' }} />}
              </div>
              <p style={{ margin: '3px 0 0', fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Одежда</p>
            </div>
            <Icon name="Equals" size={14} style={{ color: 'rgba(255,255,255,0.2)', marginBottom: 12 }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 48, height: 56, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(168,85,247,0.3)' }}>
                <img src={resultUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <p style={{ margin: '3px 0 0', fontSize: 10, color: '#a855f7' }}>Результат</p>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}