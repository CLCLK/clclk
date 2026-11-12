const SHAKE_HOLD_MS = 1000;
const SHAKE_PAUSE_MS = 900;
const SHAKE_HAND_GAP_MS = 650;
const SHAKE_FIST_SCORE = 0.35;

function createShakeTracker(onShake) {
  let hands;
  let lastBothAt;

  function reset() {
    hands = [];
    lastBothAt = -Infinity;
  }

  function observe(values, time) {
    const lostHands = time - lastBothAt > SHAKE_HAND_GAP_MS;
    const paused = hands.some((hand) => hand.startedAt !== null)
      && hands.some((hand) => time - hand.lastMoveAt > SHAKE_PAUSE_MS);
    if (lostHands || paused) reset();
    if (!values) return;
    const samples = values.map((value) => typeof value === "number" ? { size: value, x: 0, y: 0 } : value);
    lastBothAt = time;
    if (!hands.length) {
      hands = samples.map(({ size, x, y }) => ({
        smooth: [size, x, y], anchors: [size, x, y], directions: [0, 0, 0],
        scale: size, startedAt: null, lastMoveAt: time, reversals: 0,
      }));
      return;
    }

    let reversed = false;
    for (const [index, hand] of hands.entries()) {
      const sample = samples[index];
      for (const [axis, value] of [sample.size, sample.x, sample.y].entries()) {
        hand.smooth[axis] += (value - hand.smooth[axis]) * 0.6;
        const threshold = axis === 0 ? hand.anchors[0] * 0.04 : hand.scale * 0.12;
        const change = hand.smooth[axis] - hand.anchors[axis];
        if (Math.abs(change) < threshold) continue;
        const direction = Math.sign(change);
        // 출발 위치에 정확히 돌아왔는지가 아니라, 움직이는 방향이 바뀌었는지 봅니다.
        if (hand.directions[axis] && hand.directions[axis] !== direction) {
          hand.reversals++;
          reversed = true;
        }
        hand.directions[axis] = direction;
        hand.anchors[axis] = hand.smooth[axis];
        hand.lastMoveAt = time;
        if (hand.startedAt === null) hand.startedAt = time;
      }
    }

    if (reversed && hands.every((hand) => hand.startedAt !== null
      && time - hand.startedAt >= SHAKE_HOLD_MS && hand.reversals > 0
      && time - hand.lastMoveAt <= SHAKE_HAND_GAP_MS)) {
      // 다음 1초 구간을 곧바로 셉니다. 같은 스킬의 효과 제한은 게임 규칙에서 처리합니다.
      for (const hand of hands) { hand.startedAt = time; hand.reversals = 0; }
      onShake();
    }
  }

  function progress(time) {
    const seconds = hands.length === 2 && hands.every((hand) => hand.startedAt !== null)
      ? Math.min(1, Math.max(0, (time - Math.max(...hands.map((hand) => hand.startedAt))) / 1000)) : 0;
    return { seconds, targetSeconds: 1 };
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
