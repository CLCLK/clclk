const WIND_HOLD_MS = 5000;
const WIND_HAND_GAP_MS = 650;

// 화면에서 보이는 손바닥 크기를 기준으로 거리를 비교해 카메라 거리 영향을 줄입니다.
function readWindPose(result, aspect) {
  const shapes = readHandShapes(result, aspect);
  if (!shapes) return "missing";
  const open = shapes.every((hand) => hand.curls.every((curl) => curl < 0.3)
    && (hand.curls.every((curl) => curl < 0.22)
      || hand.gestures.some(({ categoryName, score }) => categoryName === "Open_Palm" && score >= 0.4)));
  if (!open) return "closed";
  const distance = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const palms = result.landmarks.map((points) => {
    const center = [0, 5, 9, 13, 17].reduce((sum, index) => ({
      x: sum.x + points[index].x / 5, y: sum.y + points[index].y / 5,
    }), { x: 0, y: 0 });
    return { center, width: distance(points[5], points[17]), length: distance(points[0], points[9]) };
  });
  if (palms.some((palm) => palm.width < palm.length * 0.45)) return "edge";
  const [a, b] = palms;
  const width = (a.width + b.width) / 2;
  const gap = distance(a.center, b.center) / width;
  // 두 손이 각각 보여야 합니다. 겹친 한 손을 중복 검출하거나 멀리 벌린 자세는 제외합니다.
  if (gap < 0.5 || gap > 2.1 || Math.abs(a.center.y - b.center.y) > width
    || Math.min(a.width, b.width) / Math.max(a.width, b.width) < 0.5) return "apart";
  return "ready";
}

function createWindTracker(onWind) {
  let active, elapsed, lastValidAt, lastSampleAt, previousValid;

  function reset() {
    active = previousValid = false;
    elapsed = 0;
    lastValidAt = lastSampleAt = -Infinity;
  }

  function observe(valid, time) {
    if (time - lastValidAt > WIND_HAND_GAP_MS) reset();
    if (valid) {
      if (previousValid) elapsed += time - lastSampleAt;
      active = true;
      lastValidAt = time;
      if (elapsed >= WIND_HOLD_MS) {
        elapsed = 0;
        onWind();
      }
    }
    // 잠깐 놓친 프레임은 진행을 보존하지만, 유효한 유지 시간에는 더하지 않습니다.
    previousValid = valid;
    lastSampleAt = time;
  }

  reset();
  return { observe, reset, progress: () => ({ active, seconds: elapsed / 1000, targetSeconds: 5 }) };
}
