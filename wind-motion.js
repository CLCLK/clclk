const WIND_HOLD_MS = 1500;
const WIND_HAND_GAP_MS = 650;

// 손 사이 거리나 높이, 앞으로 미는 움직임 없이 펼친 두 손만 확인합니다.
function readWindPose(result, aspect) {
  const shapes = readHandShapes(result, aspect);
  if (!shapes) return "missing";
  const open = shapes.every((hand) => hand.curls.every((curl) => curl < 0.3)
    && (hand.curls.every((curl) => curl < 0.22)
      || hand.gestures.some(({ categoryName, score }) => categoryName === "Open_Palm" && score >= 0.4)));
  return open ? "ready" : "closed";
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
  return { observe, reset, progress: () => ({ active, seconds: elapsed / 1000, targetSeconds: WIND_HOLD_MS / 1000 }) };
}
