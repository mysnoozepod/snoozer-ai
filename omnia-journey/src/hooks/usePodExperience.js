import { useCallback, useEffect, useState } from "react";

function safeSet(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function usePodExperience({ storagePrefix, defaultDetailsActionId }) {
  const [buildStepKey, setBuildStepKey] = useState("size");
  const [openStage, setOpenStage] = useState("rest");
  const [testComplete, setTestComplete] = useState(false);
  const [feelChoice, setFeelChoice] = useState("");
  const [restCompletionStage, setRestCompletionStage] = useState("");
  const [detailsActionId, setDetailsActionId] = useState(defaultDetailsActionId);
  const [restModeId, setRestModeId] = useState("");
  const [restStepIndex, setRestStepIndex] = useState(0);
  const [timerRemaining, setTimerRemaining] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [selectedRestInstructionId, setSelectedRestInstructionId] = useState("");
  const [showRestChooser, setShowRestChooser] = useState(true);

  useEffect(() => safeSet(`${storagePrefix}.openStage`, openStage || "rest"), [storagePrefix, openStage]);
  useEffect(() => safeSet(`${storagePrefix}.buildStepKey`, buildStepKey || "size"), [storagePrefix, buildStepKey]);
  useEffect(() => safeSet(`${storagePrefix}.testComplete`, testComplete ? "1" : "0"), [storagePrefix, testComplete]);
  useEffect(() => safeSet(`${storagePrefix}.feelChoice`, feelChoice || ""), [storagePrefix, feelChoice]);
  useEffect(() => safeSet(`${storagePrefix}.restCompletionStage`, restCompletionStage || ""), [storagePrefix, restCompletionStage]);
  useEffect(() => safeSet(`${storagePrefix}.detailsActionId`, detailsActionId || defaultDetailsActionId), [storagePrefix, detailsActionId, defaultDetailsActionId]);
  useEffect(() => safeSet(`${storagePrefix}.restModeId`, restModeId || ""), [storagePrefix, restModeId]);
  useEffect(() => safeSet(`${storagePrefix}.restStepIndex`, String(restStepIndex || 0)), [storagePrefix, restStepIndex]);
  useEffect(() => safeSet(`${storagePrefix}.timerRemaining`, String(Math.max(0, timerRemaining || 0))), [storagePrefix, timerRemaining]);

  const resetForPodChange = useCallback(() => {
    setOpenStage("rest");
    setBuildStepKey("size");
    setTestComplete(false);
    setFeelChoice("");
    setRestCompletionStage("");
    setDetailsActionId(defaultDetailsActionId);
    setRestModeId("");
    setRestStepIndex(0);
    setTimerRemaining(0);
    setTimerRunning(false);
    setSelectedRestInstructionId("");
    setShowRestChooser(true);
  }, [defaultDetailsActionId]);

  return {
    buildStepKey,
    setBuildStepKey,
    openStage,
    setOpenStage,
    testComplete,
    setTestComplete,
    feelChoice,
    setFeelChoice,
    restCompletionStage,
    setRestCompletionStage,
    detailsActionId,
    setDetailsActionId,
    restModeId,
    setRestModeId,
    restStepIndex,
    setRestStepIndex,
    timerRemaining,
    setTimerRemaining,
    timerRunning,
    setTimerRunning,
    selectedRestInstructionId,
    setSelectedRestInstructionId,
    showRestChooser,
    setShowRestChooser,
    resetForPodChange,
  };
}
