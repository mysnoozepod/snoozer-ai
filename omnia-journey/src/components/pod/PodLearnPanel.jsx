import { CheckCircle2 } from "lucide-react";

import { ShowroomPanel } from "@/components/showroom/ShowroomPrimitives";

function nutritionTone(category) {
  switch (category) {
    case "Protein":
      return "bg-[#eef3ff] text-[#2f57e8]";
    case "Healthy Fats":
      return "bg-[#fff5ea] text-[#f97316]";
    case "Electrolytes":
      return "bg-[#ecfeff] text-[#0891b2]";
    case "Fiber":
      return "bg-[#f0fdf4] text-[#16a34a]";
    default:
      return "bg-[#eef3ff] text-[#2f57e8]";
  }
}

function categoryInitial(category) {
  return String(category || "?").trim().charAt(0).toUpperCase() || "?";
}

export function PodLearnPanel({ learnSleepNutritionItems = [], learnPricingRows = [], learnFitItems = [] }) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="grid min-h-0 items-start gap-[10px] xl:grid-cols-3 xl:items-stretch">
        <ShowroomPanel className="min-h-0 p-[12px]" tone="frost">
          <div className="text-[clamp(0.78rem,1vw,0.92rem)] font-black uppercase tracking-[0.18em] text-[#2f57e8]">
            Sleep Nutrition
          </div>
          <div className="mt-[4px] text-[clamp(1.12rem,1.58vw,1.34rem)] font-black leading-tight tracking-tight text-slate-900">
            What this mattress gives your sleep
          </div>
          <div className="mt-[7px] space-y-[5px] pr-[2px]">
            {learnSleepNutritionItems.map((item) => (
              <div
                key={`${item.category}-${item.statement}`}
                className="flex gap-[8px] rounded-[14px] border border-[#dbe5ff] bg-white/78 px-[8px] py-[6px] text-[clamp(1rem,1.05vw,1.08rem)] leading-[1.14] text-slate-700"
              >
                <span
                  className={[
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.76rem] font-black",
                    nutritionTone(item.category),
                  ].join(" ")}
                >
                  {categoryInitial(item.category)}
                </span>
                <span>
                  <strong className="font-black text-slate-950">{item.category}:</strong>{" "}
                  {item.statement}
                </span>
              </div>
            ))}
          </div>
        </ShowroomPanel>

        <ShowroomPanel className="min-h-0 p-[12px]" tone="frost">
          <div className="text-[clamp(0.78rem,1vw,0.92rem)] font-black uppercase tracking-[0.18em] text-[#2f57e8]">
            Pricing
          </div>
          <div className="mt-[4px] text-[clamp(1.12rem,1.58vw,1.34rem)] font-black leading-tight tracking-tight text-slate-900">
            Mattress Only
          </div>
          {learnPricingRows.length ? (
            <div className="mt-[8px] pr-[2px]">
              <div className="grid gap-[6px] sm:grid-cols-2">
                {learnPricingRows.map((row) => (
                  <div
                    key={row.size}
                    className="flex min-h-[36px] items-center justify-between rounded-[15px] border border-[#dbe5ff] bg-white/96 px-[10px] py-[6px] shadow-sm"
                  >
                    <div className="text-[clamp(0.86rem,1.1vw,0.98rem)] font-extrabold text-slate-900">{row.size}</div>
                    <div className="text-[clamp(0.86rem,1.1vw,0.98rem)] font-black text-[#2f57e8]">{row.price}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-[8px] rounded-[16px] border border-dashed border-[#dbe5ff] bg-white/90 px-[10px] py-[10px] text-[0.82rem] leading-5 text-slate-600">
              Mattress-only pricing will appear here when the current product pricing finishes loading.
            </div>
          )}
        </ShowroomPanel>

        <ShowroomPanel className="min-h-0 p-[12px]" tone="frost">
          <div className="text-[clamp(0.78rem,1vw,0.92rem)] font-black uppercase tracking-[0.18em] text-[#2f57e8]">
            Why It Fits You
          </div>
          <div className="mt-[4px] text-[clamp(1.12rem,1.58vw,1.34rem)] font-black leading-tight tracking-tight text-slate-900">
            Why this mattress may fit
          </div>
          <div className="mt-[8px] space-y-[7px] pr-[2px]">
            {learnFitItems.map((item) => (
              <div key={item} className="flex gap-[8px] text-[clamp(0.95rem,1.05vw,1.04rem)] leading-[1.22] text-slate-700">
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
