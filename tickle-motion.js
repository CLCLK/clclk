const TICKLE_HOLD_MS = 2000;
const TICKLE_PAUSE_MS = 950;
const TICKLE_HAND_GAP_MS = 260;

// 두 손 각각의 '펴기 → 구부리기 → 펴기'를 추적합니다.
function createTickleTracker(onTickle) {
  let hands;
  let lastBothAt;
  let lastMotionAt;
  let fired;

  function clearSequence() {
    hands = [];
    lastBothAt = -Infinity;
  }

  function reset() {
    clearSequence();
    lastMotionAt = -Infinity;
    fired = false;
  }

  function observe(samples, time) {
    if (fired && time - lastMotionAt > TICKLE_PAUSE_MS) reset();
    const lostHands = time - lastBothAt > TICKLE_HAND_GAP_MS;
    const pausedHand = hands.some((hand) => hand.startedAt !== null)
      && hands.some((hand) => time - hand.lastMoveAt > TICKLE_PAUSE_MS);
    if (lostHands || pausedHand) clearSequence();
    if (!samples) return;
    lastBothAt = time;

    if (!hands.length || hands.some((hand, index) => hand.id !== samples[index].id)) {
      hands = samples.map(({ id, pose }) => ({ id, pose, startedAt: null, cycles: 0, lastMoveAt: time }));
      return;
    }

    let completedCycle = false;
    for (const [index, hand] of hands.entries()) {
      const pose = samples[index].pose;
      // 중간 각도에서는 이전 상태를 유지해 작은 떨림을 반복 동작으로 세지 않습니다.
      if (!pose || pose === hand.pose) continue;
      const previous = hand.pose;
      hand.pose = pose;
      if (!previous) continue;
      hand.lastMoveAt = lastMotionAt = time;
      if (previous === "straight" && pose === "curled" && hand.startedAt === null) hand.startedAt = time;
      if (pose === "straight" && hand.startedAt !== null) {
        hand.cycles++;
        completedCycle = true;
      }
    }

    if (!fired && completedCycle && hands.every((hand) =>
      hand.startedAt !== null && time - hand.startedAt >= TICKLE_HOLD_MS && hand.cycles >= 2)) {
      fired = true;
      onTickle();
    }
  }

  // 검지를 편 준비 자세와 진행 중인 간지럽히기는 흔들기보다 우선합니다.
  function isActive() {
    return fired || hands.some((hand) => hand.pose === "straight" || hand.startedAt !== null);
  }

  reset();
  return { observe, reset, isActive };
}

function readTickleHands(result, aspect) {
  if (result.landmarks.length !== 2) return null;
  const hands = [];

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  function fingerPose(points, base) {
    const [a, b, c, tip] = points.slice(base, base + 4);
    const first = distance(a, b);
    const second = distance(b, c);
    const length = first + second + distance(c, tip);
    if (first * second <= 0 || length <= 0) return null;
    const cosine = ((a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) + (a.z - b.z) * (c.z - b.z)) / (first * second);
    const angle = Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
    const reach = distance(a, tip) / length;
    if (angle > 155 && reach > 0.87) return "straight";
    if (angle < 125 || reach < 0.78) return "curled";
    return null;
  }

  for (const [index, landmarks] of result.landmarks.entries()) {
    const side = result.handedness?.[index]?.[0];
    if (!side || side.score < 0.55) return null;
    // 3D 관절로 판정합니다. 대체 이미지 좌표도 가로·세로 비율을 맞춥니다.
    const points = result.worldLandmarks?.[index] ?? landmarks.map(({ x, y, z }) => ({ x: x * aspect, y, z: (z ?? 0) * aspect }));
    if (points.length !== 21 || points.some((point) => ![point.x, point.y, point.z].every(Number.isFinite))) return null;
    // 엄지는 자유롭게 두고, 나머지 세 손가락 중 두 개 이상은 접힌 자세로 봅니다.
    if ([9, 13, 17].filter((base) => fingerPose(points, base) === "curled").length < 2) return null;
    hands.push({ id: side.categoryName, pose: fingerPose(points, 5) });
  }

  if (hands[0].id === hands[1].id) return null;
  hands.sort((a, b) => a.id.localeCompare(b.id));
  return hands;
}
