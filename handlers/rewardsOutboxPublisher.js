"use strict";

const { publishRewardsOutbox } = require("../services/rewards/outbox");

exports.handler = async (event) => publishRewardsOutbox(event);
