export interface TriggerMatch {
    /** Text typed after the trigger, up to the cursor. */
    query: string;
    /** Character offset on the line where the trigger starts. */
    startCh: number;
}

/**
 * Returns true when `trigger` would collide with Obsidian's built-in `[[`
 * link suggester (index 0, always wins). Used by both the settings validator
 * and `parseTrigger` so the rule lives in one place.
 */
export function isForbiddenTrigger(trigger: string): boolean {
    return trigger.startsWith("[");
}

/**
 * Parse the part of the editor line up to the cursor for the semantic-link
 * trigger. Returns the query (text after the last trigger occurrence) and the
 * trigger's start offset, or null when the feature is disabled / the trigger is
 * absent.
 *
 * A trigger starting with '[' is rejected so it can never re-collide with
 * Obsidian's built-in `[[` link suggester (which is index 0 and always wins).
 */
export function parseTrigger(
    lineUpToCursor: string,
    trigger: string
): TriggerMatch | null {
    if (!trigger || isForbiddenTrigger(trigger)) return null;

    const idx = lineUpToCursor.lastIndexOf(trigger);
    if (idx === -1) return null;

    return {
        query: lineUpToCursor.slice(idx + trigger.length),
        startCh: idx,
    };
}
