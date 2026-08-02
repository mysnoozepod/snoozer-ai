"use strict";

const crypto = require("crypto");
const repository = require("./repository");
const rewardsService = require("./service");

const REST_TEST_DURATIONS = Object.freeze({
  quick: 420,
  deep: 900,
});
const REQUIRED_REST_TEST_STAGES = Object.freeze([
  "back_flat",
  "side_flat",
  "back_recalibration",
  "zero_gravity",
  "snore",
  "final_flat",
]);
const REQUIRED_SLEEP_ESSENTIAL_CATEGORY_IDS = Object.freeze([
  "pillows",
  "sheets_bedding",
  "protectors",
]);
const VALID_SLEEP_ESSENTIAL_PROGRESS_ACTIONS = Object.freeze([
  "added_to_cart",
  "saved_selection",
  "reviewed_no_selection",
]);

function clean(value) {
  return String(value || "").trim();
}

function safeKeyPart(value, label) {
  const normalized = clean(value);
  if (!normalized || normalized.length > 180 || /[#\u0000-\u001f]/.test(normalized)) {
    const error = new Error(`${label} is invalid.`);
    error.code = "REWARD_EXPERIENCE_ID_INVALID";
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function experienceKey(journeyId, podId) {
  return `EXPERIENCE#REST#${safeKeyPart(journeyId, "journeyId")}#${safeKeyPart(
    podId,
    "podId"
  )}`;
}

function stageKey(journeyId, podId, stageId) {
  return `${experienceKey(journeyId, podId)}#STAGE#${safeKeyPart(
    stageId,
    "stageId"
  )}`;
}

function nowIso(options = {}) {
  return typeof options.now === "function"
    ? options.now().toISOString()
    : new Date().toISOString();
}

function isConditionalFailure(error) {
  return (
    error?.name === "ConditionalCheckFailedException" ||
    error?.name === "TransactionCanceledException"
  );
}

async function startRestTest(identity, input = {}, options = {}) {
  const repo = options.repository || repository;
  const journeyId = safeKeyPart(input.journeyId, "journeyId");
  const podId = safeKeyPart(input.podId, "podId");
  const durationId = clean(input.durationId);
  const durationSeconds = REST_TEST_DURATIONS[durationId];
  if (!durationSeconds) {
    const error = new Error("The Rest Test duration is invalid.");
    error.code = "REWARD_REST_TEST_DURATION_INVALID";
    error.statusCode = 400;
    throw error;
  }
  const key = experienceKey(journeyId, podId);
  const now = nowIso(options);
  const item = {
    PK: repository.profilePk(identity.profileId),
    SK: key,
    entityType: "REST_TEST_EXPERIENCE",
    profileId: identity.profileId,
    shopperId: identity.shopperId,
    sessionId: identity.sessionId,
    journeyId,
    podId,
    mattressId: clean(input.mattressId) || null,
    durationId,
    expectedDurationSeconds: durationSeconds,
    requiredStageIds: [...REQUIRED_REST_TEST_STAGES],
    status: "active",
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await repo.putEntity(item, {
      ...(options.repositoryOptions || options),
      createOnly: true,
    });
    return { ...item, duplicate: false };
  } catch (error) {
    if (!isConditionalFailure(error)) throw error;
    const existing = await repo.getEntity(
      identity.profileId,
      key,
      options.repositoryOptions || options
    );
    if (!existing) throw error;
    return { ...existing, duplicate: true };
  }
}

async function recordRestTestStage(identity, input = {}, options = {}) {
  const repo = options.repository || repository;
  const journeyId = safeKeyPart(input.journeyId, "journeyId");
  const podId = safeKeyPart(input.podId, "podId");
  const stageId = safeKeyPart(input.stageId, "stageId");
  if (!REQUIRED_REST_TEST_STAGES.includes(stageId)) {
    const error = new Error("The Rest Test stage is invalid.");
    error.code = "REWARD_REST_TEST_STAGE_INVALID";
    error.statusCode = 400;
    throw error;
  }
  const parent = await repo.getEntity(
    identity.profileId,
    experienceKey(journeyId, podId),
    options.repositoryOptions || options
  );
  if (!parent || !["active", "completed"].includes(parent.status)) {
    const error = new Error("The Rest Test session is not active.");
    error.code = "REWARD_REST_TEST_NOT_ACTIVE";
    error.statusCode = 409;
    throw error;
  }
  const now = nowIso(options);
  const item = {
    PK: repository.profilePk(identity.profileId),
    SK: stageKey(journeyId, podId, stageId),
    entityType: "REST_TEST_STAGE",
    profileId: identity.profileId,
    journeyId,
    podId,
    stageId,
    recordedAt: now,
    createdAt: now,
  };
  try {
    await repo.putEntity(item, {
      ...(options.repositoryOptions || options),
      createOnly: true,
    });
    return { ...item, duplicate: false };
  } catch (error) {
    if (!isConditionalFailure(error)) throw error;
    return { ...item, duplicate: true };
  }
}

async function awardCompletedRestTest(identity, experience, options = {}) {
  const common = {
    identity,
    sessionId: identity.sessionId,
    sourceSurface: "pod_rest_test",
    occurredAt: experience.completedAt,
  };
  const podResult = await rewardsService.recordRewardMilestone(
    {
      ...common,
      eventId: crypto.randomUUID(),
      eventType: "milestone.pod.completed",
      subjectType: "pod",
      subjectId: experience.podId,
      metadata: {
        podId: experience.podId,
        persisted: true,
        experienceCompleted: true,
      },
    },
    options
  );
  const restResult = await rewardsService.recordRewardMilestone(
    {
      ...common,
      eventId: crypto.randomUUID(),
      eventType: "milestone.rest_test.completed",
      subjectType: "rest_test",
      subjectId: experience.journeyId,
      metadata: {
        journeyId: experience.journeyId,
        podId: experience.podId,
        durationSeconds: experience.durationSeconds,
        persisted: true,
        requiredStagesCompleted: true,
      },
    },
    options
  );
  return { podResult, restResult };
}

async function completeRestTest(identity, input = {}, options = {}) {
  const repo = options.repository || repository;
  const journeyId = safeKeyPart(input.journeyId, "journeyId");
  const podId = safeKeyPart(input.podId, "podId");
  const key = experienceKey(journeyId, podId);
  let experience = await repo.getEntity(
    identity.profileId,
    key,
    options.repositoryOptions || options
  );
  if (!experience) {
    const error = new Error("The Rest Test session was not found.");
    error.code = "REWARD_REST_TEST_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }

  if (experience.status !== "completed") {
    const stages = await repo.queryByPrefix(
      identity.profileId,
      `${key}#STAGE#`,
      { ...(options.repositoryOptions || options), limit: 20 }
    );
    const completedStages = new Set(stages.map((item) => item.stageId));
    const missingStages = REQUIRED_REST_TEST_STAGES.filter(
      (stageId) => !completedStages.has(stageId)
    );
    const serverElapsedSeconds = Math.floor(
      (Date.parse(nowIso(options)) - Date.parse(experience.startedAt)) / 1000
    );
    const minimumSeconds = Number(experience.expectedDurationSeconds || 420);
    if (missingStages.length || serverElapsedSeconds < minimumSeconds) {
      const error = new Error("The Rest Test has not reached valid completion.");
      error.code = "REWARD_REST_TEST_INCOMPLETE";
      error.statusCode = 409;
      error.details = { missingStages, serverElapsedSeconds, minimumSeconds };
      throw error;
    }

    const completedAt = nowIso(options);
    try {
      await repo.transactItems(
        [
          {
            Update: {
              Key: { PK: repository.profilePk(identity.profileId), SK: key },
              UpdateExpression:
                "SET #status = :completed, completedAt = :completedAt, durationSeconds = :durationSeconds, completedStageIds = :completedStageIds, updatedAt = :completedAt",
              ConditionExpression: "#status = :active",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":active": "active",
                ":completed": "completed",
                ":completedAt": completedAt,
                ":durationSeconds": minimumSeconds,
                ":completedStageIds": [...REQUIRED_REST_TEST_STAGES],
              },
            },
          },
        ],
        {
          ...(options.repositoryOptions || options),
          clientRequestToken: crypto
            .createHash("sha256")
            .update(`${identity.profileId}|${key}|complete`)
            .digest("hex"),
        }
      );
    } catch (error) {
      if (!isConditionalFailure(error)) throw error;
    }
    experience = {
      ...experience,
      status: "completed",
      completedAt,
      durationSeconds: minimumSeconds,
      completedStageIds: [...REQUIRED_REST_TEST_STAGES],
    };
  }

  const awards = await awardCompletedRestTest(identity, experience, options);
  return { experience, awards };
}

function normalizedRatings(input = {}) {
  const entries = Object.entries(input.ratings || {})
    .map(([key, value]) => [clean(key), Number(value)])
    .filter(([key, value]) => key && Number.isInteger(value) && value >= 1 && value <= 5);
  return Object.fromEntries(entries);
}

async function saveRatingsAndFavorite(identity, input = {}, options = {}) {
  const repo = options.repository || repository;
  const journeyId = safeKeyPart(input.journeyId, "journeyId");
  const podId = safeKeyPart(input.podId, "podId");
  const ratings = normalizedRatings(input);
  const favoritePodId = clean(input.favoritePodId);
  if (Object.keys(ratings).length < 1 || !favoritePodId) {
    const error = new Error("At least one rating and one favorite are required.");
    error.code = "REWARD_RATINGS_INCOMPLETE";
    error.statusCode = 400;
    throw error;
  }
  const now = nowIso(options);
  const key = `EXPERIENCE#RATINGS#${journeyId}`;
  const item = {
    PK: repository.profilePk(identity.profileId),
    SK: key,
    entityType: "RATINGS_EXPERIENCE",
    profileId: identity.profileId,
    journeyId,
    podId,
    favoritePodId,
    ratings,
    ratingCount: Object.keys(ratings).length,
    status: "completed",
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await repo.putEntity(item, {
      ...(options.repositoryOptions || options),
      createOnly: true,
    });
  } catch (error) {
    if (!isConditionalFailure(error)) throw error;
  }
  const result = await rewardsService.recordRewardMilestone(
    {
      identity,
      eventId: crypto.randomUUID(),
      eventType: "milestone.ratings.completed",
      sessionId: identity.sessionId,
      subjectType: "preference_set",
      subjectId: journeyId,
      sourceSurface: "pod_rest_test",
      metadata: {
        journeyId,
        persisted: true,
        completed: true,
        ratingCount: Object.keys(ratings).length,
        favoriteCount: 1,
      },
    },
    options
  );
  return { experience: item, result };
}

async function getAccessoriesProgress(identity, input = {}, options = {}) {
  const repo = options.repository || repository;
  const journeyId = safeKeyPart(input.journeyId, "journeyId");
  const progressItems = await repo.queryByPrefix(
    identity.profileId,
    `EXPERIENCE#ACCESSORIES#${journeyId}#CATEGORY#`,
    { ...(options.repositoryOptions || options), consistentRead: true, limit: 20 }
  );
  const reviewedCategories = [
    ...new Set(progressItems.map((item) => clean(item.categoryId)).filter(Boolean)),
  ];
  const remainingCategories = REQUIRED_SLEEP_ESSENTIAL_CATEGORY_IDS.filter(
    (categoryId) => !reviewedCategories.includes(categoryId)
  );
  return {
    journeyId,
    reviewedCategoryIds: reviewedCategories,
    remainingCategoryIds: remainingCategories,
    complete: remainingCategories.length === 0,
  };
}

async function completeAccessoriesExperience(identity, input = {}, options = {}) {
  const repo = options.repository || repository;
  const journeyId = safeKeyPart(input.journeyId, "journeyId");
  const progress = await getAccessoriesProgress(identity, { journeyId }, options);
  const reviewedCategories = progress.reviewedCategoryIds;
  const remainingCategories = progress.remainingCategoryIds;
  if (remainingCategories.length) {
    const error = new Error("Review every Sleep Essentials category before completing.");
    error.code = "REWARD_SLEEP_ESSENTIALS_INCOMPLETE";
    error.statusCode = 409;
    error.details = { reviewedCategories, remainingCategories };
    error.retryable = true;
    throw error;
  }
  const now = nowIso(options);
  const key = `EXPERIENCE#ACCESSORIES#${journeyId}`;
  const item = {
    PK: repository.profilePk(identity.profileId),
    SK: key,
    entityType: "ACCESSORIES_EXPERIENCE",
    profileId: identity.profileId,
    journeyId,
    reviewedCategoryIds: [...REQUIRED_SLEEP_ESSENTIAL_CATEGORY_IDS],
    sourceSurface: clean(input.sourceSurface) || "sleep_essentials",
    status: "completed",
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await repo.putEntity(item, {
      ...(options.repositoryOptions || options),
      createOnly: true,
    });
  } catch (error) {
    if (!isConditionalFailure(error)) throw error;
  }
  const result = await rewardsService.recordRewardMilestone(
    {
      identity,
      eventId: crypto.randomUUID(),
      eventType: "milestone.accessories.completed",
      sessionId: identity.sessionId,
      subjectType: "accessory_journey",
      subjectId: journeyId,
      sourceSurface:
        clean(input.sourceSurface) === "pod_customize"
          ? "pod_customize"
          : "sleep_essentials",
      metadata: {
        journeyId,
        persisted: true,
        completed: true,
        reviewedCategoryIds: [...REQUIRED_SLEEP_ESSENTIAL_CATEGORY_IDS],
      },
    },
    options
  );
  return { experience: item, result };
}

async function recordAccessoriesProgress(identity, input = {}, options = {}) {
  const repo = options.repository || repository;
  const journeyId = safeKeyPart(input.journeyId, "journeyId");
  const categoryId = safeKeyPart(input.categoryId, "categoryId");
  if (!REQUIRED_SLEEP_ESSENTIAL_CATEGORY_IDS.includes(categoryId)) {
    const error = new Error("The Sleep Essentials category is invalid.");
    error.code = "REWARD_SLEEP_ESSENTIALS_CATEGORY_INVALID";
    error.statusCode = 400;
    throw error;
  }
  const action = safeKeyPart(input.action, "action");
  if (!VALID_SLEEP_ESSENTIAL_PROGRESS_ACTIONS.includes(action)) {
    const error = new Error("Choose a product, save a selection, or confirm no selection.");
    error.code = "REWARD_SLEEP_ESSENTIALS_ACTION_INVALID";
    error.statusCode = 400;
    throw error;
  }
  const sourceSurface =
    clean(input.sourceSurface) === "pod_customize"
      ? "pod_customize"
      : "sleep_essentials";
  const now = nowIso(options);
  const key = `EXPERIENCE#ACCESSORIES#${journeyId}#CATEGORY#${categoryId}`;
  const item = {
    PK: repository.profilePk(identity.profileId),
    SK: key,
    entityType: "ACCESSORIES_CATEGORY_PROGRESS",
    profileId: identity.profileId,
    shopperId: identity.shopperId,
    sessionId: identity.sessionId,
    journeyId,
    categoryId,
    action,
    productHandle: clean(input.productHandle) || null,
    variantId: clean(input.variantId) || null,
    sourceSurface,
    status: "reviewed",
    reviewedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  let duplicate = false;
  try {
    await repo.putEntity(item, {
      ...(options.repositoryOptions || options),
      createOnly: true,
    });
  } catch (error) {
    if (!isConditionalFailure(error)) throw error;
    duplicate = true;
  }
  const progress = await getAccessoriesProgress(identity, { journeyId }, options);
  const reviewedCategoryIds = [...progress.reviewedCategoryIds];
  if (!reviewedCategoryIds.includes(categoryId)) reviewedCategoryIds.push(categoryId);
  return {
    ...item,
    duplicate,
    reviewedCategoryIds,
    remainingCategoryIds: REQUIRED_SLEEP_ESSENTIAL_CATEGORY_IDS.filter(
      (value) => !reviewedCategoryIds.includes(value)
    ),
    complete: REQUIRED_SLEEP_ESSENTIAL_CATEGORY_IDS.every((value) =>
      reviewedCategoryIds.includes(value)
    ),
  };
}

module.exports = {
  REQUIRED_REST_TEST_STAGES,
  REQUIRED_SLEEP_ESSENTIAL_CATEGORY_IDS,
  VALID_SLEEP_ESSENTIAL_PROGRESS_ACTIONS,
  REST_TEST_DURATIONS,
  completeAccessoriesExperience,
  completeRestTest,
  experienceKey,
  getAccessoriesProgress,
  recordRestTestStage,
  recordAccessoriesProgress,
  saveRatingsAndFavorite,
  stageKey,
  startRestTest,
};
