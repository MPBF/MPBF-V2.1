import { useEffect, useRef } from "react";

/** Capture once: form rerenders must not replace the original opener. */
export function useDialogReturnFocus() {
  const opener = useRef(document.activeElement);
  useEffect(() => () => {
    // Backdrop closes on mousedown, before the browser's default focus action.
    // Restore after that action, otherwise it immediately clears our focus.
    const target = opener.current;
    requestAnimationFrame(() => {
      if (target instanceof HTMLElement && target.isConnected) {
        target.focus({ preventScroll: true });
      }
    });
  }, []);
}
