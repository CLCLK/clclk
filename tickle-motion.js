const TICKLE_HOLD_MS = 2000;
const TICKLE_PAUSE_MS = 1300;
const TICKLE_HAND_GAP_MS = 650;
const TICKLE_CURL_CHANGE = 0.13;

// 두 손 각각의 '펴기 → 구부리기 → 펴기'를 추적합니다.
function createTickleTracker(onTickle) {
  let hands;
  let lastBothAt;

  function clearSequence() {
    hands = [];
    lastBothAt = -Infinity;
  }

  function reset() {
    clearSequence();
  }

  function observe(samples, time) {
    const lostHands = time - lastBothAt > TICKLE_HAND_GAP_MS;
    const pausedHand = hands.some((hand) => hand.startedAt !== null)
      && hands.some((hand) => time - hand.lastMoveAt > TICKLE_PAUSE_MS);
    if (lostHands || pausedHand) clearSequence();
    if (!samples) return;
    lastBothAt = time;

    if (!hands.length || hands.some((hand, index) => hand.id !== samples[index].id)) {
      hands = samples.map(({ id, curl, indexOut }) => ({
        id, curl, anchor: curl, direction: 0, pointed: indexOut,
        startedAt: null, steps: 0, lastMoveAt: time,
      }));
      return;
    }

    let completedCycle = false;
    for (const [index, hand] of hands.entries()) {
      const sample = samples[index];
      hand.pointed ||= sample.indexOut;
      hand.curl += (sample.curl - hand.curl) * 0.6;
      const change = hand.curl - hand.anchor;
      // 완전히 펴지 않아도, 굽힘 정도가 충분히 달라졌다 돌아오면 셉니다.
      const direction = change >= TICKLE_CURL_CHANGE ? 1 : change <= -TICKLE_CURL_CHANGE ? -1 : 0;
      if (!direction || direction === hand.direction) {
        if (hand.direction === 1) hand.anchor = Math.max(hand.anchor, hand.curl);
        if (hand.direction === -1) hand.anchor = Math.min(hand.anchor, hand.curl);
        continue;
      }
      hand.direction = direction;
      hand.anchor = hand.curl;
      hand.steps++;
      hand.lastMoveAt = time;
      if (hand.startedAt === null) hand.startedAt = time;
      completedCycle = true;
    }

    if (completedCycle && hands.every((hand) =>
      hand.pointed && hand.startedAt !== null && time - hand.startedAt >= TICKLE_HOLD_MS && hand.steps >= 4)) {
      for (const hand of hands) { hand.startedAt = time; hand.steps = 0; }
      onTickle();
    }
  }

  // 정지한 검지나 한 프레임의 오인식으로 흔들기를 막지 않습니다.
  function isActive() {
    return hands.length === 2 && hands.every((hand) => hand.pointed && hand.direction !== 0);
  }

  function progress(time) {
    const seconds = isActive() && hands.length === 2
      ? Math.min(2, Math.max(0, (time - Math.max(...hands.map((hand) => hand.startedAt ?? time))) / 1000)) : 0;
    return { seconds, targetSeconds: 2 };
  }

  reset();
  return { observe, reset, isActive, progress };
}

function readTickleHands(result, aspect) {
  const shapes = readHandShapes(result, aspect);
  if (!shapes || shapes.some((hand) => !hand.curls.slice(1).some((curl) => curl > 0.15))) return null;
  return shapes.map((hand, index) => ({
    id: index,
    curl: hand.curls[0],
    indexOut: hand.curls[0] < 0.4 && Math.max(...hand.curls.slice(1)) - hand.curls[0] > 0.12,
  }));
}
