const { cleanShopperText } = require("./askSnoozerPolicy");

const MAX_DISPLAY_REPLY_CHARS = 1800;
const MAX_DISPLAY_SENTENCES = 9;
const MAX_VOICE_REPLY_CHARS = 500;
const MAX_VOICE_SENTENCES = 2;

function cleanAnswerText(raw) {
  return cleanShopperText(
    String(raw || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/\\([#*_`[\]()&])/g, "$1")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/(\d)\s*[–—-]\s*(\d)/g, "$1 to $2")
      .replace(/\s+/g, " ")
  );
}

function ensureSentence(text) {
  const cleaned = cleanAnswerText(text);
  if (!cleaned) return "";
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function clampReply(text, fallback = "", { maxChars, maxSentences } = {}) {
  const cleaned = cleanAnswerText(text || fallback);
  if (!cleaned) return "";
  const sentences = cleaned.split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
  const fitting = [];
  for (const sentence of sentences.slice(0, maxSentences)) {
    const completed = ensureSentence(sentence);
    if ([...fitting, completed].join(" ").length > maxChars) break;
    fitting.push(completed);
  }
  return fitting.length ? fitting.join(" ") : ensureSentence(sentences[0] || cleaned);
}

function clampAskSnoozerVoiceReply(text, fallback = "") {
  return clampReply(text, fallback, { maxChars: MAX_VOICE_REPLY_CHARS, maxSentences: MAX_VOICE_SENTENCES });
}

function clampAskSnoozerDisplayReply(text, fallback = "") {
  return clampReply(text, fallback, { maxChars: MAX_DISPLAY_REPLY_CHARS, maxSentences: MAX_DISPLAY_SENTENCES });
}

module.exports = {
  clampAskSnoozerDisplayReply,
  clampAskSnoozerVoiceReply,
};
