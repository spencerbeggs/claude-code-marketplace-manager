import { describe, expect, it } from "vitest";
import { STATE_KEYS, StartTimeState } from "../src/state.js";

describe("state", () => {
	it("constructs StartTimeState and exposes keys", () => {
		const s = new StartTimeState({ startedAt: 123 });
		expect(s.startedAt).toBe(123);
		expect(STATE_KEYS.startTime).toBe("start-time");
	});
});
