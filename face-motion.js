const NOISE_HOLD_MS = 2000;
const NOISE_GAP_MS = 350;

// 거리나 고개 기울기에 덜 민감하도록 입 높이를 입 너비·눈 사이 거리와 비교합니다.
function readMouthOpening(result, aspect) {
  const points = result.faceLandmarks?.[0];
  if (!points) return null;
  const [upper, lower, left, right, leftEye, rightEye] = [13, 14, 61, 291, 33, 263].map((index) => points[index]);
  if ([upper, lower, left, right, leftEye, rightEye].some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const distance = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const height = distance(upper, lower);
  const width = distance(left, right);
  const faceWidth = distance(leftEye, rightEye);
  if (width < 0.001 || faceWidth < 0.001) return null;
  return { mouthRatio: height / width, faceRatio: height / faceWidth };
}

function createNoiseTracker(onNoise) {
  let active;
  let elapsed;
  let lastOpenAt;
  let lastSampleAt;
  let previousOpen;

  function reset() {
    active = previousOpen = false;
    elapsed = 0;
    lastOpenAt = lastSampleAt = -Infinity;
  }

  function observe(opening, time) {
    if (time - lastOpenAt > NOISE_GAP_MS) reset();
    // 시작한 뒤에는 조금 작아져도 유지해 입 모양의 작은 흔들림을 허용합니다.
    const open = !!opening && opening.mouthRatio >= (active ? 0.28 : 0.36)
      && opening.faceRatio >= (active ? 0.09 : 0.12);
    if (open) {
      if (previousOpen) elapsed += time - lastSampleAt;
      active = true;
      lastOpenAt = time;
      if (elapsed >= NOISE_HOLD_MS) {
        elapsed = 0;
        onNoise();
      }
    }
    // 짧게 가려진 구간은 진행을 보존하되 유지 시간에 더하지 않습니다.
    previousOpen = open;
    lastSampleAt = time;
  }

  reset();
  return { observe, reset, progress: () => ({ active, seconds: elapsed / 1000 }) };
}

function createFaceMotion(onMotion, onError, onStatus = () => {}) {
  const tracker = createNoiseTracker(() => onMotion("noise"));
  const analysis = document.createElement("canvas");
  const painter = analysis.getContext("2d");
  let landmarker;
  let loading = false;
  let failed = false;
  let lastReadAt = -Infinity;
  let lastStatusAt = -Infinity;

  function handleError(error) {
    failed = true;
    tracker.reset();
    console.warn("Could not recognize facial motions.", error);
    onError();
  }

  async function prepare() {
    if (landmarker || loading || failed) return;
    loading = true;
    try {
      const { FaceLandmarker, files } = await loadVisionRuntime();
      landmarker = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: `${MEDIAPIPE_MODELS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task` },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.4,
        minFacePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      });
    } catch (error) {
      handleError(error);
    } finally {
      loading = false;
    }
  }

  function update(video, time, playing) {
    if (!landmarker) {
      prepare();
      if (!failed) onStatus("얼굴 인식 준비 중이에요…", false);
      return;
    }
    if (failed || !playing || time - lastReadAt < 100) return;
    lastReadAt = time;
    let opening;
    try {
      const width = Math.min(480, video.videoWidth);
      const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
      if (analysis.width !== width || analysis.height !== height) {
        analysis.width = width;
        analysis.height = height;
      }
      painter.drawImage(video, 0, 0, width, height);
      opening = readMouthOpening(landmarker.detectForVideo(analysis, time), width / height);
    } catch (error) {
      landmarker.close();
      landmarker = null;
      handleError(error);
      return;
    }
    tracker.observe(opening, time);
    if (time - lastStatusAt >= 200) {
      lastStatusAt = time;
      const { active, seconds } = tracker.progress();
      const message = active ? `소음 내기 ${seconds.toFixed(1)} / 2.0초 · 입을 크게 벌린 채 유지해 주세요!`
        : opening ? "얼굴 인식! 입을 크게 벌려 2초 유지해 주세요. 소리는 내지 않아도 돼요."
          : "얼굴을 카메라에 보여 주세요. 손 동작이나 공격 버튼도 사용할 수 있어요.";
      onStatus(message, active);
    }
  }

  function reset() {
    tracker.reset();
    lastReadAt = lastStatusAt = -Infinity;
    failed = false;
  }

  return { update, reset };
}
