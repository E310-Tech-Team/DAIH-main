"use client";

import { useCallback } from "react";

/**
 * A ref callback that focuses its element once, when it mounts. Use it when a
 * step replaces the control that had focus, so keyboard and screen-reader
 * users land on the new content instead of the top of the page.
 */
export function useFocusOnMount<T extends HTMLElement>(): (
  node: T | null,
) => void {
  return useCallback((node: T | null) => {
    node?.focus();
  }, []);
}
