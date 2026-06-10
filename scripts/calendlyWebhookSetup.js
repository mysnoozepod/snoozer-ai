#!/usr/bin/env node

try {
  require("dotenv").config({ quiet: true });
} catch (_) {
  // Optional local env loading only.
}

const API_BASE = "https://api.calendly.com";
const WEBHOOK_EVENTS = Object.freeze(["invitee.created", "invitee.canceled"]);

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function uniqueSortedStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanString).filter(Boolean))].sort();
}

function parseArgs(argv = []) {
  const out = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = cleanString(argv[index]);
    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = cleanString(argv[index + 1]);
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }

    out[key] = next;
    index += 1;
  }

  return out;
}

function readFirstValue(args = {}, argNames = [], envNames = []) {
  for (const argName of argNames) {
    const value = cleanString(args[argName]);
    if (value) return value;
  }

  for (const envName of envNames) {
    const value = cleanString(process.env[envName]);
    if (value) return value;
  }

  return "";
}

function readRequiredValue(args = {}, argNames = [], envNames = [], label = "value") {
  const value = readFirstValue(args, argNames, envNames);
  if (value) return value;

  throw new Error(
    `Missing required ${label}. Pass ${argNames.map((name) => `--${name}`).join(" or ")} or set one of: ${envNames.join(", ")}`
  );
}

function sanitizeUrl(value = "") {
  const raw = cleanString(value);
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    for (const [key] of parsed.searchParams.entries()) {
      parsed.searchParams.set(key, "REDACTED");
    }
    return parsed.toString();
  } catch (_) {
    return raw;
  }
}

function sanitizeSubscriptionSummary(subscription = {}) {
  return {
    uri: cleanString(subscription.uri) || null,
    callback_url: sanitizeUrl(subscription.callbackUrl || subscription.callback_url || subscription.url),
    state: cleanString(subscription.state) || null,
    scope: cleanString(subscription.scope) || null,
    events: uniqueSortedStrings(subscription.events),
  };
}

function normalizeSubscription(resource = {}) {
  return {
    uri: cleanString(resource.uri),
    callbackUrl: cleanString(resource.callback_url || resource.url),
    state: cleanString(resource.state || resource.status).toLowerCase(),
    scope: cleanString(resource.scope).toLowerCase(),
    organization: cleanString(resource.organization),
    user: cleanString(resource.user),
    events: uniqueSortedStrings(resource.events),
  };
}

function buildSubscriptionPayload({
  webhookUrl = "",
  organizationUri = "",
  userUri = "",
  scope = "organization",
  events = WEBHOOK_EVENTS,
} = {}) {
  const normalizedScope = cleanString(scope).toLowerCase() || "organization";
  const payload = {
    url: cleanString(webhookUrl),
    events: uniqueSortedStrings(events),
    organization: cleanString(organizationUri),
    scope: normalizedScope,
  };

  if (normalizedScope === "user") {
    payload.user = cleanString(userUri);
  }

  return payload;
}

function matchesTarget(subscription = {}, target = {}) {
  const normalizedSubscription = normalizeSubscription(subscription);
  const normalizedTarget = buildSubscriptionPayload(target);

  if (normalizedSubscription.callbackUrl !== normalizedTarget.url) return false;
  if (normalizedSubscription.scope !== normalizedTarget.scope) return false;
  if (normalizedSubscription.organization !== normalizedTarget.organization) return false;
  if (normalizedTarget.scope === "user" && normalizedSubscription.user !== normalizedTarget.user) {
    return false;
  }

  const leftEvents = uniqueSortedStrings(normalizedSubscription.events);
  const rightEvents = uniqueSortedStrings(normalizedTarget.events);
  return leftEvents.length === rightEvents.length && leftEvents.every((eventName, index) => eventName === rightEvents[index]);
}

