import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISS_KEY = "xp-partner-install-dismissed";

export function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const isInstalled = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isInstalled || sessionStorage.getItem(DISMISS_KEY) === "1") return;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setInstallEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  };

  const install = async () => {
    if (!installEvent || installing) return;
    setInstalling(true);
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === "accepted") setVisible(false);
      setInstallEvent(null);
    } finally {
      setInstalling(false);
    }
  };

  if (!visible || !installEvent) return null;

  return (
    <aside className="xp-pwa-install-banner" role="dialog" aria-label="Install Xplore Pondy Partner app">
      <div className="xp-pwa-install-mark" aria-hidden="true">
        <img src="https://xplorepondy.com/images/logos/square-xp-partner-logo.png" alt="" />
      </div>
      <div className="xp-pwa-install-copy">
        <strong>Install Partner app</strong>
        <span> Xplore Pondy Partner Portal</span>
      </div>
      <button type="button" className="xp-pwa-install-action" onClick={() => void install()} disabled={installing}>
        <Download size={17} /> {installing ? "Opening…" : "Install"}
      </button>
      <button type="button" className="xp-pwa-install-dismiss" onClick={dismiss} aria-label="Dismiss install prompt">
        <X size={18} />
      </button>
    </aside>
  );
}
