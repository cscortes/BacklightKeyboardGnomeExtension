// Pure schedule overlap + save-planning logic (testable without Gtk).

export function entryToRanges(entry) {
    const start = entry.start_h * 60 + entry.start_m;
    const end   = entry.end_h   * 60 + entry.end_m;
    if (start === end)
        return [];
    if (start < end)
        return [[start, end]];
    return [[start, 1440], [0, end]];
}

export function rangesOverlap(a, b) {
    return a[0] < b[1] && b[0] < a[1];
}

export function periodsOverlap(a, b) {
    const ra = entryToRanges(a);
    const rb = entryToRanges(b);
    return ra.some(r => rb.some(s => rangesOverlap(r, s)));
}

/** Returns {i, j, a, b} for the first overlapping pair, or null. */
export function findFirstOverlap(entries) {
    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            if (periodsOverlap(entries[i], entries[j]))
                return {i, j, a: entries[i], b: entries[j]};
        }
    }
    return null;
}

export function findOverlapWith(entry, entries) {
    for (const other of entries) {
        if (periodsOverlap(entry, other))
            return other;
    }
    return null;
}

export function entriesEqual(a, b) {
    return a.start_h === b.start_h && a.start_m === b.start_m &&
           a.end_h === b.end_h && a.end_m === b.end_m &&
           a.brightness === b.brightness &&
           (a.aura_mode ?? 'Static') === (b.aura_mode ?? 'Static') &&
           (a.color ?? '#ffffff') === (b.color ?? '#ffffff');
}

/**
 * Builds the entry for a newly added period. Deliberately simple — no
 * whole-day free-gap search (too surprising: it could land anywhere,
 * including an overnight wrap far from what the user was looking at).
 * Instead: the first period ever gets a fixed evening default, and every
 * period after that just continues for one hour from where the last one
 * (last in the list, i.e. the one most recently added) ends. This matches
 * the natural "build up your schedule one block at a time" workflow and
 * only overlaps an existing period in unusual cases (e.g. periods added
 * out of chronological order) — same as any other manual edit, the normal
 * overlap banner (see planScheduleSave) flags it for the user to resolve.
 */
export function nextDefaultEntry(existingPeriods, brightness) {
    const base = {brightness, aura_mode: 'Static', color: '#ffffff'};

    if (existingPeriods.length === 0)
        return {start_h: 18, start_m: 0, end_h: 23, end_m: 0, ...base};

    const last = existingPeriods[existingPeriods.length - 1];
    const startMin = ((last.end_h * 60 + last.end_m) % 1440 + 1440) % 1440;
    const endMin   = (startMin + 60) % 1440;
    return {
        start_h: Math.floor(startMin / 60), start_m: startMin % 60,
        end_h:   Math.floor(endMin / 60),   end_m:   endMin % 60,
        ...base,
    };
}

/**
 * Decide whether the current schedule list should be written to settings.
 * Structural changes (delete / cancel new period) pass alwaysSave: true so
 * removals persist even when remaining periods still overlap.
 *
 * @returns {{save: boolean, conflict: object|null}}
 */
export function planScheduleSave(schedules, {alwaysSave = false, jsonError = false} = {}) {
    if (jsonError && !alwaysSave)
        return {save: false, conflict: null};

    const conflict = findFirstOverlap(schedules);
    if (conflict && !alwaysSave)
        return {save: false, conflict};

    return {save: true, conflict};
}
