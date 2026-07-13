#!/usr/bin/gjs -m
/**
 * Headless tests for schedule overlap detection and save planning.
 */
import {
    entryToRanges,
    periodsOverlap,
    findFirstOverlap,
    findOverlapWith,
    nextDefaultEntry,
    planScheduleSave,
} from '../extension/scheduleLogic.js';

function assert(cond, msg) {
    if (!cond)
        throw new Error(msg);
}

function entry(sh, sm, eh, em, brightness = 3) {
    return {start_h: sh, start_m: sm, end_h: eh, end_m: em, brightness};
}

function testRanges() {
    assert(entryToRanges(entry(9, 0, 12, 0)).length === 1, 'normal period is one range');
    assert(entryToRanges(entry(22, 0, 6, 0)).length === 2, 'midnight wrap is two ranges');
    assert(entryToRanges(entry(9, 0, 9, 0)).length === 0, 'zero-length period has no range');
}

function testOverlapDetection() {
    assert(periodsOverlap(entry(9, 0, 12, 0), entry(11, 0, 13, 0)), 'partial overlap');
    assert(!periodsOverlap(entry(9, 0, 11, 0), entry(11, 0, 13, 0)), 'adjacent periods do not overlap');
    assert(periodsOverlap(entry(22, 0, 6, 0), entry(5, 0, 8, 0)), 'midnight wrap overlaps morning');

    const triple = [entry(9, 0, 12, 0), entry(11, 0, 14, 0), entry(20, 0, 22, 0)];
    const conflict = findFirstOverlap(triple);
    assert(conflict?.i === 0 && conflict?.j === 1, 'findFirstOverlap reports first conflicting pair');

    const candidate = entry(10, 0, 11, 0);
    assert(findOverlapWith(candidate, triple) === triple[0],
        'findOverlapWith finds an existing conflict');
    assert(findOverlapWith(entry(1, 0, 2, 0), triple) === null, 'findOverlapWith returns null when clear');
}

function testDeletePersistsDespiteRemainingOverlap() {
    // Bug scenario: A overlaps B; user deletes unrelated C. Edit path must not
    // save, but delete path (alwaysSave) must persist the removal.
    const a = entry(9, 0, 12, 0);
    const b = entry(11, 0, 14, 0);
    const afterDelete = [a, b];

    const edit = planScheduleSave(afterDelete);
    assert(!edit.save, 'unsaved edit blocked while overlaps remain');
    assert(edit.conflict !== null, 'edit path still reports overlap');

    const removed = planScheduleSave(afterDelete, {alwaysSave: true});
    assert(removed.save, 'delete persists even when remaining periods overlap');
    assert(removed.conflict !== null, 'delete path still reports overlap for UI');
}

function testDeleteResolvesOverlap() {
    const overlapping = entry(11, 0, 14, 0);
    const afterDelete = [overlapping];

    const result = planScheduleSave(afterDelete);
    assert(result.save, 'single remaining period saves normally');
    assert(result.conflict === null, 'no conflict after removing one of overlapping pair');
}

function testNextDefaultEntry() {
    // First period ever: fixed evening default (nothing to continue from).
    const first = nextDefaultEntry([], 3);
    assert(first.start_h === 18 && first.start_m === 0, 'first default starts at 18:00');
    assert(first.end_h === 23 && first.end_m === 0, 'first default ends at 23:00');
    assert(first.brightness === 3, 'default carries the requested brightness');

    // Deliberately simple: no whole-day free-gap search. Every period after
    // the first just continues for one hour from where the *last* one (last
    // in the list) ends — matches building up a schedule one block at a time.
    const afterOne = nextDefaultEntry([entry(18, 0, 19, 0)], 3);
    assert(afterOne.start_h === 19 && afterOne.start_m === 0, 'continues from the last period\'s end time');
    assert(afterOne.end_h === 20 && afterOne.end_m === 0, 'continuation default is one hour long');
    assert(findOverlapWith(afterOne, [entry(18, 0, 19, 0)]) === null,
        'continuation default never overlaps the period it continues from');

    // Continuation wraps midnight correctly.
    const wrapped = nextDefaultEntry([entry(20, 0, 23, 30)], 3);
    assert(wrapped.start_h === 23 && wrapped.start_m === 30, 'continuation start wraps at the last end time');
    assert(wrapped.end_h === 0 && wrapped.end_m === 30, 'continuation end wraps past midnight');

    // Only the last entry in the list matters, not the largest gap overall —
    // this is what makes it simple/predictable instead of "surprising".
    const multi = nextDefaultEntry([entry(1, 0, 2, 0), entry(9, 0, 10, 0)], 3);
    assert(multi.start_h === 10 && multi.start_m === 0,
        'continues from the last-added period in the list, ignoring earlier ones');
}

function testJsonErrorRecovery() {
    const empty = [];

    assert(!planScheduleSave(empty, {jsonError: true}).save,
        'invalid stored JSON blocks normal saves');
    assert(planScheduleSave(empty, {jsonError: true, alwaysSave: true}).save,
        'delete/cancel can recover from invalid stored JSON');
}

function main() {
    testRanges();
    testOverlapDetection();
    testDeletePersistsDespiteRemainingOverlap();
    testDeleteResolvesOverlap();
    testNextDefaultEntry();
    testJsonErrorRecovery();
    print('schedule logic tests OK');
}

try {
    main();
} catch (e) {
    printerr(`schedule logic tests FAILED: ${e.message}`);
    if (e.stack)
        printerr(e.stack);
    imports.system.exit(1);
}
