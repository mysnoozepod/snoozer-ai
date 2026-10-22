"use strict";

const lineup = require("../data/official-showroom-lineup.v1.json");

const INTERNAL_NAME_PATTERN = /\b(?:BEDGEAR|S7|H6|M3|M5|Naked)\b/i;

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function validateOfficialShowroomLineup(document = lineup) {
  const errors = [];
  const displays = Array.isArray(document?.displays) ? document.displays : [];

  if (displays.length !== 5) {
    errors.push(`expected exactly five physical displays, found ${displays.length}`);
  }

  const ids = new Set();
  const internalModels = new Set();
  for (const display of displays) {
    const displayId = clean(display?.displayId);
    const internalModel = clean(display?.internalModel);
    const customerName = clean(display?.customerName);
    const variants = Array.isArray(display?.priceReference?.variants)
      ? display.priceReference.variants
      : [];

    if (!displayId) errors.push("display is missing displayId");
    if (ids.has(displayId)) errors.push(`duplicate displayId: ${displayId}`);
    ids.add(displayId);

    if (!internalModel) errors.push(`display ${displayId || "?"} is missing internalModel`);
    if (internalModels.has(internalModel)) errors.push(`duplicate internalModel: ${internalModel}`);
    internalModels.add(internalModel);

    if (!customerName) errors.push(`display ${displayId || "?"} is missing customerName`);
    if (INTERNAL_NAME_PATTERN.test(customerName)) {
      errors.push(`display ${displayId || "?"} exposes an internal supplier/model name to customers`);
    }

    if (!clean(display?.priceReference?.sheet) || !clean(display?.priceReference?.range)) {
      errors.push(`display ${displayId || "?"} is missing an auditable workbook reference`);
    }
    if (!variants.length) errors.push(`display ${displayId || "?"} has no approved price variants`);

    const sizes = new Set();
    for (const variant of variants) {
      const size = clean(variant?.size);
      if (!size) errors.push(`display ${displayId || "?"} has a price row without a size`);
      if (sizes.has(size)) errors.push(`display ${displayId || "?"} has duplicate size ${size}`);
      sizes.add(size);
      if (!clean(variant?.vendorItem)) {
        errors.push(`display ${displayId || "?"} size ${size || "?"} is missing vendor item identity`);
      }
      for (const field of ["landed", "dropShip", "upp"]) {
        if (!Number.isFinite(Number(variant?.[field])) || Number(variant[field]) <= 0) {
          errors.push(`display ${displayId || "?"} size ${size || "?"} has invalid ${field}`);
        }
      }
    }
  }

  const expectedIds = ["1", "2", "3", "4", "5"];
  if (expectedIds.some((id) => !ids.has(id))) {
    errors.push("display IDs must cover 1 through 5 exactly once");
  }

  return { ok: errors.length === 0, errors };
}

function getDisplayActivationBlockers(display) {
  const blockers = [...(Array.isArray(display?.blockers) ? display.blockers : [])];
  if (!clean(display?.displayConfiguration?.size)) blockers.push("Physical display size is not confirmed.");
  if (!clean(display?.displayConfiguration?.baseHandle)) blockers.push("Physical base pairing is not confirmed.");
  if (!clean(display?.shopify?.handle)) blockers.push("Shopify product handle is not verified.");
  if (display?.shopify?.commerceEnabled !== true) blockers.push("Commerce is not enabled.");
  if (display?.availability?.status !== "confirmed") blockers.push("Supplier availability is not confirmed.");
  return [...new Set(blockers)];
}

function getOfficialShowroomLineupReadiness(document = lineup) {
  const validation = validateOfficialShowroomLineup(document);
  const displays = (document.displays || []).map((display) => {
    const blockers = getDisplayActivationBlockers(display);
    return {
      displayId: clean(display.displayId),
      internalModel: clean(display.internalModel),
      customerName: clean(display.customerName),
      activationReady: blockers.length === 0,
      blockers,
      shopifyHandle: clean(display?.shopify?.handle) || null,
      displaySize: clean(display?.displayConfiguration?.size) || null,
      baseHandle: clean(display?.displayConfiguration?.baseHandle) || null,
      availabilityStatus: clean(display?.availability?.status) || "unknown",
    };
  });

  return {
    version: clean(document.version),
    schemaValid: validation.ok,
    validationErrors: validation.errors,
    activationReady: validation.ok && displays.every((display) => display.activationReady),
    readyDisplayCount: displays.filter((display) => display.activationReady).length,
    totalDisplayCount: displays.length,
    displays,
  };
}

module.exports = {
  getDisplayActivationBlockers,
  getOfficialShowroomLineupReadiness,
  validateOfficialShowroomLineup,
};
