import { CheckCircle2, Loader2, ShoppingCart } from "lucide-react";

import { ShowroomPanel } from "@/components/showroom/ShowroomPrimitives";

const TONES = {
  Support: "bg-[#eef3ff] text-[#2f57e8]",
  "Pressure Relief": "bg-[#fff5ea] text-[#ea6b0b]",
  "Temperature Comfort": "bg-[#ecfeff] text-[#087f97]",
  "Motion Isolation": "bg-[#f0fdf4] text-[#15803d]",
  "Mattress Feel": "bg-[#f5f3ff] text-[#7048c8]",
};

export function PodLearnPanel({
  noticeItems = [], pricingRows = [], recommendation = "", selectedSize = "",
  onSelectSize, onAddMattress, mattressInCart = false, addingMattress = false, cartError = "",
}) {
  const selectedRow = pricingRows.find((row) => row.size === selectedSize) || null;

  return (
    <div data-pod-learn-layout="guided" className="flex min-h-0 flex-col">
      <div className="grid min-h-0 items-stretch gap-[10px] md:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <ShowroomPanel data-pod-text-card="mattress-notice" className="min-h-0 p-3" tone="frost">
          <div className="text-[0.75rem] font-black uppercase tracking-[0.18em] text-[#2f57e8]">Learn by Feel</div>
          <h2 className="mt-1 text-[clamp(1.25rem,1.8vw,1.65rem)] font-black leading-tight tracking-tight text-slate-950">What to Notice While You Test</h2>
          <p className="mt-1 text-[clamp(0.86rem,1vw,0.98rem)] leading-snug text-slate-600">Settle in naturally, then use these cues to compare how this mattress feels to you.</p>
          {noticeItems.length ? (
            <div className="mt-[clamp(8px,1.15vw,13px)] grid gap-[7px] sm:grid-cols-2">
              {noticeItems.map((item, index) => (
                <div key={`${item.category}-${item.prompt}`} data-pod-notice-row={item.category} className="flex min-h-[68px] gap-2.5 rounded-[16px] border border-[#dbe5ff] bg-white/82 p-2 text-[clamp(0.84rem,1vw,0.98rem)] leading-[1.22] text-slate-700">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${TONES[item.category] || TONES.Support}`}>{index + 1}</span>
                  <span><strong className="block font-black text-slate-950">{item.category}</strong><span>{item.prompt}</span></span>
                </div>
              ))}
            </div>
          ) : (
            <div data-pod-notice-fallback="true" className="mt-3 rounded-[16px] border border-dashed border-[#cbd8f4] bg-white/78 px-4 py-3 text-sm font-semibold leading-snug text-slate-600">Verified testing cues are unavailable right now. You can still try the mattress and ask Snoozer for help.</div>
          )}
        </ShowroomPanel>

        <div className="grid min-h-0 grid-rows-[auto_1fr] gap-[6px]">
          <ShowroomPanel data-pod-text-card="snoozer-recommendation" className="min-h-0 p-1.5" tone="frost">
            <div className="flex items-center gap-3">
              <div className="flex h-[clamp(50px,4.6vw,60px)] w-[clamp(50px,4.6vw,60px)] shrink-0 items-end justify-center overflow-hidden rounded-[18px] bg-gradient-to-b from-[#edf5ff] to-white">
                <img src="/snoozer-avatar.png" alt="Snoozer" className="h-full w-full object-contain object-bottom" />
              </div>
              <div className="min-w-0">
                <div className="text-[0.72rem] font-black uppercase tracking-[0.18em] text-[#2f57e8]">Snoozer's Take</div>
                <p data-pod-recommendation-summary="true" className="mt-1 text-[clamp(0.8rem,0.92vw,0.92rem)] font-semibold leading-[1.18] text-slate-700">{recommendation || "Your recommendation details are unavailable right now."}</p>
              </div>
            </div>
          </ShowroomPanel>

          <ShowroomPanel data-pod-text-card="pricing" className="min-h-0 p-2" tone="frost">
            <div className="text-[0.72rem] font-black uppercase tracking-[0.18em] text-[#2f57e8]">Mattress Only</div>
            <div className="mt-0.5 text-[clamp(1.08rem,1.45vw,1.28rem)] font-black leading-tight text-slate-900">Choose Size</div>
            {pricingRows.length ? (
              <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2">
                {pricingRows.map((row) => {
                  const active = row.size === selectedSize;
                  return <button key={row.size} type="button" onClick={() => onSelectSize?.(row.size)} className={`flex min-h-[46px] items-center justify-between rounded-[13px] border px-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[#315cf6] focus-visible:ring-offset-2 ${active ? "border-[#315cf6] bg-[#eef3ff] ring-2 ring-[#315cf6]/10" : "border-[#dbe5ff] bg-white hover:border-[#9db3f8]"}`}><span className="font-extrabold text-slate-900">{row.size}</span><span className="font-black text-[#2f57e8]">{row.price}</span></button>;
                })}
              </div>
            ) : <div className="mt-1.5 rounded-[14px] border border-dashed border-[#dbe5ff] bg-white px-3 py-1 text-sm text-slate-600">No approved mattress sizes are available right now.</div>}
            <button type="button" disabled={!selectedRow || addingMattress || mattressInCart} onClick={() => onAddMattress?.(selectedRow)} className="mt-1.5 inline-flex min-h-[46px] w-full items-center justify-center rounded-[13px] bg-[#315cf6] px-4 text-sm font-black text-white outline-none transition hover:bg-[#244bd1] focus-visible:ring-2 focus-visible:ring-[#315cf6] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300">
              {addingMattress ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : mattressInCart ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <ShoppingCart className="mr-2 h-4 w-4" />}
              {mattressInCart ? "Mattress in Cart" : addingMattress ? "Adding Mattress..." : "Add Mattress to Cart"}
            </button>
            {cartError ? <p className="mt-1.5 text-xs font-semibold text-amber-800">{cartError}</p> : null}
          </ShowroomPanel>
        </div>
      </div>
    </div>
  );
}
