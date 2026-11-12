function createHandMotion(onMotion, onError) {
  const tracker = createShakeTracker(() => onMotion("shake"));
  const tickleTracker = createTickleTracker(() => onMotion("tickle"));
  let recognizer;
  let loading = false;
  let failed = false;
  let lastReadAt = -Infinity;

  function handleError(error) {
    failed = true;
    tracker.reset();
    tickleTracker.reset();
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
    tickleTracker.observe(readTickleHands(result, aspect), time);
    if (tickleTracker.isActive()) tracker.reset();
    else tracker.observe(readFistSizes(result, aspect), time);
  }

  function reset() {
    tracker.reset();
    tickleTracker.reset();
    lastReadAt = -Infinity;
    failed = false;
  }

  return { update, reset };
}

