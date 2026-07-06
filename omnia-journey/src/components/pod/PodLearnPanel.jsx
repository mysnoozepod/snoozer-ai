import { CheckCircle2 } from "lucide-react";

import { ShowroomPanel } from "@/components/showroom/ShowroomPrimitives";

export function PodLearnPanel({ learnSpecsItems = [], learnPricingRows = [], learnFitItems = [] }) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="grid min-h-0 items-start gap-2.5 xl:grid-cols-3">
        <ShowroomPanel className="p-2.75 md:p-3.25" tone="frost">
          <div className="text-[0.7rem] font-black uppercase tracking-[0.18em] text-[#2f57e8]">
            Specs
          </div>
          <div className="mt-1 text-[1.02rem] font-black leading-tight tracking-tight text-slate-900 md:text-[1.12rem]">
            What&apos;s Inside
          </div>
          <div className="mt-1.75 space-y-1.25 pr-0.5">
            {learnSpecsItems.map((item) => (
              <div key={item} className="flex gap-2 text-[0.8rem] leading-[1.25rem] text-slate-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2f57e8]" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </ShowroomPanel>

        <ShowroomPanel className="p-2.75 md:p-3.25" tone="frost">
          <div className="text-[0.7rem] font-black uppercase tracking-[0.18em] text-[#2f57e8]">
            Pricing
          </div>
          <div className="mt-1 text-[1.02rem] font-black leading-tight tracking-tight text-slate-900 md:text-[1.12rem]">
            Mattress Only
          </div>
          {learnPricingRows.length ? (
            <div className="mt-1.75 pr-0.5">
              <div className="grid gap-1 sm:grid-cols-2">
                {learnPricingRows.map((row) => (
                  <div
                    key={row.size}
                    className="flex items-center justify-between rounded-[15px] border border-[#dbe5ff] bg-white/96 px-2.5 py-1.35 shadow-sm"
                  >
                    <div className="text-[0.8rem] font-extrabold text-slate-900">{row.size}</div>
                    <div className="text-[0.8rem] font-black text-[#2f57e8]">{row.price}</div>
                  </div>
                ))}
              </div>
              <div className="mt-1.75 text-[0.74rem] leading-5 text-slate-500">
                Prices may vary by retailer.
              </div>
            </div>
          ) : (
            <div className="mt-1.75 rounded-[16px] border border-dashed border-[#dbe5ff] bg-white/90 px-3 py-3 text-[0.78rem] leading-5 text-slate-600">
              Mattress-only pricing will appear here when the current product pricing finishes loading.
            </div>
          )}
        </ShowroomPanel>

        <ShowroomPanel className="p-2.75 md:p-3.25" tone="frost">
          <div className="text-[0.7rem] font-black uppercase tracking-[0.18em] text-[#2f57e8]">
            Why It Fits You
          </div>
          <div className="mt-1 text-[1.02rem] font-black leading-tight tracking-tight text-slate-900 md:text-[1.12rem]">
            Why this mattress may fit
          </div>
          <div className="mt-1.75 space-y-1.25 pr-0.5">
            {learnFitItems.map((item) => (
              <div key={item} className="flex gap-2 text-[0.8rem] leading-[1.25rem] text-slate-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2f57e8]" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </ShowroomPanel>
      </div>
    </div>
  );
}
