import { plannedCartLineKey } from "./cartContract.mjs";

function text(value) {
  return String(value ?? "").trim();
}

export function confirmedCartItemCount(items = []) {
  return (Array.isArray(items) ? items : []).reduce(
    (total, item) => total + Math.max(0, Number(item?.quantity) || 0),
    0
  );
}

export function findConfirmedCartItem(items, requestedItem) {
  const confirmedItems = Array.isArray(items) ? items : [];
  if (!requestedItem) return null;

  const requestedLineId = text(requestedItem.lineId);
  if (requestedLineId) {
    const exactLine = confirmedItems.find(
      (item) => text(item?.lineId) === requestedLineId
    );
    if (exactLine) return exactLine;
  }

  const requestedKey = plannedCartLineKey(requestedItem);
  if (!requestedKey) return null;
  return (
    confirmedItems.find((item) => plannedCartLineKey(item) === requestedKey) ||
    null
  );
}

export function createCartAuthorityCoordinator() {
  let mutationEpoch = 0;
  let latestSyncSequence = 0;

  return {
    beginMutation() {
      mutationEpoch += 1;
      return mutationEpoch;
    },
    endMutation() {
      mutationEpoch += 1;
      return mutationEpoch;
    },
    beginSync() {
      latestSyncSequence += 1;
      return {
        mutationEpoch,
        sequence: latestSyncSequence,
      };
    },
    shouldApplySync(token) {
      return Boolean(
        token &&
          token.mutationEpoch === mutationEpoch &&
          token.sequence === latestSyncSequence
      );
    },
    snapshot() {
      return { mutationEpoch, latestSyncSequence };
    },
  };
}

export const cartAuthorityCoordinator = createCartAuthorityCoordinator();
