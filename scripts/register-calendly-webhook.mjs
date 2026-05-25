#!/usr/bin/env node

const API_BASE = "https://api.calendly.com";
const EVENTS = Object.freeze(["invitee.created", "invitee.canceled"]);

function parseArgs(argv = []) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    index += 1;
  }
  return out;
}

function readRequiredInput(args, name, envNames = []) {
  const direct = typeof args[name] === "string" ? args[name].trim() : "";
  if (direct) return direct;

  for (const envName of envNames) {
    const value = String(process.env[envName] || "").trim();
    if (value) return value;
  }

  throw new Error(
    `Missing required ${name}. Pass --${name} or set one of: ${envNames.join(", ")}`
  );
}

function sortEvents(events = []) {
  return Array.from(
    new Set(
      (Array.isArray(events) ? events : [])
        .map((eventName) => String(eventName || "").trim())
        .filter(Boolean)
    )
  ).sort();
}

function eventsMatch(left = [], right = []) {
  const a = sortEvents(left);
  const b = sortEvents(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function normalizeSubscription(resource = {}) {
  const url = String(resource.callback_url || resource.url || "").trim();
  const scope = String(resource.scope || "").trim().toLowerCase();
  const state = String(resource.state || resource.status || "").trim().toLowerCase();

  return {
    uri: String(resource.uri || "").trim(),
    url,
    scope,
    state,
    organization: String(resource.organization || "").trim(),
    user: String(resource.user || "").trim(),
    events: sortEvents(resource.events),
    active: state ? state === "active" : Boolean(resource.active),
    raw: resource,
  };
}

function buildTarget({ webhookUrl, organizationUri, userUri, scope }) {
  return {
    url: webhookUrl,
    organization: organizationUri,
    user: scope === "user" ? userUri : "",
    scope,
    events: [...EVENTS],
  };
}

function matchesTarget(subscription, target) {
  if (!subscription || !target) return false;
  if (subscription.url !== target.url) return false;
  if (subscription.scope !== target.scope) return false;
  if (!eventsMatch(subscription.events, target.events)) return false;
  if (target.organization && subscription.organization !== target.organization) return false;
  if (target.scope === "user" && target.user && subscription.user !== target.user) return false;
  return true;
}

function buildCreatePayload(target) {
  const payload = {
    url: target.url,
    events: target.events,
    organization: target.organization,
    scope: target.scope,
  };
  if (target.scope === "user" && target.user) {
    payload.user = target.user;
  }
  return payload;
}

function redactUrl(url = "") {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("zapikey")) {
      parsed.searchParams.set("zapikey", "REDACTED");
    }
    return parsed.toString();
  } catch (_) {
    return url ? "[redacted webhook url]" : "";
  }
}

