const VISION_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18";
const MEDIAPIPE_MODELS = "https://storage.googleapis.com/mediapipe-models";
let visionRuntime;

function loadVisionRuntime() {
  visionRuntime ??= import(`${VISION_CDN}/vision_bundle.mjs`).then(async (vision) => ({
    ...vision,
    files: await vision.FilesetResolver.forVisionTasks(`${VISION_CDN}/wasm`),
  })).catch((error) => {
    visionRuntime = null;
    throw error;
  });
  return visionRuntime;
}

async function loadWindowModels() {
  const { FaceDetector, ImageSegmenter, files } = await loadVisionRuntime();
  const detector = await FaceDetector.createFromOptions(files, {
    baseOptions: { modelAssetPath: `${MEDIAPIPE_MODELS}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite` },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.35,
  });
  try {
    const segmenter = await ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: `${MEDIAPIPE_MODELS}/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite` },
      runningMode: "VIDEO",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    return { detector, segmenter };
  } catch (error) {
    detector.close();
    throw error;
  }
}

function createWindowCamera(canvas, showStatus, onFrame) {
  const context = canvas.getContext("2d");
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;

  const analysis = document.createElement("canvas");
  const analysisContext = analysis.getContext("2d");
  const crop = document.createElement("canvas");
  crop.width = 480;
  crop.height = 270;
  const cropContext = crop.getContext("2d");
  const mask = document.createElement("canvas");
  const maskContext = mask.getContext("2d");
  let maskPixels;

  // Two panes share one picture, while the painted edges and corner seam stay clear.
  const glass = new Path2D();
  for (const pane of [
    [[0.0708, 0.0825], [0.4981, 0.0162], [0.4981, 0.449], [0.0708, 0.553]],
    [[0.5014, 0.0162], [0.9796, 0.0834], [0.9796, 0.6175], [0.5014, 0.4495]],
  ]) {
    const [[x, y], ...corners] = pane;
    glass.moveTo(x * canvas.width, y * canvas.height);
    for (const [u, v] of corners) glass.lineTo(u * canvas.width, v * canvas.height);
    glass.closePath();
  }
  const reflection = context.createLinearGradient(0, 0, canvas.width * 0.7, canvas.height * 0.84);
  reflection.addColorStop(0.32, "transparent");
  reflection.addColorStop(0.46, "#f3faff16");
  reflection.addColorStop(0.49, "#f3faff06");
  reflection.addColorStop(0.51, "transparent");

  let modelsPromise;
  let windowModels;
  let windowVisible = false;
  let stream;
  let frame = 0;
  let requestId = 0;
  let requested = false;
  let status = "";
  let cropBounds;
  let lastFaceAt;
  let lastDetectionAt;
  let lastFrameAt;
  let lastVideoTime;
  let searchPosition = 0;

  function setStatus(next, message) {
    if (status === next) return;
    status = next;
    showStatus(next, message);
  }

  function stop(next = "off", message = "") {
    requestId++;
    requested = false;
    cancelAnimationFrame(frame);
    const previous = stream;
    stream = null;
    previous?.getTracks().forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
    windowVisible = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    cropBounds = null;
    setStatus(next, message);
  }

  function findFace(detector, time) {
    const source = { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight };
    function detect(timestamp) {
      analysisContext.drawImage(video, source.x, source.y, source.width, source.height,
        0, 0, analysis.width, analysis.height);
      return detector.detectForVideo(analysis, timestamp).detections
        .map(item => item.boundingBox).filter(Boolean)
        .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    }
    let face = detect(time);
    if (!face) {
      // 먼 얼굴은 화면 일부를 확대해 다시 찾습니다. 가운데→왼쪽→오른쪽 순서입니다.
      source.width *= 0.55;
      source.height *= 0.65;
      source.x = video.videoWidth * [0.225, 0, 0.45][searchPosition++ % 3];
      source.y = video.videoHeight * 0.1;
      face = detect(time + 0.01);
    }
    if (!face) return;
    const scaleX = source.width / analysis.width;
    const scaleY = source.height / analysis.height;
    const next = getFaceShoulderCrop({
      originX: source.x + face.originX * scaleX, originY: source.y + face.originY * scaleY,
      width: face.width * scaleX, height: face.height * scaleY,
    }, video.videoWidth, video.videoHeight, crop.width / crop.height);
    if (!cropBounds || time - lastFaceAt > 1500) cropBounds = next;
    else for (const key of Object.keys(next)) cropBounds[key] += (next[key] - cropBounds[key]) * 0.18;
    lastFaceAt = time;
  }

  function paintPerson(personMask) {
    const { width, height } = personMask;
    if (!maskPixels || mask.width !== width || mask.height !== height) {
      mask.width = width;
      mask.height = height;
      maskPixels = maskContext.createImageData(width, height);
    }
    const confidence = personMask.getAsFloat32Array();
    const alpha = maskPixels.data;
    for (let y = 0; y < height; y++) {
      const hem = Math.min(1, (height - y - 1) / (height * 0.07));
      const end = (y + 1) * width;
      for (let i = y * width; i < end; i++) {
        const opacity = Math.max(0, Math.min(1, (confidence[i] - 0.39) / 0.47));
        alpha[i * 4 + 3] = opacity * opacity * (3 - 2 * opacity) * hem * 255;
      }
    }
    maskContext.putImageData(maskPixels, 0, 0);
    cropContext.save();
    cropContext.globalCompositeOperation = "destination-in";
    cropContext.drawImage(mask, 0, 0, crop.width, crop.height);
    cropContext.globalCompositeOperation = "source-atop";
    cropContext.fillStyle = "#82b0f022";
    cropContext.fillRect(0, 0, crop.width, crop.height);
    cropContext.restore();

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.clip(glass);
    const pictureWidth = canvas.width * 0.60;
    const pictureHeight = pictureWidth * crop.height / crop.width;
    context.save();
    context.translate(canvas.width * 0.35 + pictureWidth, canvas.height * 0.035);
    context.scale(-1, 1);
    context.drawImage(crop, 0, 0, pictureWidth, pictureHeight);
    context.restore();
    context.fillStyle = reflection;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
  }

  function render(time, models) {
    if (time - lastFrameAt < 64) return;
    lastFrameAt = time;
    if (time - lastDetectionAt >= 120) {
      lastDetectionAt = time;
      findFace(models.detector, time);
    }
    if (!cropBounds || time - lastFaceAt > 1500) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      setStatus("framing", "얼굴을 찾으면 창문에 자동으로 크게 보여 드려요.");
      return;
    }

    const { x, y, width, height } = cropBounds;
    cropContext.clearRect(0, 0, crop.width, crop.height);
    cropContext.drawImage(video, x, y, width, height, 0, 0, crop.width, crop.height);
    models.segmenter.segmentForVideo(crop, time, ({ confidenceMasks }) => {
      // The landscape model can return just the person channel in this SDK.
      paintPerson(confidenceMasks[1] ?? confidenceMasks[0]);
    });
    setStatus("live", "웹캠 연결됨");
  }

  function disableWindow(message) {
    windowVisible = false;
    cropBounds = null;
    context.clearRect(0, 0, canvas.width, canvas.height);
    setStatus("window-error", message);
  }

  async function prepareWindow(id) {
    if (windowModels) return;
    setStatus("loading", "웹캠 영상에서 사람을 분리할 준비를 하고 있어요.");
    modelsPromise ??= loadWindowModels().catch((error) => {
      modelsPromise = null;
      throw error;
    });
    try {
      windowModels = await modelsPromise;
    } catch (error) {
      if (id !== requestId || !windowVisible) return;
      console.warn("Window camera could not load the composite models.", error);
      disableWindow("창문 합성을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.");
    }
  }

  async function start(visible = true) {
    const changed = windowVisible !== visible;
    windowVisible = visible;
    if (!visible) {
      cropBounds = null;
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (requested) {
      if (changed && video.readyState >= 2) {
        if (windowVisible) prepareWindow(requestId);
        else setStatus("live", "웹캠 연결됨");
      }
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error", "Chrome이나 Edge에서 로컬 미리보기 주소로 열어 주세요.");
      return;
    }
    const id = ++requestId;
    requested = true;
    setStatus("permission", "웹캠 사용 권한을 허용해 주세요.");
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (id !== requestId) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = acquired;
      acquired.getVideoTracks()[0].addEventListener("ended", () => {
        if (stream === acquired) stop("error", "웹캠 연결이 끊어졌어요. 다시 켜 주세요.");
      });
      video.srcObject = acquired;
      await video.play();
      if (id !== requestId) return;
      analysis.width = 640;
      analysis.height = Math.max(1, Math.round(analysis.width * video.videoHeight / video.videoWidth));
      lastFaceAt = lastDetectionAt = lastFrameAt = -Infinity;
      lastVideoTime = -1;
      if (windowVisible) prepareWindow(id);
      else setStatus("live", "웹캠 연결됨");

      function update(time) {
        if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          onFrame(video, time);
          if (id !== requestId) return;
          if (windowVisible && windowModels) {
            try {
              render(time, windowModels);
            } catch (error) {
              console.warn("Window camera could not render the current frame.", error);
              disableWindow("창문 합성을 다시 시작해 주세요.");
            }
          }
        }
        frame = requestAnimationFrame(update);
      }
      frame = requestAnimationFrame(update);
    } catch (error) {
      if (id !== requestId) return;
      const messages = {
        NotAllowedError: "웹캠 권한을 허용한 뒤 다시 켜 주세요.",
        NotFoundError: "연결된 웹캠을 찾을 수 없어요.",
        NotReadableError: "다른 앱에서 웹캠을 사용 중인지 확인해 주세요.",
      };
      stop("error", messages[error.name] ?? "웹캠을 시작하지 못했어요. 다시 켜 주세요.");
    }
  }

  return { start, stop };
}
