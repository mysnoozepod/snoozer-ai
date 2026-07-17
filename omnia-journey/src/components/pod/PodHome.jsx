import { PodRestStartSection } from "@/components/pod/PodRestPanels";

export function PodHome({
  title,
  dashboardTestingModes,
  onChooseMode,
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PodRestStartSection
        podLabel={title}
        flowOptions={dashboardTestingModes}
        onChooseMode={onChooseMode}
      />
    </div>
  );
}
