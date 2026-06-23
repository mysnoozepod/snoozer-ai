const customerProfile = require("./customerProfile");
const customerProfileZohoSync = require("./customerProfileZohoSync");
const recommendationResolver = require("./recommendationResolver");
const snoozeIdentity = require("./snoozeIdentity");
const { loadShowroomManifest } = require("./showroomManifest");

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeLower(value) {
  return cleanString(value).toLowerCase();
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => cleanString(value)).filter(Boolean))];
}

function clone(value) {
  return isObject(value) || Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : value;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(value) {
  return normalizeLower(value);
}

function normalizePhone(value) {
  return cleanString(value).replace(/[^\d+]/g, "");
}

function parseQueryParams(value) {
  const raw = cleanString(value);
  if (!raw) return {};

  try {
    const url = raw.startsWith("http://") || raw.startsWith("https://")
      ? new URL(raw)
      : new URL(raw, "https://mysnoozepod.com");
    const out = {};
    for (const [key, entry] of url.searchParams.entries()) {
      out[key] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

function firstNonEmpty(values = []) {
  for (const value of values) {
    const normalized = cleanString(value);
    if (normalized) return normalized;
  }
  return "";
}

function firstLikelySnoozeCode(values = []) {
  for (const value of values) {
    const code = snoozeIdentity.normalizeSnoozeCode(value);
    if (code) return code;
  }
  return "";
}

function normalizeQuestionsAndAnswers(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((entry) => {
      if (!entry) return null;
      const question = cleanString(entry.question || entry.name || entry.label);
      const answer = cleanString(entry.answer || entry.value || entry.response);
      if (!question && !answer) return null;
      return {
        question,
        answer,
        position: Number(entry.position || 0) || undefined,
      };
    })
    .filter(Boolean);
}

function findQuestionAnswer(questionsAndAnswers = [], labels = []) {
  const normalizedLabels = labels.map((label) => normalizeLower(label)).filter(Boolean);
  if (!normalizedLabels.length) return "";

  for (const entry of questionsAndAnswers) {
    const question = normalizeLower(entry?.question);
    if (!question) continue;
    if (normalizedLabels.some((label) => question.includes(label))) {
      return cleanString(entry?.answer);
    }
  }

  return "";
}

function normalizeLocation(locationValue) {
  if (typeof locationValue === "string") {
    return {
      type: "",
      value: cleanString(locationValue),
    };
  }

  if (!isObject(locationValue)) {
    return { type: "", value: "" };
  }

  return {
    type: cleanString(locationValue.type || locationValue.kind),
    value: cleanString(
      locationValue.location ||
        locationValue.join_url ||
        locationValue.phone_number ||
        locationValue.details
    ),
  };
}

function normalizeTracking(tracking = {}) {
  if (!isObject(tracking)) return {};
  return {
    utm_source: cleanString(tracking.utm_source),
    utm_medium: cleanString(tracking.utm_medium),
    utm_campaign: cleanString(tracking.utm_campaign),
    utm_content: cleanString(tracking.utm_content),
    utm_term: cleanString(tracking.utm_term),
  };
}

function normalizeBookingPayload(input = {}) {
  const root = isObject(input) ? input : {};
  const payload = isObject(root.payload)
    ? root.payload
    : isObject(root.data?.payload)
      ? root.data.payload
      : root;

  const invitee = isObject(payload.invitee)
    ? payload.invitee
    : isObject(root.invitee)
      ? root.invitee
      : {};
  const scheduledEvent = isObject(payload.scheduled_event)
    ? payload.scheduled_event
    : isObject(root.scheduled_event)
      ? root.scheduled_event
      : {};
  const eventTypeObject = isObject(payload.event_type)
    ? payload.event_type
    : isObject(scheduledEvent.event_type)
      ? scheduledEvent.event_type
      : {};
  const tracking = normalizeTracking(payload.tracking || invitee.tracking || root.tracking);
  const questionsAndAnswers = normalizeQuestionsAndAnswers(
    payload.questions_and_answers ||
      invitee.questions_and_answers ||
      root.questions_and_answers ||
      []
  );
  const location = normalizeLocation(
    scheduledEvent.location || payload.location || invitee.location || root.location
  );

  return {
    raw: root,
    payload,
    eventType: cleanString(root.event || payload.event || root.type || payload.type),
    eventKind: cleanString(eventTypeObject.kind || scheduledEvent.event_type_name || payload.event_type_name),
    eventName: cleanString(eventTypeObject.name || scheduledEvent.name || payload.name),
    invitee,
    scheduledEvent,
    inviteeUri: cleanString(invitee.uri || payload.invitee_uri || root.invitee_uri),
    eventUri: cleanString(scheduledEvent.uri || payload.event_uri || root.event_uri),
    cancelUrl: cleanString(invitee.cancel_url || payload.cancel_url),
    rescheduleUrl: cleanString(invitee.reschedule_url || payload.reschedule_url),
    timezone: cleanString(
      invitee.timezone || payload.timezone || scheduledEvent.timezone || root.timezone
    ),
    startTime: cleanString(
      scheduledEvent.start_time || payload.start_time || invitee.start_time || root.start_time
    ),
    endTime: cleanString(
      scheduledEvent.end_time || payload.end_time || invitee.end_time || root.end_time
    ),
    createdAt: cleanString(
      invitee.created_at || payload.created_at || scheduledEvent.created_at || root.created_at
    ),
    email: normalizeEmail(
      invitee.email || payload.email || payload.invitee_email || root.email
    ),
    phone: normalizePhone(
      invitee.phone_number ||
        invitee.text_reminder_number ||
        payload.phone_number ||
        root.phone_number ||
        root.phone
    ),
    name: cleanString(invitee.name || payload.name || root.name),
    firstName: cleanString(invitee.first_name || payload.first_name || root.first_name),
    lastName: cleanString(invitee.last_name || payload.last_name || root.last_name),
    locationType: location.type,
    locationValue: location.value,
    questionsAndAnswers,
    tracking,
    queryParams: Object.assign(
      {},
      parseQueryParams(invitee.uri),
      parseQueryParams(scheduledEvent.uri),
      parseQueryParams(invitee.cancel_url),
      parseQueryParams(invitee.reschedule_url),
      parseQueryParams(payload.uri),
      parseQueryParams(root.uri)
    ),
    shopperId: cleanString(payload.shopperId || root.shopperId),
    snoozeCode: cleanString(payload.snoozeCode || root.snoozeCode),
    accessCode: cleanString(payload.accessCode || root.accessCode),
  };
}

function asNormalizedBookingPayload(input = {}) {
  return isObject(input) && isObject(input.queryParams) && isObject(input.tracking)
    ? input
    : normalizeBookingPayload(input);
}

function extractBookingIdentity(input = {}) {
  const booking = asNormalizedBookingPayload(input);
  const questionCode = findQuestionAnswer(booking.questionsAndAnswers, [
    "snooze code",
    "access code",
    "shopper id",
    "mysnoozepod code",
  ]);
  const queryCode = firstLikelySnoozeCode([
    booking.queryParams.snoozeCode,
    booking.queryParams.accessCode,
    booking.queryParams.shopperId,
    booking.queryParams.utm_content,
    booking.queryParams.utm_term,
  ]);

  return {
    snoozeCode: firstLikelySnoozeCode([
      booking.snoozeCode,
      booking.accessCode,
      questionCode,
      queryCode,
      booking.tracking.utm_content,
      booking.tracking.utm_term,
    ]),
    accessCode: firstLikelySnoozeCode([
      booking.accessCode,
      booking.snoozeCode,
      questionCode,
      queryCode,
      booking.tracking.utm_content,
      booking.tracking.utm_term,
    ]),
    shopperId: cleanString(booking.shopperId),
    inviteeUri: cleanString(booking.inviteeUri),
    eventUri: cleanString(booking.eventUri),
    email: normalizeEmail(booking.email),
    phone: normalizePhone(booking.phone),
    sourceShopperId: cleanString(booking.shopperId),
    trackingCode: firstLikelySnoozeCode([
      booking.tracking.utm_content,
      booking.tracking.utm_term,
      queryCode,
    ]),
  };
}

function hasBookingIdentityEvidence(booking = {}, bookingIdentity = {}) {
  return Boolean(
    cleanString(bookingIdentity?.shopperId) ||
      cleanString(bookingIdentity?.snoozeCode) ||
      cleanString(bookingIdentity?.accessCode) ||
      cleanString(bookingIdentity?.inviteeUri) ||
      cleanString(bookingIdentity?.eventUri) ||
      cleanString(bookingIdentity?.email) ||
      cleanString(bookingIdentity?.phone) ||
      cleanString(booking?.name) ||
      cleanString(booking?.startTime)
  );
}

function getDependencies(options = {}) {
  return {
    customerProfileGet:
      typeof options.getCustomerProfile === "function"
        ? options.getCustomerProfile
        : customerProfile.getCustomerProfile,
    customerProfileUpsert:
      typeof options.upsertCustomerProfile === "function"
        ? options.upsertCustomerProfile
        : customerProfile.upsertCustomerProfile,
    buildCustomerProfilePatch:
      typeof options.buildCustomerProfilePatch === "function"
        ? options.buildCustomerProfilePatch
        : customerProfile.buildCustomerProfilePatch,
    syncCustomerProfileToZoho:
      typeof options.syncCustomerProfileToZoho === "function"
        ? options.syncCustomerProfileToZoho
        : customerProfileZohoSync.syncCustomerProfileToZoho,
    resolveCanonicalIdentity:
      typeof options.resolveCanonicalIdentity === "function"
        ? options.resolveCanonicalIdentity
        : snoozeIdentity.resolveCanonicalIdentity,
    issueSnoozeCode:
      typeof options.issueSnoozeCode === "function"
        ? options.issueSnoozeCode
        : snoozeIdentity.issueSnoozeCode,
    resolveRecommendation:
      typeof options.resolveRecommendation === "function"
        ? options.resolveRecommendation
        : recommendationResolver.resolveRecommendation,
  };
}

async function getProfileById(profileId = "", options = {}) {
  const normalizedProfileId = cleanString(profileId);
  if (!normalizedProfileId) return null;
  const deps = getDependencies(options);

  if (typeof options.getProfileById === "function") {
    return (await options.getProfileById(normalizedProfileId)) || null;
  }

  const result = await deps.customerProfileGet({ profileId: normalizedProfileId });
  return result?.profile || null;
}

async function getProfileByIdentity(identity = {}, options = {}) {
  const profileId = cleanString(identity?.profileId);
  if (profileId) {
    const byProfileId = await getProfileById(profileId, options);
    if (byProfileId) return byProfileId;
  }

  const shopperId = cleanString(identity?.shopperId);
  if (shopperId) {
    const byShopperId = await getProfileById(`shopper#${shopperId}`, options);
    if (byShopperId) return byShopperId;
  }

  return null;
}

function buildAliasProfileId(kind, value) {
  const normalizedKind = cleanString(kind);
  const normalizedValue =
    normalizedKind === "email"
      ? normalizeEmail(value)
      : normalizedKind === "phone"
        ? normalizePhone(value)
        : cleanString(value);

  return normalizedKind && normalizedValue ? `alias#${normalizedKind}:${normalizedValue}` : "";
}

function canonicalCodeFromProfile(profile = {}) {
  return firstLikelySnoozeCode([
    profile?.snoozeCode,
    profile?.accessCode,
    profile?.shopperId,
    profile?.aliasOfShopperId,
    profile?.mergedIntoShopperId,
  ]);
}

function buildResolvedIdentityFromProfile(profile = {}, meta = {}) {
  const snoozeCode = canonicalCodeFromProfile(profile);
  if (!snoozeCode) return null;
  const canonicalProfileId =
    cleanString(profile.aliasOfProfileId) ||
    (cleanString(profile.aliasOfShopperId)
      ? `shopper#${cleanString(profile.aliasOfShopperId)}`
      : "") ||
    cleanString(profile.profileId) ||
    `shopper#${snoozeCode}`;

  return {
    shopperId: snoozeCode,
    snoozeCode,
    accessCode: snoozeCode,
    profileId: canonicalProfileId,
    identityType: "snooze_code",
    identitySource: cleanString(meta.identitySource) || "stored_alias",
    isTemporary: false,
    sourceShopperId: cleanString(meta.sourceShopperId) || cleanString(profile.sourceShopperId) || null,
    aliases: uniqueStrings([]
      .concat(Array.isArray(profile.identityAliases) ? profile.identityAliases : [])
      .concat(Array.isArray(meta.aliases) ? meta.aliases : [])),
    sessionId: cleanString(meta.sessionId) || null,
    threadId: cleanString(meta.threadId) || null,
    visitorId: cleanString(meta.visitorId) || null,
  };
}

function buildProfileReadIdentity(bookingIdentity = {}, booking = {}) {
  return {
    shopperId: cleanString(bookingIdentity.shopperId),
    snoozeCode: cleanString(bookingIdentity.snoozeCode),
    accessCode: cleanString(bookingIdentity.accessCode),
    sourceShopperId: cleanString(bookingIdentity.sourceShopperId),
    sessionId: cleanString(booking.sessionId || booking.inviteeUri || booking.eventUri),
    threadId: cleanString(booking.threadId || booking.inviteeUri || booking.eventUri),
    visitorId: "",
  };
}

async function resolveBookingIdentity(input, options = {}) {
  const booking = asNormalizedBookingPayload(input);
  const bookingIdentity = extractBookingIdentity(booking);
  const deps = getDependencies(options);

  let resolvedIdentity = null;
  const identityInput = buildProfileReadIdentity(bookingIdentity, booking);

  if (
    bookingIdentity.snoozeCode ||
    bookingIdentity.accessCode ||
    bookingIdentity.shopperId
  ) {
    resolvedIdentity = await deps.resolveCanonicalIdentity(identityInput, {
      getProfileById: async (profileId) => await getProfileById(profileId, options),
    });
  }

  const aliasChecks = [
    ["booking_invitee", bookingIdentity.inviteeUri],
    ["booking_event", bookingIdentity.eventUri],
    ["email", bookingIdentity.email],
    ["phone", bookingIdentity.phone],
  ];

  if (!resolvedIdentity || resolvedIdentity.isTemporary) {
    for (const [kind, value] of aliasChecks) {
      const profileId = buildAliasProfileId(kind, value);
      if (!profileId) continue;
      const aliasProfile = await getProfileById(profileId, options);
      const identityFromAlias = buildResolvedIdentityFromProfile(aliasProfile, {
        identitySource: "stored_alias",
        sourceShopperId:
          cleanString(bookingIdentity.sourceShopperId) || cleanString(resolvedIdentity?.sourceShopperId),
      });
      if (identityFromAlias) {
        resolvedIdentity = identityFromAlias;
        break;
      }
    }
  }

  let issuedIdentity = null;
  if (
    booking.eventType === "invitee.created" &&
    (!resolvedIdentity || resolvedIdentity.isTemporary) &&
    hasBookingIdentityEvidence(booking, bookingIdentity)
  ) {
    issuedIdentity = await deps.issueSnoozeCode(
      {
        ...identityInput,
        reason: "booking_started",
        sourceSurface: "calendly_booking",
        identity: resolvedIdentity || null,
      },
      {
        getProfileById: async (profileId) => await getProfileById(profileId, options),
      }
    );
  }

  const finalIdentity =
    issuedIdentity && firstLikelySnoozeCode([issuedIdentity.snoozeCode, issuedIdentity.shopperId])
      ? issuedIdentity
      : resolvedIdentity;
  const canonicalProfile = await getProfileByIdentity(finalIdentity || {}, options);
  let sourceProfile = null;
  if (
    !canonicalProfile &&
    resolvedIdentity &&
    cleanString(resolvedIdentity.profileId) &&
    cleanString(resolvedIdentity.profileId) !== cleanString(finalIdentity?.profileId)
  ) {
    sourceProfile = await getProfileByIdentity(resolvedIdentity, options);
  }
  const existingProfile = canonicalProfile || sourceProfile || null;

  return {
    booking,
    extractedIdentity: bookingIdentity,
    resolvedIdentity: resolvedIdentity || null,
    issuedIdentity: issuedIdentity || null,
    identity: finalIdentity || resolvedIdentity || null,
    canonicalProfile: canonicalProfile || null,
    sourceProfile: sourceProfile || null,
    existingProfile,
  };
}

function getManifestLookups() {
  try {
    const manifest = loadShowroomManifest();
    const productByHandle = new Map(
      (Array.isArray(manifest.products) ? manifest.products : []).map((product) => [
        cleanString(product.handle),
        product,
      ])
    );
    const podById = new Map(
      (Array.isArray(manifest.pods) ? manifest.pods : []).map((pod) => [
        cleanString(pod.podId),
        pod,
      ])
    );
    return { manifest, productByHandle, podById };
  } catch {
    return { manifest: null, productByHandle: new Map(), podById: new Map() };
  }
}

function titleFromHandle(handle = "", fallbackLookups = null) {
  const normalizedHandle = cleanString(handle);
  if (!normalizedHandle) return "";

  const lookups = fallbackLookups || getManifestLookups();
  const product = lookups.productByHandle.get(normalizedHandle);
  if (product?.title) return cleanString(product.title);

  return normalizedHandle
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function podNameFromId(podId = "", fallbackLookups = null) {
  const normalizedPodId = cleanString(podId);
  if (!normalizedPodId) return "";

  const lookups = fallbackLookups || getManifestLookups();
  const pod = lookups.podById.get(normalizedPodId);
  return cleanString(pod?.name) || `SnoozePod ${normalizedPodId}`;
}

function determineRiskFlags(assessment = {}, canonical = {}, bookingContext = {}) {
  const answers = isObject(assessment?.answers) ? assessment.answers : assessment;
  const riskFlags = [];
  const pushFlag = (value) => {
    const normalized = cleanString(value);
    if (normalized) riskFlags.push(normalized);
  };

  if (normalizeLower(answers?.temperature).includes("hot")) pushFlag("hot_sleeper");
  if (normalizeLower(answers?.baseType).includes("no base")) pushFlag("no_base");
  if (normalizeLower(answers?.sleepPartner) === "yes") pushFlag("partner_sleep");
  if (normalizeLower(canonical?.motionKey).includes("split")) pushFlag("split_motion");
  if (Array.isArray(canonical?.reasonKeys) && canonical.reasonKeys.includes("back_or_stomach_support")) {
    pushFlag("support_priority");
  }
  if (Array.isArray(canonical?.warnings)) {
    canonical.warnings.forEach((warning) => pushFlag(warning));
  }
  if (bookingContext?.bookingLocationType === "phone") pushFlag("phone_session");

  return uniqueStrings(riskFlags);
}

function buildComfortSummary({ canonicalRecommendation, lookups }) {
  const canonical = isObject(canonicalRecommendation) ? canonicalRecommendation : null;
  if (!canonical?.topPodId) {
    return "No recommendation is locked yet, so start by reviewing your Snooze Assessment before the session.";
  }

  const podName = cleanString(canonical.topPodName) || podNameFromId(canonical.topPodId, lookups);
  const mattressTitle =
    cleanString(canonical.primaryMattressTitle) ||
    titleFromHandle(canonical.primaryMattressHandle, lookups);
  const baseTitle =
    canonical.baseHandle == null
      ? "No Base"
      : cleanString(canonical.baseTitle) || titleFromHandle(canonical.baseHandle, lookups);
  const motionLabel =
    cleanString(canonical.motionLabel || canonical.motionKey) || "No Motion";

  return `${podName} is the starting point, using ${mattressTitle}, ${baseTitle}, and ${motionLabel}.`;
}

function buildSessionPrep(profileOrPatch, bookingContext = {}) {
  const lookups = getManifestLookups();
  const profile = isObject(profileOrPatch) ? profileOrPatch : {};
  const canonical = isObject(profile.canonicalRecommendation)
    ? profile.canonicalRecommendation
    : null;
  const assessment = isObject(profile.assessmentAnswers) ? profile.assessmentAnswers : null;
  const topPodId = cleanString(
    profile.topPodId || canonical?.topPodId || profile.sessionPrep?.recommendedStartingPod
  );
  const topPodIds = uniqueStrings(
    []
      .concat(Array.isArray(profile.topPodIds) ? profile.topPodIds : [])
      .concat(Array.isArray(canonical?.topPodIds) ? canonical.topPodIds : [])
  );
  const primaryMattressHandle = cleanString(
    profile.primaryMattressHandle || canonical?.primaryMattressHandle
  );
  const baseHandle =
    Object.prototype.hasOwnProperty.call(profile, "baseHandle")
      ? profile.baseHandle
      : canonical && Object.prototype.hasOwnProperty.call(canonical, "baseHandle")
        ? canonical.baseHandle
        : null;
  const motionKey = cleanString(profile.motionKey || canonical?.motionKey);
  const motionLabel =
    cleanString(canonical?.motionLabel || canonical?.normalizedAssessment?.motionLabel || motionKey);
  const bookingStatus = cleanString(bookingContext.bookingStatus) || "scheduled";
  const commonFields = {
    shopperId: cleanString(bookingContext.shopperId || profile.shopperId) || null,
    profileId: cleanString(bookingContext.profileId || profile.profileId) || null,
    snoozeCode:
      cleanString(
        bookingContext.snoozeCode || profile.snoozeCode || profile.accessCode || profile.shopperId
      ) || null,
    bookingEventUri: cleanString(bookingContext.bookingEventUri) || null,
    bookingInviteeUri: cleanString(bookingContext.bookingInviteeUri) || null,
    bookingStartTime: cleanString(bookingContext.bookingStartTime) || null,
    bookingEndTime: cleanString(bookingContext.bookingEndTime) || null,
    updatedAt: nowIso(),
  };
  const partnerNotes = [];

  if (normalizeLower(assessment?.sleepPartner) === "yes") {
    partnerNotes.push("Guide both sleepers through the first pod before splitting comparisons.");
  }
  if (
    normalizeLower(assessment?.firmness) &&
    normalizeLower(assessment?.partnerFirmness) &&
    normalizeLower(assessment?.firmness) !== normalizeLower(assessment?.partnerFirmness)
  ) {
    partnerNotes.push("Comfort preferences differ, so compare each side separately.");
  }

  const questionsToAsk = [];
  if (motionKey.includes("split")) {
    questionsToAsk.push("Compare how each side feels when both sleepers settle in.");
  }
  if (normalizeLower(assessment?.temperature).includes("hot")) {
    questionsToAsk.push("Check airflow and surface temperature in your normal sleep position.");
  }
  if (Array.isArray(assessment?.painPoints) && assessment.painPoints.length) {
    questionsToAsk.push("Notice pressure relief in the areas that usually bother you.");
  }
  if (!questionsToAsk.length && topPodId) {
    questionsToAsk.push("Spend a few minutes in your usual sleep position before switching pods.");
  }

  if (!topPodId || !primaryMattressHandle) {
    const openConcerns = determineRiskFlags(assessment || {}, canonical || {}, bookingContext);
    const sessionInstructions = uniqueStrings(
      questionsToAsk.concat("Complete the Snooze Assessment before the visit.")
    );
    return {
      ...commonFields,
      status: "needs_assessment",
      generatedAt: nowIso(),
      source: cleanString(bookingContext.source) || "booking_webhook",
      recommendedStartingPod: null,
      recommendedPodIds: topPodIds,
      primaryMattressHandle: primaryMattressHandle || null,
      startingMattressHandle: primaryMattressHandle || null,
      baseHandle: baseHandle == null ? null : cleanString(baseHandle) || null,
      motionKey: motionKey || null,
      motionLabel: motionLabel || null,
      comfortSummary:
        "This booking is attached to a Snooze Code, but a fresh assessment is still needed before the visit is fully prepped.",
      customerFitSummary:
        "This booking is attached to a Snooze Code, but a fresh assessment is still needed before the visit is fully prepped.",
      showroomStartingPoint: "Start with the Snooze Assessment before the visit so the showroom path is grounded.",
      podsToTry: topPodIds,
      questionsToAsk: sessionInstructions,
      sessionInstructions,
      riskFlags: openConcerns,
      openConcerns,
      partnerNotes,
      budgetNotes: cleanString(assessment?.budget) || null,
      staffNotes: "",
      snoozerOpeningContext:
        "A booking exists, but this shopper still needs a grounded assessment before the visit can be guided confidently.",
    };
  }

  const podName = cleanString(canonical?.topPodName) || podNameFromId(topPodId, lookups);
  const secondaryPods = topPodIds.slice(1, 3).map((podId) => podNameFromId(podId, lookups));
  const showroomStartingPoint = secondaryPods.length
    ? `Start with ${podName}, then compare ${secondaryPods.join(" and ")}.`
    : `Start with ${podName} first.`;
  const comfortSummary = buildComfortSummary({ canonicalRecommendation: canonical || profile, lookups });
  const openConcerns = determineRiskFlags(assessment || {}, canonical || {}, bookingContext);
  const sessionInstructions = uniqueStrings(questionsToAsk);
  const snoozerOpeningContext = [
    bookingStatus === "scheduled"
      ? "A Snooze Session is booked."
      : "A Snooze Session profile exists.",
    showroomStartingPoint,
    comfortSummary,
  ].filter(Boolean).join(" ");

  if (bookingStatus === "canceled") {
    return {
      ...commonFields,
      status: "canceled",
      generatedAt: nowIso(),
      source: cleanString(bookingContext.source) || "booking_webhook",
      recommendedStartingPod: topPodId,
      recommendedPodIds: topPodIds,
      primaryMattressHandle,
      startingMattressHandle: primaryMattressHandle,
      baseHandle: baseHandle == null ? null : cleanString(baseHandle) || null,
      motionKey: motionKey || null,
      motionLabel: motionLabel || null,
      comfortSummary,
      customerFitSummary: comfortSummary,
      showroomStartingPoint,
      podsToTry: topPodIds,
      questionsToAsk: sessionInstructions,
      sessionInstructions: [
        "This Snooze Session was canceled, so rebook before using this plan on the showroom floor.",
      ].concat(sessionInstructions),
      riskFlags: openConcerns,
      openConcerns,
      partnerNotes,
      budgetNotes: cleanString(assessment?.budget) || null,
      staffNotes: "",
      snoozerOpeningContext:
        "This Snooze Session was canceled. Rebook the visit before using the saved showroom plan.",
    };
  }

  return {
    ...commonFields,
    status: "ready",
    generatedAt: nowIso(),
    source: cleanString(bookingContext.source) || "booking_webhook",
    recommendedStartingPod: topPodId,
    recommendedPodIds: topPodIds,
    primaryMattressHandle,
    startingMattressHandle: primaryMattressHandle,
    baseHandle: baseHandle == null ? null : cleanString(baseHandle) || null,
    motionKey: motionKey || null,
    motionLabel: motionLabel || null,
    comfortSummary,
    customerFitSummary: comfortSummary,
    showroomStartingPoint,
    podsToTry: topPodIds,
    questionsToAsk: sessionInstructions,
    sessionInstructions,
    riskFlags: openConcerns,
    openConcerns,
    partnerNotes,
    budgetNotes: cleanString(assessment?.budget) || null,
    staffNotes: "",
    snoozerOpeningContext,
  };
}

async function materializeCanonicalRecommendation(existingProfile = {}, options = {}) {
  const profile = isObject(existingProfile) ? existingProfile : {};
  if (isObject(profile.canonicalRecommendation) && cleanString(profile.canonicalRecommendation.topPodId)) {
    return clone(profile.canonicalRecommendation);
  }

  const assessmentInput = isObject(profile.assessmentAnswers) ? profile.assessmentAnswers : null;
  const deps = getDependencies(options);
  if (!assessmentInput || typeof deps.resolveRecommendation !== "function") return null;

  const resolved = await deps.resolveRecommendation({
    assessment: assessmentInput,
    includeProducts: true,
    includePods: true,
    source: "booking_session",
  });
  const recommendation = isObject(resolved?.recommendation) ? resolved.recommendation : {};
  const normalizedAssessment = isObject(resolved?.normalizedAssessment)
    ? clone(resolved.normalizedAssessment)
    : {};
  const lookups = getManifestLookups();

  return {
    manifestVersion: cleanString(resolved?.manifestVersion) || null,
    normalizedAssessment,
    topPodId: cleanString(recommendation.topPodId) || null,
    topPodName: podNameFromId(recommendation.topPodId, lookups) || null,
    topPodIds: uniqueStrings(Array.isArray(recommendation.topPodIds) ? recommendation.topPodIds : []),
    primaryMattressHandle: cleanString(recommendation.primaryMattressHandle) || null,
    primaryMattressTitle: titleFromHandle(recommendation.primaryMattressHandle, lookups) || null,
    baseHandle:
      recommendation.baseHandle == null ? null : cleanString(recommendation.baseHandle) || null,
    baseTitle:
      recommendation.baseHandle == null
        ? "No Base"
        : titleFromHandle(recommendation.baseHandle, lookups) || null,
    motionKey: cleanString(recommendation.motionKey || normalizedAssessment.motionKey) || null,
    motionLabel: cleanString(recommendation.motionLabel || normalizedAssessment.motionLabel) || null,
    reasonKeys: uniqueStrings(Array.isArray(recommendation.reasonKeys) ? recommendation.reasonKeys : []),
    warnings: uniqueStrings(
      []
        .concat(Array.isArray(recommendation.warnings) ? recommendation.warnings : [])
        .concat(Array.isArray(normalizedAssessment.warnings) ? normalizedAssessment.warnings : [])
    ),
  };
}

function buildBookingProfilePatch(input = {}) {
  const identity = isObject(input.identity) ? input.identity : {};
  const booking = isObject(input.booking) ? input.booking : {};
  const existingProfile = isObject(input.existingProfile) ? input.existingProfile : {};
  const canonicalRecommendation = isObject(input.canonicalRecommendation)
    ? input.canonicalRecommendation
    : null;
  const sessionPrep = isObject(input.sessionPrep) ? input.sessionPrep : null;
  const bookingStatus = cleanString(input.bookingStatus) || "scheduled";
  const isCanceled = bookingStatus === "canceled";
  const contactName = cleanString(booking.name);
  const [firstToken, ...restTokens] = contactName.split(/\s+/).filter(Boolean);
  const preferredName = cleanString(input.preferredName || booking.firstName || firstToken);

  return {
    shopperId: cleanString(identity.shopperId) || undefined,
    snoozeCode: cleanString(identity.snoozeCode || identity.shopperId) || undefined,
    accessCode: cleanString(identity.accessCode || identity.shopperId) || undefined,
    profileId: cleanString(identity.profileId) || undefined,
    identityType: cleanString(identity.identityType) || "snooze_code",
    identitySource: cleanString(identity.identitySource) || "booking_webhook",
    sourceShopperId: cleanString(identity.sourceShopperId) || undefined,
    email: normalizeEmail(booking.email) || existingProfile.email || undefined,
    phone: normalizePhone(booking.phone) || existingProfile.phone || undefined,
    preferredName: preferredName || existingProfile.preferredName || undefined,
    canonicalRecommendation: canonicalRecommendation || existingProfile.canonicalRecommendation || undefined,
    assessmentAnswers: isObject(existingProfile.assessmentAnswers)
      ? clone(existingProfile.assessmentAnswers)
      : undefined,
    leadStage: "booked",
    sourceSurface: "calendly_booking",
    lastIntent: isCanceled ? "booking_canceled" : "booking_scheduled",
    bookingStatus,
    bookingSource: "calendly",
    bookingEventUri: cleanString(booking.eventUri) || undefined,
    bookingInviteeUri: cleanString(booking.inviteeUri) || undefined,
    bookingStartTime: cleanString(booking.startTime) || undefined,
    bookingEndTime: cleanString(booking.endTime) || undefined,
    bookingTimezone: cleanString(booking.timezone) || undefined,
    bookingLocationType: cleanString(booking.locationType) || undefined,
    bookingLocation: cleanString(booking.locationValue) || undefined,
    bookingCreatedAt: cleanString(booking.createdAt) || nowIso(),
    bookingCanceledAt: isCanceled ? nowIso() : undefined,
    bookingEventType: cleanString(booking.eventKind || booking.eventType) || undefined,
    bookingEventName: cleanString(booking.eventName) || undefined,
    sessionPrep: sessionPrep || existingProfile.sessionPrep || undefined,
    sessionPrepStatus: cleanString(sessionPrep?.status || existingProfile.sessionPrep?.status) || undefined,
    lastInteractionAt: nowIso(),
  };
}

function buildBookingAliasPatches(identity = {}, booking = {}, profilePatch = {}) {
  const canonicalShopperId = cleanString(identity.shopperId);
  if (!canonicalShopperId || !snoozeIdentity.isLikelySnoozeCode(canonicalShopperId)) {
    return [];
  }

  const basePatch = {
    shopperId: canonicalShopperId,
    snoozeCode: cleanString(identity.snoozeCode || canonicalShopperId) || canonicalShopperId,
    accessCode: cleanString(identity.accessCode || canonicalShopperId) || canonicalShopperId,
    identityType: "identity_alias",
    identitySource: "booking_alias",
    isTemporary: false,
    aliasOfShopperId: canonicalShopperId,
    aliasOfProfileId: cleanString(identity.profileId) || `shopper#${canonicalShopperId}`,
    sourceSurface: "calendly_booking",
    leadStage: cleanString(profilePatch.leadStage) || "booked",
    lastIntent: cleanString(profilePatch.lastIntent) || "booking_scheduled",
    lastInteractionAt: cleanString(profilePatch.lastInteractionAt) || nowIso(),
  };

  const aliasEntries = [
    ["booking_invitee", booking.inviteeUri],
    ["booking_event", booking.eventUri],
    ["email", booking.email],
    ["phone", booking.phone],
  ]
    .map(([kind, value]) => {
      const profileId = buildAliasProfileId(kind, value);
      if (!profileId) return null;
      return {
        ...basePatch,
        profileId,
        aliasKind: kind,
        aliasValue:
          kind === "email"
            ? normalizeEmail(value)
            : kind === "phone"
              ? normalizePhone(value)
              : cleanString(value),
      };
    })
    .filter(Boolean);

  return aliasEntries.filter((entry, index, collection) => {
    return collection.findIndex((candidate) => candidate.profileId === entry.profileId) === index;
  });
}

async function upsertBookingSession(input, options = {}) {
  const booking = asNormalizedBookingPayload(input);
  const deps = getDependencies(options);
  const logger = typeof options.log === "function" ? options.log : () => {};

  logger("booking.webhook.received", "received", {
    route: cleanString(options.route) || null,
    eventType: booking.eventType || null,
    sourceSurface: "calendly_booking",
    bookingStatus: booking.eventType === "invitee.canceled" ? "canceled" : "scheduled",
    bookingStartTime: booking.startTime || null,
    contactEmailPresent: Boolean(booking.email),
    contactPhonePresent: Boolean(booking.phone),
  });

  const identityResolution = await resolveBookingIdentity(booking, options);
  const resolvedIdentity = identityResolution.identity;
  const bookingStatus = booking.eventType === "invitee.canceled" ? "canceled" : "scheduled";

  if (!resolvedIdentity || !cleanString(resolvedIdentity.shopperId)) {
    logger("booking.profile.error", "BOOKING_IDENTITY_UNRESOLVED", {
      route: cleanString(options.route) || null,
      eventType: booking.eventType || null,
      sourceSurface: "calendly_booking",
      bookingStatus,
      incomingShopperId: cleanString(identityResolution.extractedIdentity?.shopperId) || null,
      canonicalShopperId: null,
      snoozeCode: null,
      profileId: null,
      bookingStartTime: booking.startTime || null,
      contactEmailPresent: Boolean(booking.email),
      contactPhonePresent: Boolean(booking.phone),
      reason: "BOOKING_IDENTITY_UNRESOLVED",
    });

    return {
      ok: true,
      skipped: true,
      reason: "BOOKING_IDENTITY_UNRESOLVED",
      booking,
      identity: null,
      profilePatch: null,
      sessionPrep: null,
      zoho: { ok: false, skipped: true, reason: "BOOKING_IDENTITY_UNRESOLVED" },
    };
  }

  logger(
    identityResolution.issuedIdentity?.isNewCode ? "booking.identity.issued" : "booking.identity.resolved",
    "ok",
    {
      route: cleanString(options.route) || null,
      eventType: booking.eventType || null,
      sourceSurface: "calendly_booking",
      incomingShopperId: cleanString(identityResolution.extractedIdentity?.shopperId) || null,
      canonicalShopperId: cleanString(resolvedIdentity.shopperId) || null,
      snoozeCode: cleanString(resolvedIdentity.snoozeCode || resolvedIdentity.shopperId) || null,
      profileId: cleanString(resolvedIdentity.profileId) || null,
      bookingStatus,
      bookingStartTime: booking.startTime || null,
      contactEmailPresent: Boolean(booking.email),
      contactPhonePresent: Boolean(booking.phone),
      reason: identityResolution.issuedIdentity?.isNewCode ? "booking_started" : "existing_identity",
    }
  );

  let canonicalRecommendation = null;
  try {
    canonicalRecommendation = await materializeCanonicalRecommendation(
      identityResolution.existingProfile || {},
      options
    );
  } catch (error) {
    logger("session.prep.error", error.message, {
      route: cleanString(options.route) || null,
      eventType: booking.eventType || null,
      sourceSurface: "calendly_booking",
      canonicalShopperId: cleanString(resolvedIdentity.shopperId) || null,
      snoozeCode: cleanString(resolvedIdentity.snoozeCode || resolvedIdentity.shopperId) || null,
      profileId: cleanString(resolvedIdentity.profileId) || null,
      bookingStatus,
      bookingStartTime: booking.startTime || null,
      reason: "CANONICAL_RECOMMENDATION_RESOLVE_FAILED",
    });
  }

  let sessionPrep = null;
  try {
    sessionPrep = buildSessionPrep(
      {
        ...(isObject(identityResolution.existingProfile) ? identityResolution.existingProfile : {}),
        canonicalRecommendation: canonicalRecommendation || identityResolution.existingProfile?.canonicalRecommendation || null,
      },
      {
        source: "booking_webhook",
        bookingStatus,
        bookingLocationType: booking.locationType,
        shopperId: cleanString(resolvedIdentity.shopperId) || null,
        profileId: cleanString(resolvedIdentity.profileId) || null,
        snoozeCode:
          cleanString(
            resolvedIdentity.snoozeCode ||
              resolvedIdentity.accessCode ||
              resolvedIdentity.shopperId
          ) || null,
        bookingEventUri: cleanString(booking.eventUri) || null,
        bookingInviteeUri: cleanString(booking.inviteeUri) || null,
        bookingStartTime: cleanString(booking.startTime) || null,
        bookingEndTime: cleanString(booking.endTime) || null,
      }
    );

    if (sessionPrep) {
      logger("session.prep.generated", "ok", {
        route: cleanString(options.route) || null,
        eventType: booking.eventType || null,
        sourceSurface: "calendly_booking",
        canonicalShopperId: cleanString(resolvedIdentity.shopperId) || null,
        snoozeCode: cleanString(resolvedIdentity.snoozeCode || resolvedIdentity.shopperId) || null,
        profileId: cleanString(resolvedIdentity.profileId) || null,
        bookingStatus,
        bookingStartTime: booking.startTime || null,
        reason: cleanString(sessionPrep.status) || "ready",
      });
    } else {
      logger("session.prep.skipped", "SESSION_PREP_UNAVAILABLE", {
        route: cleanString(options.route) || null,
        eventType: booking.eventType || null,
        sourceSurface: "calendly_booking",
        canonicalShopperId: cleanString(resolvedIdentity.shopperId) || null,
        snoozeCode: cleanString(resolvedIdentity.snoozeCode || resolvedIdentity.shopperId) || null,
        profileId: cleanString(resolvedIdentity.profileId) || null,
        bookingStatus,
        bookingStartTime: booking.startTime || null,
        reason: "SESSION_PREP_UNAVAILABLE",
      });
    }
  } catch (error) {
    logger("session.prep.error", error.message, {
      route: cleanString(options.route) || null,
      eventType: booking.eventType || null,
      sourceSurface: "calendly_booking",
      canonicalShopperId: cleanString(resolvedIdentity.shopperId) || null,
      snoozeCode: cleanString(resolvedIdentity.snoozeCode || resolvedIdentity.shopperId) || null,
      profileId: cleanString(resolvedIdentity.profileId) || null,
      bookingStatus,
      bookingStartTime: booking.startTime || null,
      reason: "SESSION_PREP_BUILD_FAILED",
    });
  }

  const profilePatch = buildBookingProfilePatch({
    booking,
    identity: resolvedIdentity,
    existingProfile: identityResolution.existingProfile || {},
    canonicalRecommendation,
    sessionPrep,
    bookingStatus,
  });

  const upsertResult = await deps.customerProfileUpsert(
    deps.buildCustomerProfilePatch(profilePatch)
  );

  if (upsertResult?.ok && !upsertResult?.skipped) {
    logger("booking.profile.upserted", "ok", {
      route: cleanString(options.route) || null,
      eventType: booking.eventType || null,
      sourceSurface: "calendly_booking",
      incomingShopperId: cleanString(identityResolution.extractedIdentity?.shopperId) || null,
      canonicalShopperId: cleanString(resolvedIdentity.shopperId) || null,
      snoozeCode: cleanString(resolvedIdentity.snoozeCode || resolvedIdentity.shopperId) || null,
      profileId: cleanString(upsertResult.profileId || resolvedIdentity.profileId) || null,
      bookingStatus,
      bookingStartTime: booking.startTime || null,
      contactEmailPresent: Boolean(booking.email),
      contactPhonePresent: Boolean(booking.phone),
      operation: "upsert",
      reason: null,
    });
  } else {
    logger("booking.profile.error", upsertResult?.reason || "CUSTOMER_PROFILE_UPSERT_FAILED", {
      route: cleanString(options.route) || null,
      eventType: booking.eventType || null,
      sourceSurface: "calendly_booking",
      incomingShopperId: cleanString(identityResolution.extractedIdentity?.shopperId) || null,
      canonicalShopperId: cleanString(resolvedIdentity.shopperId) || null,
      snoozeCode: cleanString(resolvedIdentity.snoozeCode || resolvedIdentity.shopperId) || null,
      profileId: cleanString(resolvedIdentity.profileId) || null,
      bookingStatus,
      bookingStartTime: booking.startTime || null,
      contactEmailPresent: Boolean(booking.email),
      contactPhonePresent: Boolean(booking.phone),
      operation: "upsert",
      reason: upsertResult?.reason || "CUSTOMER_PROFILE_UPSERT_FAILED",
    });
  }

  const aliasPatches = buildBookingAliasPatches(resolvedIdentity, booking, profilePatch);
  for (const aliasPatch of aliasPatches) {
    try {
      await deps.customerProfileUpsert(deps.buildCustomerProfilePatch(aliasPatch));
    } catch {
      // profile writes must not break booking flow
    }
  }

  if (
    identityResolution.issuedIdentity?.isNewCode &&
    cleanString(identityResolution.resolvedIdentity?.profileId) &&
    cleanString(identityResolution.resolvedIdentity?.profileId) !== cleanString(resolvedIdentity.profileId)
  ) {
    try {
      await deps.customerProfileUpsert(
        deps.buildCustomerProfilePatch({
          profileId: identityResolution.resolvedIdentity.profileId,
          mergedIntoProfileId: cleanString(resolvedIdentity.profileId) || undefined,
          mergedIntoShopperId: cleanString(resolvedIdentity.shopperId) || undefined,
          mergedAt: nowIso(),
          sourceSurface: "calendly_booking",
          lastIntent: "booking_scheduled",
        })
      );
    } catch {
      // merge markers are best-effort
    }
  }

  let zohoResult = {
    ok: false,
    skipped: true,
    reason: "ZOHO_NOT_CONFIGURED",
  };

  try {
    const profileForSync = deps.buildCustomerProfilePatch(profilePatch);
    zohoResult = await deps.syncCustomerProfileToZoho(profileForSync);
    logger(
      zohoResult?.ok ? "booking.zoho.synced" : "booking.zoho.skipped",
      zohoResult?.ok ? "ok" : zohoResult?.reason || "ZOHO_SYNC_SKIPPED",
      {
        route: cleanString(options.route) || null,
        eventType: booking.eventType || null,
        sourceSurface: "calendly_booking",
        canonicalShopperId: cleanString(resolvedIdentity.shopperId) || null,
        snoozeCode: cleanString(resolvedIdentity.snoozeCode || resolvedIdentity.shopperId) || null,
        profileId: cleanString(resolvedIdentity.profileId) || null,
        bookingStatus,
        bookingStartTime: booking.startTime || null,
        operation: zohoResult?.operation || null,
        reason: zohoResult?.reason || null,
        contactEmailPresent: Boolean(booking.email),
        contactPhonePresent: Boolean(booking.phone),
      }
    );
  } catch (error) {
    logger("booking.zoho.error", error.message, {
      route: cleanString(options.route) || null,
      eventType: booking.eventType || null,
      sourceSurface: "calendly_booking",
      canonicalShopperId: cleanString(resolvedIdentity.shopperId) || null,
      snoozeCode: cleanString(resolvedIdentity.snoozeCode || resolvedIdentity.shopperId) || null,
      profileId: cleanString(resolvedIdentity.profileId) || null,
      bookingStatus,
      bookingStartTime: booking.startTime || null,
      contactEmailPresent: Boolean(booking.email),
      contactPhonePresent: Boolean(booking.phone),
      reason: "ZOHO_SYNC_FAILED",
    });
    zohoResult = {
      ok: false,
      skipped: true,
      reason: "ZOHO_SYNC_FAILED",
    };
  }

  return {
    ok: true,
    skipped: false,
    booking,
    identity: resolvedIdentity,
    extractedIdentity: identityResolution.extractedIdentity,
    resolvedIdentity: identityResolution.resolvedIdentity,
    issuedIdentity: identityResolution.issuedIdentity,
    existingProfile: identityResolution.existingProfile || null,
    profilePatch,
    sessionPrep,
    canonicalRecommendation,
    upsertResult,
    zoho: zohoResult,
  };
}

module.exports = {
  normalizeBookingPayload,
  extractBookingIdentity,
  resolveBookingIdentity,
  buildBookingProfilePatch,
  buildSessionPrep,
  upsertBookingSession,
};
