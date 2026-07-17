import { Navigate, useSearchParams } from "react-router-dom";

import { DEVICE_MODES } from "@/device/deviceModes";
import { DEPLOYMENT_ROLES } from "@/device/deviceRegistry";
import { useDeviceMode } from "@/device/useDeviceMode";
import { normalizePodLabState } from "@/lib/podLayoutContract";

function canUsePodLab(device) {
  return Boolean(
    device?.isAdminDev ||
      device?.deviceMode === DEVICE_MODES.ADMIN_DEV ||
      device?.deploymentRole === DEPLOYMENT_ROLES.REVIEW
  );
}

export default function PodLayoutLab() {
  const device = useDeviceMode();
  const [searchParams] = useSearchParams();
  const state = normalizePodLabState(searchParams.get("state"));

  if (!canUsePodLab(device)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f9ff] p-6">
        <div className="max-w-xl rounded-[24px] border border-indigo-100 bg-white p-8 text-center shadow-xl">
          <div className="text-sm font-black uppercase tracking-[0.22em] text-[#2f57e8]">
            Pod Layout Lab
          </div>
          <h1 className="mt-3 text-3xl font-black text-slate-900">Developer lab unavailable</h1>
          <p className="mt-3 text-slate-600">
            This measurement lab is only available in admin-dev or review mode.
          </p>
        </div>
      </div>
    );
  }

  return <Navigate to={`/pod/pod-4?podLayoutState=${state}`} replace />;
}
