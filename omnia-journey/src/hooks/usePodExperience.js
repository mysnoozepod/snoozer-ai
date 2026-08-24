import { useCallback, useEffect, useMemo, useState } from "react";

function safeSet(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function hydrateBoolean(raw, fallback = false) {
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return fallback;
}

function hydrateNumber(raw, fallback = 0) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function usePodExperience({ storagePrefix, defaultDetailsActionId }) {
  const initialState = useMemo(
    () => ({
      buildStepKey: safeGet(`${storagePrefix}.buildStepKey`) || "size",
      openStage: safeGet(`${storagePrefix}.openStage`) || "rest",
      testComplete: hydrateBoolean(safeGet(`${storagePrefix}.testComplete`), false),
      feelChoice: safeGet(`${storagePrefix}.feelChoice`) || "",
      restCompletionStage: safeGet(`${storagePrefix}.restCompletionStage`) || "",
      detailsActionId:
        safeGet(`${storagePrefix}.detailsActionId`) || defaultDetailsActionId,
      restModeId: safeGet(`${storagePrefix}.restModeId`) || "",
      restStepIndex: hydrateNumber(safeGet(`${storagePrefix}.restStepIndex`), 0),
      timerRemaining: hydrateNumber(safeGet(`${storagePrefix}.timerRemaining`), 0),
      timerRunning: false,
      selectedRestInstructionId:
        safeGet(`${storagePrefix}.selectedRestInstructionId`) || "",
      showRestChooser: hydrateBoolean(
        safeGet(`${storagePrefix}.showRestChooser`),
        true
      ),
    }),
    [defaultDetailsActionId, storagePrefix]
  );

  const [buildStepKey, setBuildStepKey] = useState(initialState.buildStepKey);
  const [openStage, setOpenStage] = useState(initialState.openStage);
  const [testComplete, setTestComplete] = useState(initialState.testComplete);
  const [feelChoice, setFeelChoice] = useState(initialState.feelChoice);
  const [restCompletionStage, setRestCompletionStage] = useState(
    initialState.restCompletionStage
  );
  const [detailsActionId, setDetailsActionId] = useState(
    initialState.detailsActionId
  );
  const [restModeId, setRestModeId] = useState(initialState.restModeId);
  const [restStepIndex, setRestStepIndex] = useState(initialState.restStepIndex);
  const [timerRemaining, setTimerRemaining] = useState(
    initialState.timerRemaining
  );
  const [timerRunning, setTimerRunning] = useState(initialState.timerRunning);
  const [selectedRestInstructionId, setSelectedRestInstructionId] = useState(
    initialState.selectedRestInstructionId
  );
  const [showRestChooser, setShowRestChooser] = useState(
    initialState.showRestChooser
  );

  useEffect(() => safeSet(`${storagePrefix}.openStage`, openStage || "rest"), [storagePrefix, openStage]);
  useEffect(() => safeSet(`${storagePrefix}.buildStepKey`, buildStepKey || "size"), [storagePrefix, buildStepKey]);
  useEffect(() => safeSet(`${storagePrefix}.testComplete`, testComplete ? "1" : "0"), [storagePrefix, testComplete]);
  useEffect(() => safeSet(`${storagePrefix}.feelChoice`, feelChoice || ""), [storagePrefix, feelChoice]);
  useEffect(() => safeSet(`${storagePrefix}.restCompletionStage`, restCompletionStage || ""), [storagePrefix, restCompletionStage]);
  useEffect(() => safeSet(`${storagePrefix}.detailsActionId`, detailsActionId || defaultDetailsActionId), [storagePrefix, detailsActionId, defaultDetailsActionId]);
  useEffect(() => safeSet(`${storagePrefix}.restModeId`, restModeId || ""), [storagePrefix, restModeId]);
  useEffect(() => safeSet(`${storagePrefix}.restStepIndex`, String(restStepIndex || 0)), [storagePrefix, restStepIndex]);
  useEffect(() => safeSet(`${storagePrefix}.timerRemaining`, String(Math.max(0, timerRemaining || 0))), [storagePrefix, timerRemaining]);
  useEffect(() => safeSet(`${storagePrefix}.selectedRestInstructionId`, selectedRestInstructionId || ""), [storagePrefix, selectedRestInstructionId]);
  useEffect(() => safeSet(`${storagePrefix}.showRestChooser`, showRestChooser ? "1" : "0"), [storagePrefix, showRestChooser]);

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
