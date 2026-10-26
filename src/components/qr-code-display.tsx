import { useEffect, useRef, useState } from "react";

type QRCodeConstructor = new (
  element: HTMLElement,
  options: { text: string; width: number; height: number; colorDark: string; colorLight: string; correctLevel?: number },
) => { clear?: () => void };
type QRCodeWindow = Window & { QRCode?: QRCodeConstructor & { CorrectLevel?: { M?: number } } };

export function QrCodeDisplay({ value, size = 240 }: { value: string; size?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const render = () => {
      const container = containerRef.current;
      if (cancelled || !container) return;
      const QRCode = (window as QRCodeWindow).QRCode;
      if (!QRCode) { setError("QR code could not be generated. Please refresh and try again."); return; }
      setError("");
      container.innerHTML = "";
      try {
        new QRCode(container, {
          text: value, width: size, height: size, colorDark: "#001018", colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel?.M,
        });
      } catch {
        setError("QR code could not be generated.");
      }
    };
    const w = window as QRCodeWindow;
    if (w.QRCode) render();
    else {
      let script = document.querySelector<HTMLScriptElement>('script[data-xplore-qrcode="true"]');
      if (!script) {
        script = document.createElement("script");
        script.src = "/qrcode.min.js";
        script.async = true;
        script.dataset.xploreQrcode = "true";
        document.head.appendChild(script);
      }
      script.addEventListener("load", render, { once: true });
      script.addEventListener("error", () => { if (!cancelled) setError("QR encoder failed to load."); }, { once: true });
      if (w.QRCode) render();
    }
    return () => { cancelled = true; };
  }, [value, size]);
  return <div className="flex min-h-60 items-center justify-center">
    <div ref={containerRef} className="flex items-center justify-center bg-white p-2" style={{ width: size + 16, minHeight: size + 16 }} aria-label="Booking QR code" />
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
