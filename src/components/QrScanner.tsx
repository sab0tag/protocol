// D177: the plan's QR read inside the app. On an iPhone with the app on the home screen the system camera opens a link
// in Safari — another storage, so the plan would land «on another phone»; here the camera works inside the app.
// The camera stays on only while this view is open and the app is visible; frames are read on the phone (jsQR, loaded
// with this view only), nothing is sent or kept. A QR that is not a clinic's plan link is said so and ignored.
import jsQR from 'jsqr';
import { useEffect, useRef, useState } from 'react';
import { codeFromScan } from '../domain/clinicCode';

type Problem = 'denied' | 'no-camera' | 'not-plan';
const SAY: Record<Problem, string> = {
  denied: 'Немає дозволу на камеру. Дайте його в налаштуваннях телефона або вставте посилання нижче.',
  'no-camera': 'Камера недоступна на цьому пристрої. Вставте посилання або код нижче.',
  'not-plan': 'Це не QR плану від клініки. Наведіть камеру на QR з кабінету лікаря.',
};

export function QrScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stream: MediaStream | null = null, timer: ReturnType<typeof setInterval> | undefined, done = false;
    const stop = () => { done = true; clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); stream = null; };
    const hidden = () => { if (document.visibilityState === 'hidden') { stop(); onClose(); } };
    document.addEventListener('visibilitychange', hidden);
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setProblem('no-camera'); return; }
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); }
      catch (e) { setProblem((e as Error).name === 'NotAllowedError' ? 'denied' : 'no-camera'); return; }
      if (done) { stop(); return; }
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      setReady(true);
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
      timer = setInterval(() => {
        if (done || !ctx || v.readyState < 2 || !v.videoWidth) return;
        const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight)); // enough for a QR, light on a phone
        canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const found = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
        if (!found) return;
        const code = codeFromScan(found.data);
        if (!code) { setProblem('not-plan'); return; }
        stop(); onCode(code);
      }, 200);
    })();
    return () => { stop(); document.removeEventListener('visibilitychange', hidden); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once per opening
  return (
    <div className="space-y-2" data-testid="qr-scanner">
      <video ref={video} playsInline muted className={`aspect-square w-full max-w-sm rounded-xl bg-black object-cover ${ready ? '' : 'opacity-60'}`} aria-label="Камера для QR-коду" />
      {problem ? <p role="alert" className="text-sm">{SAY[problem]}</p> : <p role="status" className="text-sm text-muted">{ready ? 'Наведіть камеру на QR-код від клініки.' : 'Вмикаю камеру…'}</p>}
      <button type="button" onClick={onClose} className="min-h-tap rounded-xl border-2 border-line px-4 font-semibold">Закрити камеру</button>
    </div>
  );
}
