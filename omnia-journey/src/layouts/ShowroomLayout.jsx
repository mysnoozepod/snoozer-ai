// src/layouts/ShowroomLayout.jsx

import React from 'react';
import { Outlet } from 'react-router-dom';
import SnoozerHUD from '../components/snoozer/SnoozerHUD';
import { useHudRouteVoiceGuard } from '../hooks/useHudRouteVoiceGuard';

export default function ShowroomLayout() {
  useHudRouteVoiceGuard({
    allowContinuation: true,
    maxCarryoverMs: 3000,
  });

  return (
    <div className="showroom-layout">
      <SnoozerHUD />
      <main className="showroom-layout__content">
        <Outlet />
      </main>
    </div>
  );
}