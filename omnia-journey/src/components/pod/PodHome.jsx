import { ShowroomPanel } from "@/components/showroom/ShowroomPrimitives";

import { PodRouteHeroHeader } from "@/components/pod/PodHeader";
import { PodRestStartSection } from "@/components/pod/PodRestPanels";

export function PodHome({
  title,
  mattressDisplayTitle,
  isRecommended,
  mattressImage,
  voiceState,
  badges,
  coachCopy,
  dashboardTestingModes,
  onChooseMode,
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <ShowroomPanel className="shrink-0 overflow-hidden p-0" tone="soft">
        <PodRouteHeroHeader
          eyebrow=""
          podTitle={title}
          mattressTitle={mattressDisplayTitle}
          helperText=""
          isRecommended={isRecommended}
          mattressImage={mattressImage}
          voiceState={voiceState}
          badges={badges}
          coachBubble={coachCopy}
        />
      </ShowroomPanel>

      <PodRestStartSection
        podLabel={title}
        flowOptions={dashboardTestingModes}
        onChooseMode={onChooseMode}
      />
    </div>
  );
}
