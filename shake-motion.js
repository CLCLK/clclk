const SHAKE_HOLD_MS = 2000;
const SHAKE_PAUSE_MS = 950;
const SHAKE_HAND_GAP_MS = 260;
const SHAKE_RETURN_MS = 750;
const SHAKE_FIST_SCORE = 0.55;

function createShakeTracker(onShake) {
  let hands;
  let lastBothAt;
  let firstPushAt;
  let lastMotionAt;
  let fired;

  function reset() {
    hands = [];
    lastBothAt = firstPushAt = lastMotionAt = -Infinity;
    fired = false;
  }

  function measure(hand, size, time) {
    hand.size += (size - hand.size) * 0.6;
    if (hand.peak === null) {
      if (hand.size >= hand.rest * 1.14) {
        hand.peak = hand.size;
        hand.pushedAt = time;
        return "push";
      }
      // Follow gradual changes in distance, while keeping quick moves visible.
      hand.rest += (hand.size - hand.rest) * (hand.size < hand.rest ? 0.32 : 0.09);
      return;
    }

    hand.peak = Math.max(hand.peak, hand.size);
    if (time - hand.pushedAt > SHAKE_RETURN_MS) {
      hand.peak = null;
      hand.rest = hand.size;
    } else if (hand.size <= hand.peak * 0.90 && hand.size <= hand.rest * 1.08) {
      hand.peak = null;
      hand.rest = hand.size;
      hand.returned = true;
      return "return";
    }
  }

  function observe(sizes, time) {
    const lostHands = time - lastBothAt > SHAKE_HAND_GAP_MS;
    const paused = firstPushAt !== -Infinity && time - lastMotionAt > SHAKE_PAUSE_MS;
    if (lostHands || paused) reset();
    if (!sizes) return;
    lastBothAt = time;
    if (!hands.length) {
      hands = sizes.map((size) => ({ size, rest: size, peak: null, returned: false }));
      return;
    }

    let completedKnock = false;
    for (const [index, hand] of hands.entries()) {
      const step = measure(hand, sizes[index], time);
      if (!step) continue;
      if (firstPushAt === -Infinity) firstPushAt = time;
      lastMotionAt = time;
      if (step === "return") completedKnock = true;
    }
    if (!fired && completedKnock && time - firstPushAt >= SHAKE_HOLD_MS && hands.every((hand) => hand.returned)) {
      fired = true;
      onShake();
    }
  }

  reset();
  return { observe, reset };
}

function readFistSizes(result, aspect) {
  if (result.landmarks.length !== 2) return null;
  const hands = [];
  for (const [index, points] of result.landmarks.entries()) {
    const fist = result.gestures[index]?.some(({ categoryName, score }) => categoryName === "Closed_Fist" && score >= SHAKE_FIST_SCORE);
    if (!fist) return null;
    const [wrist, indexBase, middleBase, pinkyBase] = [points[0], points[5], points[9], points[17]];
    const palmWidth = Math.hypot((indexBase.x - pinkyBase.x) * aspect, indexBase.y - pinkyBase.y);
    const palmLength = Math.hypot((wrist.x - middleBase.x) * aspect, wrist.y - middleBase.y);
    const size = Math.sqrt(palmWidth * palmLength);
    if (!Number.isFinite(size) || size <= 0) return null;
    hands.push({ x: wrist.x, size });
  }
  // The input is the full, unmirrored camera frame. Keep the two sides consistent.
  hands.sort((a, b) => a.x - b.x);
  return hands.map(({ size }) => size);
}
