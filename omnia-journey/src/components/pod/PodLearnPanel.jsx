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
  supportItems = [], pricingRows = [], recommendation = "", selectedSize = "",
  onSelectSize, onAddMattress, mattressInCart = false, addingMattress = false, cartError = "",
}) {
  const selectedRow = pricingRows.find((row) => row.size === selectedSize) || null;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="grid min-h-0 items-start gap-[10px] lg:grid-cols-3 lg:items-stretch">
        <ShowroomPanel data-pod-text-card="mattress-support" className="min-h-0 p-[10px]" tone="frost">
          <div className="text-[clamp(1.12rem,1.58vw,1.34rem)] font-black leading-tight tracking-tight text-slate-900">How This Mattress Supports Your Sleep</div>
          <div className="mt-[7px] space-y-[5px]">
            {supportItems.map((item) => (
              <div key={`${item.category}-${item.statement}`} data-pod-support-row={item.category} className="flex gap-2 rounded-[14px] border border-[#dbe5ff] bg-white/78 px-2 py-1.5 text-[clamp(0.88rem,1vw,1rem)] leading-[1.2] text-slate-700">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${TONES[item.category] || TONES.Support}`}>{item.category.charAt(0)}</span>
                <span><strong className="font-black text-slate-950">{item.category}:</strong> {item.statement}</span>
              </div>
            ))}
          </div>
        </ShowroomPanel>

        <ShowroomPanel data-pod-text-card="pricing" className="min-h-0 p-[10px]" tone="frost">
          <div className="text-[0.78rem] font-black uppercase tracking-[0.18em] text-[#2f57e8]">Mattress Only</div>
          <div className="mt-1 text-[clamp(1.12rem,1.58vw,1.34rem)] font-black leading-tight text-slate-900">Choose Size</div>
          {pricingRows.length ? (
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {pricingRows.map((row) => {
                const active = row.size === selectedSize;
                return <button key={row.size} type="button" onClick={() => onSelectSize?.(row.size)} className={`flex min-h-[42px] items-center justify-between rounded-[13px] border px-3 text-left ${active ? "border-[#315cf6] bg-[#eef3ff] ring-2 ring-[#315cf6]/10" : "border-[#dbe5ff] bg-white"}`}><span className="font-extrabold text-slate-900">{row.size}</span><span className="font-black text-[#2f57e8]">{row.price}</span></button>;
              })}
            </div>
          ) : <div className="mt-2 rounded-[14px] border border-dashed border-[#dbe5ff] bg-white px-3 py-3 text-sm text-slate-600">No approved mattress sizes are available right now.</div>}
          <button type="button" disabled={!selectedRow || addingMattress || mattressInCart} onClick={() => onAddMattress?.(selectedRow)} className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-[13px] bg-[#315cf6] px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300">
            {addingMattress ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : mattressInCart ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <ShoppingCart className="mr-2 h-4 w-4" />}
            {mattressInCart ? "Mattress in Cart" : addingMattress ? "Adding Mattress..." : "Add Mattress to Cart"}
          </button>
          {cartError ? <p className="mt-1.5 text-xs font-semibold text-amber-800">{cartError}</p> : null}
        </ShowroomPanel>

        <ShowroomPanel data-pod-text-card="snoozer-recommendation" className="min-h-0 p-[10px]" tone="frost">
          <div className="text-[0.78rem] font-black uppercase tracking-[0.18em] text-[#2f57e8]">Snoozer Recommendation</div>
          <div className="mt-2 flex gap-2.5 rounded-[16px] border border-[#dbe5ff] bg-white/80 p-3 text-[clamp(0.98rem,1.1vw,1.08rem)] leading-[1.35] text-slate-700">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#2f57e8]" />
            <p data-pod-recommendation-summary="true">{recommendation || "I included this mattress in your testing plan because its verified feel and support profile fit your assessment."}</p>
          </div>
        </ShowroomPanel>
      </div>
    </div>
  );
}
