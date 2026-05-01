import { useEffect, useState } from 'react';

export function useVisualViewportInset() {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;

    if (!viewport) {
      setInset(0);
      return;
    }

    const update = () => {
      const nextInset = Math.max(window.innerHeight - viewport.height - viewport.offsetTop, 0);
      setInset(Math.round(nextInset));
    };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);

    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
