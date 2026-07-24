import { Schema } from "effect";

/** Start time recorded in pre, read in post for duration reporting. */
export class StartTimeState extends Schema.Class<StartTimeState>("StartTimeState")({
	startedAt: Schema.Number,
}) {}

/** ActionState keys for this action. */
export const STATE_KEYS = {
	startTime: "start-time",
} as const;
