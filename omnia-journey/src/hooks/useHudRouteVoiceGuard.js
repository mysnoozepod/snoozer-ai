// src/hooks/useHudRouteVoiceGuard.js

import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useVoiceQueue } from '../lib/snoozer/voice/VoiceQueueContext';

export function useHudRouteVoiceGuard(options = {}) {
  const location = useLocation();
  const prevPathRef = useRef(location.pathname);
  const { handleRouteChange } = useVoiceQueue();

  // Clear or carry the previous route's voice before the entering page queues
  // its narration. A passive effect races new-profile hydration and can erase
  // the What To Expect job after it has already been enqueued.
  useLayoutEffect(() => {
    const prevPath = prevPathRef.current;
    const nextPath = location.pathname;

    if (prevPath !== nextPath) {
      handleRouteChange({
        allowContinuation: options.allowContinuation !== false,
        maxCarryoverMs: Number.isFinite(options.maxCarryoverMs)
          ? options.maxCarryoverMs
          : 3000,
      });
    }

    prevPathRef.current = nextPath;
  }, [location.pathname, handleRouteChange, options.allowContinuation, options.maxCarryoverMs]);
}