function buildListUrl({
  organizationUri = "",
  userUri = "",
  scope = "organization",
  count = 100,
} = {}) {
  const url = new URL(`${API_BASE}/webhook_subscriptions`);
  const normalizedScope = cleanString(scope).toLowerCase() || "organization";

  if (organizationUri) url.searchParams.set("organization", cleanString(organizationUri));
  url.searchParams.set("scope", normalizedScope);
  url.searchParams.set("count", String(Math.max(1, Number(count) || 100)));

  if (normalizedScope === "user" && userUri) {
    url.searchParams.set("user", cleanString(userUri));
  }

  return url.toString();
}

async function calendlyRequest(pathOrUrl, token, { method = "GET", body = null } = {}) {
  const targetUrl = cleanString(pathOrUrl).startsWith("http")
    ? cleanString(pathOrUrl)
    : `${API_BASE}${cleanString(pathOrUrl)}`;

  const response = await fetch(targetUrl, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const rawText = await response.text();
  let payload = null;

  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch (_) {
    payload = rawText;
  }

  if (!response.ok) {
    const error = new Error(
      `Calendly API ${method} ${targetUrl} failed with ${response.status}`
    );
    error.status = response.status;
    error.payload = payload;
    error.url = targetUrl;
    throw error;
  }

  return payload;
}

async function fetchCurrentUser(token) {
  const payload = await calendlyRequest("/users/me", token);
  const resource = payload && typeof payload === "object" ? payload.resource || {} : {};

  return {
    userUri: cleanString(resource.uri),
    organizationUri: cleanString(resource.current_organization),
    name: cleanString(resource.name),
    email: cleanString(resource.email),
  };
}

async function resolveCalendlyUris(token, args = {}) {
  let organizationUri = readFirstValue(args, ["organization-uri"], [
    "CALENDLY_ORGANIZATION_URI",
  ]);
  let userUri = readFirstValue(args, ["user-uri"], ["CALENDLY_USER_URI"]);
  let fetchedCurrentUser = null;

  if (!organizationUri || !userUri) {
    fetchedCurrentUser = await fetchCurrentUser(token);
    organizationUri = organizationUri || fetchedCurrentUser.organizationUri;
    userUri = userUri || fetchedCurrentUser.userUri;
  }

  if (!organizationUri) {
    throw new Error("Calendly organization URI could not be resolved. Set CALENDLY_ORGANIZATION_URI or allow /users/me lookup.");
  }

  return {
    organizationUri,
    userUri,
    fetchedCurrentUser,
  };
}

async function listWebhookSubscriptions(token, target = {}) {
  const subscriptions = [];
  const visited = new Set();
  let nextUrl = buildListUrl(target);

  while (nextUrl && !visited.has(nextUrl)) {
    visited.add(nextUrl);

    const payload = await calendlyRequest(nextUrl, token);
    const collection = Array.isArray(payload?.collection) ? payload.collection : [];
    subscriptions.push(...collection.map(normalizeSubscription));

    const nextPage = cleanString(payload?.pagination?.next_page);
    const nextPageToken = cleanString(payload?.pagination?.next_page_token);

    if (nextPage) {
      nextUrl = nextPage;
      continue;
    }

    if (nextPageToken) {
      const continuedUrl = new URL(nextUrl);
      continuedUrl.searchParams.set("page_token", nextPageToken);
      nextUrl = continuedUrl.toString();
      continue;
    }

    nextUrl = "";
  }

  return subscriptions;
}

function shouldFallbackToUserScope(error) {
  const status = Number(error?.status || 0);
  const message = JSON.stringify(error?.payload || "").toLowerCase();

  return (
    status === 403 ||
    status === 401 ||
    (status === 400 &&
      /(scope|permission|organization|admin|owner|plan|not authorized|forbidden)/.test(
        message
      ))
  );
}

function isDuplicateError(error) {
  const status = Number(error?.status || 0);
  const message = JSON.stringify(error?.payload || "").toLowerCase();

  return (
    status === 409 ||
    /duplicate|already exists|conflict|webhook subscription exists/.test(message)
  );
}

async function createWebhookSubscription(token, target = {}) {
  const payload = buildSubscriptionPayload(target);
  const response = await calendlyRequest("/webhook_subscriptions", token, {
    method: "POST",
    body: payload,
  });

  return normalizeSubscription(response?.resource || {});
}

function buildListResult({
  webhookUrl = "",
  organizationUri = "",
  userUri = "",
  scope = "",
  subscriptions = [],
  notes = [],
} = {}) {
  const normalizedSubscriptions = subscriptions.map(sanitizeSubscriptionSummary);
  const normalizedWebhookUrl = sanitizeUrl(webhookUrl);

  return {
    status: "ok",
    mode: "list",
    webhook_url: normalizedWebhookUrl || null,
    organization: cleanString(organizationUri) || null,
    user: cleanString(userUri) || null,
    scope,
    subscription_count: normalizedSubscriptions.length,
    subscriptions: normalizedSubscriptions,
    matching_callback_subscriptions: normalizedWebhookUrl
      ? normalizedSubscriptions.filter(
          (subscription) => subscription.callback_url === normalizedWebhookUrl
        )
      : [],
    notes: Array.isArray(notes) ? notes.filter(Boolean) : [],
  };
}

async function runListMode(token, config = {}) {
  const notes = [];
  const organizationTarget = {
    organizationUri: config.organizationUri,
    userUri: config.userUri,
    scope: "organization",
  };

  try {
    const subscriptions = await listWebhookSubscriptions(token, organizationTarget);
    return buildListResult({
      webhookUrl: config.webhookUrl,
      organizationUri: config.organizationUri,
      userUri: config.userUri,
      scope: "organization",
      subscriptions,
      notes,
    });
  } catch (error) {
    notes.push(`Organization scope list failed: ${error.message}`);
    if (!config.userUri) throw error;

    const userSubscriptions = await listWebhookSubscriptions(token, {
      organizationUri: config.organizationUri,
      userUri: config.userUri,
      scope: "user",
    });

    notes.push("Fell back to user scope listing.");

    return buildListResult({
      webhookUrl: config.webhookUrl,
      organizationUri: config.organizationUri,
      userUri: config.userUri,
      scope: "user",
      subscriptions: userSubscriptions,
      notes,
    });
  }
}

async function runCreateMode(token, config = {}) {
  const webhookUrl = cleanString(config.webhookUrl);
  if (!webhookUrl) {
    throw new Error("CALENDLY_WEBHOOK_URL is required when using --create.");
  }

  const orgTarget = {
    webhookUrl,
    organizationUri: config.organizationUri,
    userUri: config.userUri,
    scope: "organization",
  };

  let organizationSubscriptions = [];
  try {
    organizationSubscriptions = await listWebhookSubscriptions(token, {
      organizationUri: config.organizationUri,
      userUri: config.userUri,
      scope: "organization",
    });
  } catch (_) {
    organizationSubscriptions = [];
  }

  const existingOrganization = organizationSubscriptions.find((subscription) =>
    matchesTarget(subscription, orgTarget)
  );

  if (existingOrganization) {
    return {
      status: "duplicate",
      mode: "create",
      scope: "organization",
      webhook_url: sanitizeUrl(webhookUrl),
      organization: cleanString(config.organizationUri) || null,
      user: cleanString(config.userUri) || null,
      subscription: sanitizeSubscriptionSummary(existingOrganization),
      notes: ["A matching organization-scoped webhook subscription already exists."],
    };
  }

  try {
    const created = await createWebhookSubscription(token, orgTarget);
    return {
      status: "created",
      mode: "create",
      scope: "organization",
      webhook_url: sanitizeUrl(webhookUrl),
      organization: cleanString(config.organizationUri) || null,
      user: cleanString(config.userUri) || null,
      subscription: sanitizeSubscriptionSummary(created),
      notes: [],
    };
  } catch (error) {
    if (isDuplicateError(error)) {
      return {
        status: "duplicate",
        mode: "create",
        scope: "organization",
        webhook_url: sanitizeUrl(webhookUrl),
        organization: cleanString(config.organizationUri) || null,
        user: cleanString(config.userUri) || null,
        subscription: null,
        notes: ["Calendly reported an existing organization-scoped webhook subscription."],
      };
    }

    if (!shouldFallbackToUserScope(error) || !config.userUri) {
      throw error;
    }

    const userTarget = {
      webhookUrl,
      organizationUri: config.organizationUri,
      userUri: config.userUri,
      scope: "user",
    };

    let userSubscriptions = [];
    try {
      userSubscriptions = await listWebhookSubscriptions(token, {
        organizationUri: config.organizationUri,
        userUri: config.userUri,
        scope: "user",
      });
    } catch (_) {
      userSubscriptions = [];
    }

    const existingUser = userSubscriptions.find((subscription) =>
      matchesTarget(subscription, userTarget)
    );

    if (existingUser) {
      return {
        status: "duplicate",
        mode: "create",
        scope: "user",
        webhook_url: sanitizeUrl(webhookUrl),
        organization: cleanString(config.organizationUri) || null,
        user: cleanString(config.userUri) || null,
        subscription: sanitizeSubscriptionSummary(existingUser),
        notes: [
          "Organization scope was not permitted, and a matching user-scoped webhook already exists.",
        ],
      };
    }

    try {
      const created = await createWebhookSubscription(token, userTarget);
      return {
        status: "created",
        mode: "create",
        scope: "user",
        webhook_url: sanitizeUrl(webhookUrl),
        organization: cleanString(config.organizationUri) || null,
        user: cleanString(config.userUri) || null,
        subscription: sanitizeSubscriptionSummary(created),
        notes: [
          "Organization scope was not permitted, so a user-scoped webhook was created instead.",
        ],
      };
    } catch (userError) {
      if (isDuplicateError(userError)) {
        return {
          status: "duplicate",
          mode: "create",
          scope: "user",
          webhook_url: sanitizeUrl(webhookUrl),
          organization: cleanString(config.organizationUri) || null,
          user: cleanString(config.userUri) || null,
          subscription: null,
          notes: [
            "Calendly reported an existing user-scoped webhook subscription after organization fallback.",
          ],
        };
      }

      throw userError;
    }
  }
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const token = readRequiredValue(
    args,
    ["token"],
    ["CALENDLY_ACCESS_TOKEN", "CALENDLY_PAT", "CALENDLY_TOKEN"],
    "Calendly access token"
  );
  const webhookUrl = readFirstValue(args, ["webhook-url"], [
    "CALENDLY_WEBHOOK_URL",
    "ZOHO_FLOW_WEBHOOK_URL",
    "ZOHO_FLOW_INCOMING_WEBHOOK_URL",
  ]);
  const resolvedUris = await resolveCalendlyUris(token, args);
  const config = {
    webhookUrl,
    organizationUri: resolvedUris.organizationUri,
    userUri: resolvedUris.userUri,
  };

  const result = args.create
    ? await runCreateMode(token, config)
    : await runListMode(token, config);

  printResult(result);
  return result;
}

module.exports = {
  API_BASE,
  WEBHOOK_EVENTS,
  parseArgs,
  sanitizeUrl,
  sanitizeSubscriptionSummary,
  normalizeSubscription,
  buildSubscriptionPayload,
  buildListUrl,
  matchesTarget,
  shouldFallbackToUserScope,
  isDuplicateError,
  runListMode,
  runCreateMode,
  main,
};

if (require.main === module) {
  main().catch((error) => {
    const details = error?.payload && typeof error.payload === "object" ? error.payload : null;
    printResult({
      status: "error",
      mode: process.argv.includes("--create") ? "create" : "list",
      message: error?.message || "Calendly webhook setup failed.",
      http_status: Number(error?.status || 0) || null,
      details,
    });
    process.exit(1);
  });
}
