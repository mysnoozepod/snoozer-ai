import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import Pod from "@/pages/Pod";
import { DEVICE_MODES } from "@/device/deviceModes";
import { DEPLOYMENT_ROLES } from "@/device/deviceRegistry";
import { useDeviceMode } from "@/device/useDeviceMode";
import {
  POD_LAYOUT_CONTRACT,
  POD_LAYOUT_LAB_STATES,
  normalizePodLabState,
} from "@/lib/podLayoutContract";
import { measurePodLayout } from "@/lib/podLayoutMeasurement";

function canUsePodLab(device) {
  return Boolean(
    device?.isAdminDev ||
      device?.deviceMode === DEVICE_MODES.ADMIN_DEV ||
      device?.deploymentRole === DEPLOYMENT_ROLES.REVIEW
  );
}

function PodLayoutDiagnostics({ state }) {
  const [measurement, setMeasurement] = useState(null);

  useEffect(() => {
    let frame = 0;
    let cancelled = false;

    const update = () => {
      if (cancelled) return;
      setMeasurement(measurePodLayout({ state, contract: POD_LAYOUT_CONTRACT }));
      frame = window.setTimeout(update, 500);
    };

    const start = window.requestAnimationFrame(update);
    window.__getPodLayoutMeasurement = () => measurePodLayout({ state, contract: POD_LAYOUT_CONTRACT });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(start);
      window.clearTimeout(frame);
      if (window.__getPodLayoutMeasurement) {
        delete window.__getPodLayoutMeasurement;
      }
    };
  }, [state]);

  const rows = useMemo(() => {
    if (!measurement) return [];
    return [
      ["viewport", `${measurement.viewport.width} x ${measurement.viewport.height}`],
      ["scroll", `${measurement.page.scrollHeight}/${measurement.page.clientHeight}`],
      ["overflow", `${measurement.page.horizontalOverflow ? "x" : "-"} ${measurement.page.verticalOverflow ? "y" : "-"}`],
      ["header", `${measurement.regions.header.actual}px (${measurement.regions.header.diff})`],
      ["hero", `${measurement.regions.productHero.actual}px (${measurement.regions.productHero.diff})`],
      ["content", `${measurement.regions.activeContent.actual}px (${measurement.regions.activeContent.diff})`],
      ["nav", `${measurement.regions.navigation.actual}px (${measurement.regions.navigation.diff})`],
      ["content scroll", `${measurement.regions.activeContent.scrollHeight}/${measurement.regions.activeContent.clientHeight}`],
      ["primary", measurement.primaryActionVisible === null ? "n/a" : `${measurement.primaryActionVisiblePercent}%`],
      ["touch min", measurement.touchTargets.smallest ? `${measurement.touchTargets.smallest.minSide}px` : "n/a"],
      ["overlaps", String(measurement.overlaps.length)],
      ["result", measurement.result],
    ];
  }, [measurement]);

  return (
    <aside
      data-pod-layout-region="diagnostics"
      data-pod-lab-panel="diagnostics"
      data-pod-lab-ready="true"
      className="fixed left-3 top-3 z-[80] max-h-[240px] w-[260px] overflow-auto rounded-[18px] border border-indigo-200 bg-white/92 p-3 text-xs text-slate-700 shadow-[0_24px_60px_rgba(15,23,42,0.18)] backdrop-blur"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-[0.7rem] font-black uppercase tracking-[0.22em] text-[#2f57e8]">
            Pod Layout Lab
          </div>
          <div className="mt-1 font-black text-slate-900">{state}</div>
        </div>
        <span
          className={[
            "rounded-full px-2 py-1 text-[0.68rem] font-black uppercase",
            measurement?.result === "pass"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-amber-100 text-amber-700",
          ].join(" ")}
        >
          {measurement?.result || "measuring"}
        </span>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {POD_LAYOUT_LAB_STATES.map((candidate) => (
          <Link
            key={candidate}
            data-pod-lab-ignore="true"
            to={`/dev/pod-lab?state=${candidate}`}
            className={[
              "rounded-full border px-2 py-1 font-bold",
              candidate === state
                ? "border-indigo-300 bg-indigo-50 text-[#2f57e8]"
                : "border-slate-200 bg-white text-slate-600",
            ].join(" ")}
          >
            {candidate}
          </Link>
        ))}
      </div>

      <dl className="grid grid-cols-[105px_1fr] gap-x-2 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-bold text-slate-500">{label}</dt>
            <dd className="font-semibold text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>

      {measurement?.failures?.length ? (
        <div className="mt-2 rounded-[12px] border border-amber-200 bg-amber-50 p-2 text-amber-900">
          <div className="font-black">Failures</div>
          <ul className="mt-1 list-disc pl-4">
            {measurement.failures.map((failure) => (
              <li key={failure}>{failure}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
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

  return (
    <>
      <Pod labMode labPodId="4" labState={state} />
      <PodLayoutDiagnostics state={state} />
    </>
  );
}
