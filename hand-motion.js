// 좌우 손 라벨이 순간 바뀌어도 끊기지 않도록 화면의 두 위치를 기준으로 정렬합니다.
function readHandShapes(result, aspect) {
  if (result.landmarks.length !== 2) return null;
  const hands = [];
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  for (const [index, landmarks] of result.landmarks.entries()) {
    const points = result.worldLandmarks?.[index] ?? landmarks.map(({ x, y, z }) => ({ x: x * aspect, y, z: (z ?? 0) * aspect }));
    if (points.length !== 21 || points.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))) return null;
    const curls = [5, 9, 13, 17].map((base) => {
      const [a, b, c, tip] = points.slice(base, base + 4);
      const first = distance(a, b), second = distance(b, c);
      const length = first + second + distance(c, tip);
      if (first * second <= 0 || length <= 0) return NaN;
      const dot = (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) + (a.z - b.z) * (c.z - b.z);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot / (first * second))));
      // 0이면 편 손가락, 1에 가까울수록 많이 구부린 손가락입니다.
      return Math.max(1 - angle / Math.PI, 1 - distance(a, tip) / length);
    });
    if (!curls.every(Number.isFinite)) return null;
    const [wrist, indexBase, middleBase, pinkyBase] = [landmarks[0], landmarks[5], landmarks[9], landmarks[17]];
    const width = Math.hypot((indexBase.x - pinkyBase.x) * aspect, indexBase.y - pinkyBase.y);
    const length = Math.hypot((wrist.x - middleBase.x) * aspect, wrist.y - middleBase.y);
    const size = Math.sqrt(width * length);
    if (!Number.isFinite(size) || size <= 0) return null;
    hands.push({ x: wrist.x * aspect, y: wrist.y, size, curls, gestures: result.gestures?.[index] ?? [] });
  }
  hands.sort((a, b) => a.x - b.x);
  return hands;
}

function createHandMotion(onMotion, onError, onStatus = () => {}) {
  const tracker = createShakeTracker(() => onMotion("shake"));
  const tickleTracker = createTickleTracker(() => onMotion("tickle"));
  const windTracker = createWindTracker(() => onMotion("wind"));
  let recognizer;
  let loading = false;
  let failed = false;
  let lastReadAt = -Infinity;
  let lastStatusAt = -Infinity;

  function handleError(error) {
    failed = true;
    tracker.reset();
    tickleTracker.reset();
    windTracker.reset();
    console.warn("Could not recognize hand motions.", error);
    onError();
  }

  async function prepare() {
    if (recognizer || loading || failed) return;
    loading = true;
    try {
      const { GestureRecognizer, files } = await loadVisionRuntime();
      recognizer = await GestureRecognizer.createFromOptions(files, {
        baseOptions: { modelAssetPath: `${MEDIAPIPE_MODELS}/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task` },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.35,
        minHandPresenceConfidence: 0.35,
        minTrackingConfidence: 0.35,
      });
    } catch (error) {
      handleError(error);
    } finally {
      loading = false;
    }
  }

  function update(video, time, playing) {
    if (!recognizer) {
      prepare();
      if (!failed) onStatus("손 인식 준비 중이에요…");
      return;
    }
    if (failed || !playing || time - lastReadAt < 48) return;
    lastReadAt = time;
    let result;
    try {
      result = recognizer.recognizeForVideo(video, time);
    } catch (error) {
      recognizer.close();
      recognizer = null;
      handleError(error);
      return;
    }
    const aspect = video.videoWidth / video.videoHeight;
    const tickleHands = readTickleHands(result, aspect);
    const fists = readFistSamples(result, aspect);
    const windPose = readWindPose(result, aspect);
    windTracker.observe(windPose === "ready", time);
    if (windPose === "ready") {
      tickleTracker.reset();
      tracker.reset();
    } else {
      tickleTracker.observe(tickleHands, time);
      if (tickleTracker.isActive()) tracker.reset();
      else tracker.observe(fists, time);
    }
    if (time - lastStatusAt >= 200) {
      lastStatusAt = time;
      const tickling = tickleTracker.isActive();
      const windProgress = windTracker.progress();
      const progress = windProgress.active ? windProgress : tickling ? tickleTracker.progress(time) : tracker.progress(time);
      let message;
      if (windProgress.active) message = `바람 불기 ${progress.seconds.toFixed(1)} / 5.0초 · 양손을 가까이, 손바닥이 보이게 유지해 주세요!`;
      else if (result.landmarks.length < 2) message = `손 ${result.landmarks.length}/2개 인식 · 양손이 겹치지 않게 보여 주세요.`;
      else if (windPose === "apart") message = "펼친 양손을 가까이 모아 주세요. 손바닥이 각각 보이게 나란히!";
      else if (windPose === "edge") message = "양손의 손바닥을 카메라 쪽으로 보여 주세요.";
      else if (progress.seconds > 0) message = `${tickling ? "간지럽히기" : "흔들기"} ${progress.seconds.toFixed(1)} / ${progress.targetSeconds.toFixed(1)}초 · 양손으로 계속해 주세요!`;
      else if (tickleHands?.every((hand) => hand.indexOut)) message = "양 검지 인식! 구부렸다 펴며 간지럽혀 주세요.";
      else if (fists) message = "양 주먹 인식! 앞으로 쿵쿵 두드려 주세요.";
      else if (tickleHands) message = "양손 인식! 두 검지를 구부렸다 펴 주세요.";
      else message = "양손 인식 · 주먹을 쥐거나 검지를 까딱해 주세요.";
      onStatus(message, progress.seconds > 0 || result.landmarks.length === 2);
    }
  }

  function reset() {
    tracker.reset();
    tickleTracker.reset();
    windTracker.reset();
    lastReadAt = -Infinity;
    lastStatusAt = -Infinity;
    failed = false;
  }

  return { update, reset };
}

