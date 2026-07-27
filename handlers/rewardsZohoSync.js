"use strict";

const { processRewardsZohoQueue } = require("../services/rewards/outbox");

exports.handler = async (event) => processRewardsZohoQueue(event);
