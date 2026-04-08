const axios = require("axios");

async function getSnoozerResponse(userMessage, metadata = {}, handleToolCall = null, incomingThreadId = null) {
  const assistant_id = process.env.SNOOZER_ASSISTANT_ID;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!assistant_id || !apiKey) {
    throw new Error("Missing OpenAI Assistant ID or API Key in environment.");
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": "assistants=v2"
  };

  try {
    let thread_id = incomingThreadId;

    if (!thread_id) {
      console.log("📨 Creating new thread...");
      const threadRes = await axios.post("https://api.openai.com/v1/threads", {}, { headers });
      thread_id = threadRes.data.id;
    }

    const runCheck = await axios.get(`https://api.openai.com/v1/threads/${thread_id}/runs`, { headers });
    const activeRun = runCheck.data.data.find(run => run.status !== "completed" && run.status !== "failed" && run.status !== "cancelled");

    if (activeRun) {
      console.warn(`⚠️ Cannot send message — active run still in progress: ${activeRun.id}`);
      return {
        reply: "I'm still thinking about your last question. Try again in a moment or start a new session.",
        thread_id
      };
    }

    console.log("✉️ Adding message:", userMessage);
    await axios.post(
      `https://api.openai.com/v1/threads/${thread_id}/messages`,
      { role: "user", content: userMessage },
      { headers }
    );

    console.log("⚙️ Running assistant with metadata:", metadata);
    const runRes = await axios.post(
      `https://api.openai.com/v1/threads/${thread_id}/runs`,
      { assistant_id, metadata },
      { headers }
    );

    let run_id = runRes.data.id;
    let status = runRes.data.status;
    let attempts = 0;

    while (status !== "completed" && attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const poll = await axios.get(`https://api.openai.com/v1/threads/${thread_id}/runs/${run_id}`, { headers });
      status = poll.data.status;

      if (status === "requires_action" && poll.data.required_action?.submit_tool_outputs) {
        const toolCalls = poll.data.required_action.submit_tool_outputs.tool_calls;
        const toolOutputs = [];

        for (const call of toolCalls) {
          const toolName = call.function.name;
          const args = JSON.parse(call.function.arguments || "{}");

          // ✅ Patch missing fields from memory if provided
          const memory = safeParse(metadata.memory);
          const enrichedArgs = { ...memory, ...args }; // args take precedence
          console.log(`🛠️ GPT called tool: ${toolName}`, enrichedArgs);

          let result = { error: "Tool not implemented." };
          if (handleToolCall) {
            result = await handleToolCall(toolName, enrichedArgs);
          }

          toolOutputs.push({
            tool_call_id: call.id,
            output: JSON.stringify(result)
          });
        }

        console.log("🔁 Submitting tool outputs back to GPT:", toolOutputs);

        const continueRun = await axios.post(
          `https://api.openai.com/v1/threads/${thread_id}/runs/${run_id}/submit_tool_outputs`,
          { tool_outputs: toolOutputs },
          { headers }
        );

        run_id = continueRun.data.id;
        status = continueRun.data.status;
      }

      attempts++;
    }

    if (status !== "completed") {
      throw new Error("Assistant run did not complete in time.");
    }

    console.log("📨 Fetching messages...");
    const messagesRes = await axios.get(
      `https://api.openai.com/v1/threads/${thread_id}/messages`,
      { headers }
    );

    const messages = messagesRes.data.data;
    const assistantReply = messages.find((msg) => msg.role === "assistant");
    const reply = assistantReply?.content?.[0]?.text?.value || "";

    console.log("✅ Assistant Reply:", reply);
    return { reply, thread_id };
  } catch (err) {
    console.error("❌ OpenAI Assistants API Error:", err.response?.data || err.message);
    return {
      reply: "Hmm, something went wrong reaching Snoozer’s brain. Try again or ask a human.",
      thread_id: incomingThreadId || null
    };
  }
}

// Internal helper for safe JSON parsing
function safeParse(raw) {
  if (!raw || typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

module.exports = { getSnoozerResponse };

