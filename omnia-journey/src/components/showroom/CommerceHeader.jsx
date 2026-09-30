import React from "react";
import { Gift, Grid2X2, MessageCircle } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import sharpMySnoozePodLogo from "@/assets/mysnoozepod-logo-welcome.png";
import { canNavigateTo } from "@/device/deviceActionGuards";
import { useDeviceMode } from "@/device/useDeviceMode";
import { commerceNavigationState } from "@/lib/commerceNavigation";
import { cn } from "@/lib/utils";
import { ShowroomBrandMark, ShowroomCartBadge } from "./ShowroomPrimitives";

function CommerceAction({ active, disabled, icon: Icon, label, helper, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group inline-flex min-h-[48px] min-w-0 items-center gap-2 rounded-[17px] border px-3 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff] disabled:cursor-not-allowed disabled:opacity-45",
        active
          ? "border-[#9db2ff] bg-[#eef3ff] text-[#203bb3] shadow-inner"
          : "border-white/80 bg-white/78 text-slate-900 hover:border-[#c8d5ff] hover:bg-white"
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#edf2ff] text-[#2f57e8]">
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[0.78rem] font-black md:text-[0.86rem]">{label}</span>
        <span className="hidden truncate text-[10px] font-semibold text-slate-500 min-[1160px]:block">{helper}</span>
      </span>
    </button>
  );
}

export default function CommerceHeader({
  active = "",
  cartCount = 0,
  rewards = null,
  humanHelp = null,
  notice = null,
  onNavigate = null,
  className,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const device = useDeviceMode();
  const shopAllowed = canNavigateTo(device, "/shop");
  const askAllowed = canNavigateTo(device, "/ask-snoozer");
  const cartAllowed = canNavigateTo(device, "/cart");

  const go = (path) => {
    if (!canNavigateTo(device, path) || location.pathname === path) return;
    onNavigate?.(path);
    navigate(path, { state: commerceNavigationState(location) });
  };

  return (
    <header
      data-commerce-header="true"
      className={cn(
        "grid min-h-[64px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[22px] border border-white/80 bg-white/94 px-3 py-2 shadow-[0_18px_46px_rgba(40,63,126,0.1)] backdrop-blur md:px-4",
        className
      )}
    >
      <ShowroomBrandMark
        imageSrc={sharpMySnoozePodLogo}
        imageClassName="w-[clamp(154px,16vw,210px)]"
        loading="eager"
      />

      <nav className="flex min-w-0 items-center justify-center gap-2" aria-label="Showroom commerce">
        <CommerceAction
          active={active === "shop"}
          disabled={!shopAllowed}
          icon={Grid2X2}
          label="Shop"
          helper="Browse Products"
          onClick={() => go("/shop")}
        />
        <CommerceAction
          active={active === "ask"}
          disabled={!askAllowed}
          icon={MessageCircle}
          label="Ask Snoozer"
          helper="Get Recommendations"
          onClick={() => go("/ask-snoozer")}
        />
      </nav>

      <div className="flex min-w-0 items-center justify-end gap-2">
        {notice}
        {rewards || (
          <span className="hidden min-h-[48px] items-center gap-2 rounded-[17px] border border-violet-100 bg-violet-50 px-3 text-sm font-black text-violet-800 min-[1160px]:inline-flex">
            <Gift className="h-4 w-4" aria-hidden="true" /> Rewards
          </span>
        )}
        {humanHelp}
        {cartAllowed ? (
          <ShowroomCartBadge
            count={cartCount}
            quiet
            className={active === "cart" ? "border-[#9db2ff] bg-[#eef3ff]" : ""}
            onClick={() => go("/cart")}
          />
        ) : null}
      </div>
    </header>
  );
}
