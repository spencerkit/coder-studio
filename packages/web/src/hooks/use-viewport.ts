import { useEffect, useState } from 'react';

export type Viewport = 'mobile' | 'desktop';

const WIDTH_QUERY = '(max-width: 899px)';
const POINTER_QUERY = '(pointer: coarse)';

function computeViewport(): Viewport {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'desktop';
  }

  const narrow = window.matchMedia(WIDTH_QUERY).matches;
  const coarse = window.matchMedia(POINTER_QUERY).matches;

  return narrow || coarse ? 'mobile' : 'desktop';
}

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(computeViewport);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const widthList = window.matchMedia(WIDTH_QUERY);
    const pointerList = window.matchMedia(POINTER_QUERY);
    const handleChange = () => {
      setViewport(computeViewport());
    };

    widthList.addEventListener('change', handleChange);
    pointerList.addEventListener('change', handleChange);
    handleChange();

    return () => {
      widthList.removeEventListener('change', handleChange);
      pointerList.removeEventListener('change', handleChange);
    };
  }, []);

  return viewport;
}
