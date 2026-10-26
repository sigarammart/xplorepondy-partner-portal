import { useEffect, useState } from "react";

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function PwaWelcomeSplash() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isStandaloneApp()) return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 2400);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="xp-partner-launch-splash" role="status" aria-label="Welcome to Xplore Pondy Partner">
      <img
        className="xp-partner-launch-banner"
        src="https://xplorepondy.com/images/logos/partner-welcome-banner.jpg"
        alt="Welcome to Xplore Pondy Partner"
        fetchPriority="high"
      />
      <span className="xp-partner-launch-caption">Xplore Pondy Partner</span>
    </div>
  );
}
