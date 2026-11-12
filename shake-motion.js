const SHAKE_HOLD_MS = 2000;
const SHAKE_PAUSE_MS = 1300;
const SHAKE_HAND_GAP_MS = 650;
const SHAKE_RETURN_MS = 1300;
const SHAKE_FIST_SCORE = 0.35;

function createShakeTracker(onShake) {
  let hands;
  let lastBothAt;
  let firstPushAt;
  let lastMotionAt;
  let fired;

  function clearSequence() {
    hands = [];
    lastBothAt = firstPushAt = -Infinity;
  }

  function reset() {
    clearSequence();
    lastMotionAt = -Infinity;
    fired = false;
  }

  function measure(hand, sample, time) {
    hand.size += (sample.size - hand.size) * 0.6;
    hand.x += (sample.x - hand.x) * 0.6;
    hand.y += (sample.y - hand.y) * 0.6;
    const travel = Math.hypot(hand.x - hand.originX, hand.y - hand.originY) / hand.rest;
    if (hand.peak === null) {
      if (hand.size >= hand.rest * 1.06 || travel >= 0.18) {
        hand.peak = hand.size;
        hand.positionPush = travel >= 0.18;
        hand.pushedAt = time;
        return "push";
      }
      // Follow gradual changes in distance, while keeping quick moves visible.
      hand.rest += (hand.size - hand.rest) * (hand.size < hand.rest ? 0.2 : 0.03);
      hand.originX += (hand.x - hand.originX) * 0.03;
      hand.originY += (hand.y - hand.originY) * 0.03;
      return;
    }

    hand.peak = Math.max(hand.peak, hand.size);
    if (time - hand.pushedAt > SHAKE_RETURN_MS) {
      hand.peak = null;
      hand.rest = hand.size;
      hand.originX = hand.x;
      hand.originY = hand.y;
    } else if (hand.positionPush ? travel <= 0.08 : hand.size <= hand.peak * 0.96 && hand.size <= hand.rest * 1.04) {
      hand.peak = null;
      hand.rest = hand.size;
      hand.returned = true;
      return "return";
    }
  }

  function observe(sizes, time) {
    const lostHands = time - lastBothAt > SHAKE_HAND_GAP_MS;
    if (fired && time - lastMotionAt > SHAKE_PAUSE_MS) reset();
    const paused = firstPushAt !== -Infinity && hands.some((hand) => time - hand.lastMoveAt > SHAKE_PAUSE_MS);
    if (lostHands || paused) clearSequence();
    if (!sizes) return;
    const samples = sizes.map((value) => typeof value === "number" ? { size: value, x: 0, y: 0 } : value);
    lastBothAt = time;
    if (!hands.length) {
      hands = samples.map(({ size, x, y }) => ({ size, x, y, originX: x, originY: y,
        rest: size, peak: null, returned: false, startedAt: null, lastMoveAt: time }));
      return;
    }

    let completedKnock = false;
    for (const [index, hand] of hands.entries()) {
      const step = measure(hand, samples[index], time);
      if (!step) continue;
      if (firstPushAt === -Infinity) firstPushAt = time;
      lastMotionAt = time;
      hand.lastMoveAt = time;
      if (hand.startedAt === null) hand.startedAt = time;
      if (step === "return") completedKnock = true;
    }
    if (!fired && completedKnock && hands.every((hand) => hand.returned && hand.startedAt !== null && time - hand.startedAt >= SHAKE_HOLD_MS)) {
      fired = true;
      onShake();
    }
  }

  function progress(time) {
    const seconds = hands.length === 2 && hands.every((hand) => hand.startedAt !== null)
      ? Math.min(2, Math.max(0, (time - Math.max(...hands.map((hand) => hand.startedAt))) / 1000)) : 0;
    return { seconds, fired };
  }

  reset();
  return { observe, reset, progress };
}

function readFistSamples(result, aspect) {
  const hands = readHandShapes(result, aspect);
  if (!hands) return null;
  const isFist = (hand) => hand.gestures.some(({ categoryName, score }) => categoryName === "Closed_Fist" && score >= SHAKE_FIST_SCORE)
    || hand.curls[0] > 0.25 && hand.curls.slice(1).filter((curl) => curl > 0.25).length >= 2;
  return hands.every(isFist) ? hands.map(({ size, x, y }) => ({ size, x, y })) : null;
}

function readFistSizes(result, aspect) {
  return readFistSamples(result, aspect)?.map(({ size }) => size) ?? null;
}
