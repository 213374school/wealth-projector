import { useCallback, useEffect, useRef } from "react";

const HOLD_DELAY = 400;
const HOLD_INTERVAL = 80;

export function useHoldRepeat(action: () => void) {
  const actionRef = useRef(action);
  useEffect(() => { actionRef.current = action; });

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(() => {
    actionRef.current();
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => actionRef.current(), HOLD_INTERVAL);
    }, HOLD_DELAY);
  }, []);

  const stop = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  return { start, stop };
}
