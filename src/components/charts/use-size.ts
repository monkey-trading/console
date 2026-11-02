"use client";

import { useEffect, useRef, useState } from "react";

/** The size of the element `ref` is put on, in whole CSS pixels, kept current as it resizes; zero until it has been measured. */
export function useSize<T extends HTMLElement>(): { ref: React.RefObject<T | null>; width: number; height: number } {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize((held) => {
      const width = Math.round(el.clientWidth);
      const height = Math.round(el.clientHeight);
      return held.width === width && held.height === height ? held : { width, height };
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}