async function calendlyRequest(pathOrUrl, token, { method = "GET", body } = {}) {
  const targetUrl = String(pathOrUrl || "").startsWith("http")
    ? String(pathOrUrl)
    : `${API_BASE}${pathOrUrl}`;

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
    const error = new Error(`Calendly API ${method} ${targetUrl} failed with ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function listWebhookSubscriptions(token, target, { filtered = true } = {}) {
  const subscriptions = [];
  const visited = new Set();
  const params = new URLSearchParams({ count: "100" });

  if (filtered) {
    if (target.organization) params.set("organization", target.organization);
    if (target.scope) params.set("scope", target.scope);
    if (target.scope === "user" && target.user) params.set("user", target.user);
  }

  let nextUrl = `${API_BASE}/webhook_subscriptions?${params.toString()}`;

  while (nextUrl && !visited.has(nextUrl)) {
    visited.add(nextUrl);
    const data = await calendlyRequest(nextUrl, token);
    const collection = Array.isArray(data?.collection) ? data.collection : [];
    subscriptions.push(...collection.map(normalizeSubscription));

    const pagination = data?.pagination || {};
    if (typeof pagination.next_page === "string" && pagination.next_page.trim()) {
      nextUrl = pagination.next_page.trim();
      continue;
    }
    if (typeof pagination.next_page_token === "string" && pagination.next_page_token.trim()) {
      const continued = new URL(nextUrl);
      continued.searchParams.set("page_token", pagination.next_page_token.trim());
      nextUrl = continued.toString();
      continue;
    }
    nextUrl = "";
  }

  return subscriptions;
}

function shouldTryUserFallback(error) {
  const status = Number(error?.status || 0);
  const message = JSON.stringify(error?.payload || "").toLowerCase();
  return status === 403 || (status === 400 && /scope|permission|organization|owner|admin/.test(message));
}

async function createWebhookSubscription(token, target) {
  const payload = buildCreatePayload(target);
  const response = await calendlyRequest("/webhook_subscriptions", token, {
    method: "POST",
    body: payload,
  });
  return normalizeSubscription(response?.resource || {});
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = readRequiredInput(args, "token", ["CALENDLY_PAT", "CALENDLY_TOKEN"]);
  const webhookUrl = readRequiredInput(args, "webhook-url", [
    "ZOHO_FLOW_WEBHOOK_URL",
    "ZOHO_FLOW_INCOMING_WEBHOOK_URL",
  ]);

  const me = await calendlyRequest("/users/me", token);
  const user = me?.resource || {};
  const userUri = String(user?.uri || "").trim();
  const organizationUri = String(user?.current_organization || "").trim();

  if (!userUri || !organizationUri) {
    throw new Error("Calendly users/me response did not include both user and current_organization URIs.");
  }

  const orgTarget = buildTarget({
    webhookUrl,
    organizationUri,
    userUri,
    scope: "organization",
  });

  let existingSubscriptions = [];
  try {
    existingSubscriptions = await listWebhookSubscriptions(token, orgTarget, { filtered: true });
  } catch (error) {
    existingSubscriptions = await listWebhookSubscriptions(token, orgTarget, { filtered: false });
  }

  const exactOrgDuplicate = existingSubscriptions.find((subscription) => matchesTarget(subscription, orgTarget));
  const relatedSubscriptions = existingSubscriptions.filter(
    (subscription) => subscription.url === webhookUrl && !matchesTarget(subscription, orgTarget)
  );

  if (exactOrgDuplicate) {
    console.log(
      JSON.stringify(
        {
          status: "duplicate",
          scope: "organization",
          webhook_url: redactUrl(webhookUrl),
          organization: organizationUri,
          user: userUri,
          events: EVENTS,
          duplicate: {
            uri: exactOrgDuplicate.uri,
            scope: exactOrgDuplicate.scope,
            state: exactOrgDuplicate.state,
            active: exactOrgDuplicate.active,
          },
          related_subscriptions: relatedSubscriptions.map((subscription) => ({
            uri: subscription.uri,
            scope: subscription.scope,
            state: subscription.state,
            active: subscription.active,
            events: subscription.events,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  try {
    const created = await createWebhookSubscription(token, orgTarget);
    console.log(
      JSON.stringify(
        {
          status: "created",
          scope: "organization",
          webhook_url: redactUrl(webhookUrl),
          organization: organizationUri,
          user: userUri,
          events: EVENTS,
          subscription: {
            uri: created.uri,
            scope: created.scope,
            state: created.state,
            active: created.active,
          },
          related_subscriptions: relatedSubscriptions.map((subscription) => ({
            uri: subscription.uri,
            scope: subscription.scope,
            state: subscription.state,
            active: subscription.active,
            events: subscription.events,
          })),
        },
        null,
        2
      )
    );
    return;
  } catch (error) {
    if (!shouldTryUserFallback(error)) {
      throw error;
    }

    const userTarget = buildTarget({
      webhookUrl,
      organizationUri,
      userUri,
      scope: "user",
    });

    let userSubscriptions = [];
    try {
      userSubscriptions = await listWebhookSubscriptions(token, userTarget, { filtered: true });
    } catch (_) {
      userSubscriptions = existingSubscriptions;
    }

    const exactUserDuplicate = userSubscriptions.find((subscription) => matchesTarget(subscription, userTarget));
    const relatedUserSubscriptions = userSubscriptions.filter(
      (subscription) => subscription.url === webhookUrl && !matchesTarget(subscription, userTarget)
    );

    if (exactUserDuplicate) {
      console.log(
        JSON.stringify(
          {
            status: "duplicate",
            scope: "user",
            webhook_url: redactUrl(webhookUrl),
            organization: organizationUri,
            user: userUri,
            events: EVENTS,
            duplicate: {
              uri: exactUserDuplicate.uri,
              scope: exactUserDuplicate.scope,
              state: exactUserDuplicate.state,
              active: exactUserDuplicate.active,
            },
            note: "Organization-scoped creation was not permitted; an exact user-scoped duplicate already exists.",
            related_subscriptions: relatedUserSubscriptions.map((subscription) => ({
              uri: subscription.uri,
              scope: subscription.scope,
              state: subscription.state,
              active: subscription.active,
              events: subscription.events,
            })),
          },
          null,
          2
        )
      );
      return;
    }

    const created = await createWebhookSubscription(token, userTarget);
    console.log(
      JSON.stringify(
        {
          status: "created",
          scope: "user",
          webhook_url: redactUrl(webhookUrl),
          organization: organizationUri,
          user: userUri,
          events: EVENTS,
          note: "Organization-scoped webhook creation was not permitted, so a user-scoped webhook was created instead.",
          subscription: {
            uri: created.uri,
            scope: created.scope,
            state: created.state,
            active: created.active,
          },
          related_subscriptions: relatedUserSubscriptions.map((subscription) => ({
            uri: subscription.uri,
            scope: subscription.scope,
            state: subscription.state,
            active: subscription.active,
            events: subscription.events,
          })),
        },
        null,
        2
      )
    );
  }
}

main().catch((error) => {
  const payload = error?.payload || null;
  console.error(
    JSON.stringify(
      {
        status: "error",
        message: error?.message || "Calendly webhook registration failed.",
        http_status: error?.status || null,
        details: payload,
      },
      null,
      2
    )
  );
  process.exit(1);
});
