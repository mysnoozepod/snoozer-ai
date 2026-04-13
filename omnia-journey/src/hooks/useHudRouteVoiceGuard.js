// src/hooks/useHudRouteVoiceGuard.js

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useVoiceQueue } from '../lib/snoozer/voice/VoiceQueueContext';

export function useHudRouteVoiceGuard(options = {}) {
  const location = useLocation();
  const prevPathRef = useRef(location.pathname);
  const { handleRouteChange } = useVoiceQueue();

  useEffect(() => {
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