import React from "react";

const COPY = {
  loading: {
    title: "Loading showroom device...",
    message: "Checking this showroom station before continuing.",
  },
  unknown_device: {
    title: "Showroom station not set up",
    message: "This showroom station is not set up yet. Please ask a team member for help.",
  },
  disabled_device: {
    title: "Showroom station unavailable",
    message: "This showroom station is temporarily unavailable. Please ask a team member for help.",
  },
  invalid_configuration: {
    title: "Station setup needs attention",
    message: "This showroom station needs a quick setup check before it can continue.",
  },
  missing_pod_binding: {
    title: "Pod assignment needed",
    message: "This pod iPad needs its assigned SnoozePod before it can continue.",
  },
  route_unavailable: {
    title: "Continue in the right showroom area",
    message: "This showroom station is built for a different part of your visit.",
  },
  future_route_not_implemented: {
    title: "Station coming soon",
    message: "This station is not installed in the app yet. Please ask a team member for help.",
  },
  checkout_unavailable: {
    title: "Continue at the Checkout Lounge",
    message:
      "Your selections are saved. Continue at the Checkout Lounge when you are ready to complete your investment.",
  },
};

export default function DeviceUnavailable({ kind = "route_unavailable", message = "", details = [] }) {
  const copy = COPY[kind] || COPY.route_unavailable;
  const safeDetails = Array.isArray(details) ? details.filter(Boolean).slice(0, 4) : [];

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center px-6 py-10">
      <div className="rounded-[28px] border border-[#dbe5ff] bg-white/95 p-8 text-center shadow-[0_24px_70px_rgba(31,55,117,0.12)]">
        <div className="text-[0.78rem] font-black uppercase tracking-[0.2em] text-[#2f57e8]">
          MySnoozePod
        </div>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-900">{copy.title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{message || copy.message}</p>
        {safeDetails.length ? (
          <div className="mt-5 rounded-[18px] border border-slate-200 bg-slate-50 p-4 text-left text-xs font-semibold leading-5 text-slate-500">
            {safeDetails.map((detail) => (
              <div key={detail}>{detail}</div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

