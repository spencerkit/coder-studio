import { useEffect, useState } from 'react';

export type MobileLayoutMode = 'default' | 'landscape-compact';

const LANDSCAPE_QUERY = '(orientation: landscape)';
const SHORT_HEIGHT_QUERY = '(max-height: 540px)';

function computeMobileLayoutMode(): MobileLayoutMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'default';
  }

  const landscape = window.matchMedia(LANDSCAPE_QUERY).matches;
  const shortHeight = window.matchMedia(SHORT_HEIGHT_QUERY).matches;

  return landscape && shortHeight ? 'landscape-compact' : 'default';
}

export function useMobileLayoutMode(): MobileLayoutMode {
  const [mode, setMode] = useState<MobileLayoutMode>(computeMobileLayoutMode);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const landscapeList = window.matchMedia(LANDSCAPE_QUERY);
    const shortHeightList = window.matchMedia(SHORT_HEIGHT_QUERY);
    const handleChange = () => {
      setMode(computeMobileLayoutMode());
    };

    landscapeList.addEventListener('change', handleChange);
    shortHeightList.addEventListener('change', handleChange);
    handleChange();

    return () => {
      landscapeList.removeEventListener('change', handleChange);
      shortHeightList.removeEventListener('change', handleChange);
    };
  }, []);

  return mode;
}
