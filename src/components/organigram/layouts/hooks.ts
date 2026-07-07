"use client";
import { useCallback, useRef, useState } from "react";

export function useWidth<T extends HTMLElement>() {
  const [w, setW] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  // Callback ref: re-runs whenever the element mounts/unmounts, so the observer
  // is re-attached (and re-measured) after the node is removed and later remounted
  // — e.g. toggling in and out of a drilled view.
  const ref = useCallback((el: T | null) => {
    roRef.current?.disconnect();
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
  }, []);
  return [ref, w] as const;
}
