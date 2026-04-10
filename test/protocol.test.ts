import { describe, expect, test } from "bun:test";
import {
  WIRE,
  isAgentMessageItem,
  isError,
  isNotification,
  isResponse,
  isServerRequest,
  nextRequestId,
  resetRequestIds
} from "../src/protocol";

describe("protocol", () => {
  test("request ids increment", () => {
    resetRequestIds();
    expect(nextRequestId()).toBe("1");
    expect(nextRequestId()).toBe("2");
  });

  test("type guards discriminate messages", () => {
    expect(isResponse({ id: "1", result: {} })).toBe(true);
    expect(isError({ id: "1", error: { code: -1, message: "boom" } })).toBe(true);
    expect(isNotification({ method: "turn/completed" })).toBe(true);
    expect(isServerRequest({ id: "1", method: "item/tool/requestUserInput" })).toBe(true);
  });

  test("wire names are exact", () => {
    expect(WIRE.AGENT_MESSAGE_DELTA).toBe("item/agentMessage/delta");
    expect(WIRE.PLAN_DELTA).toBe("item/plan/delta");
    expect(WIRE.ITEM_COMPLETED).toBe("item/completed");
    expect(WIRE.TOOL_REQUEST_USER_INPUT).toBe("item/tool/requestUserInput");
  });

  test("agent message item detection uses tagged union", () => {
    expect(isAgentMessageItem({ type: "agentMessage", text: "ok" })).toBe(true);
    expect(isAgentMessageItem({ type: "plan", text: "no" })).toBe(false);
  });
});
