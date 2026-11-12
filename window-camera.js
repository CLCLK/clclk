const VISION_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18";
const MEDIAPIPE_MODELS = "https://storage.googleapis.com/mediapipe-models";

async function loadWindowModels() {
  const { FaceDetector, FilesetResolver, ImageSegmenter } = await import(`${VISION_CDN}/vision_bundle.mjs`);
  const files = await FilesetResolver.forVisionTasks(`${VISION_CDN}/wasm`);
  const detector = await FaceDetector.createFromOptions(files, {
    baseOptions: { modelAssetPath: `${MEDIAPIPE_MODELS}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite` },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.5,
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

function createWindowCamera(canvas, showStatus) {
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
    context.clearRect(0, 0, canvas.width, canvas.height);
    cropBounds = null;
    setStatus(next, message);
  }

  function findFace(detector, time) {
    analysisContext.drawImage(video, 0, 0, analysis.width, analysis.height);
    let face;
    for (const detection of detector.detectForVideo(analysis, time).detections) {
      const box = detection.boundingBox;
      if (box && (!face || box.width * box.height > face.width * face.height)) face = box;
    }
    if (!face) return;

    const scaleX = video.videoWidth / analysis.width;
    const scaleY = video.videoHeight / analysis.height;
    const faceHeight = face.height * scaleY;
    const ratio = crop.width / crop.height;
    const height = Math.min(video.videoHeight, video.videoWidth / ratio,
      Math.max(faceHeight * 2.35, video.videoHeight * 0.47));
    const width = height * ratio;
    const next = {
      x: Math.max(0, Math.min(video.videoWidth - width, (face.originX + face.width / 2) * scaleX - width / 2)),
      y: Math.max(0, Math.min(video.videoHeight - height, face.originY * scaleY - faceHeight * 0.56)),
      width,
      height,
    };
    if (!cropBounds || time - lastFaceAt > 550) cropBounds = next;
    else for (const key of Object.keys(next)) cropBounds[key] += (next[key] - cropBounds[key]) * 0.28;
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
    const pictureWidth = canvas.width * 0.63;
    const pictureHeight = pictureWidth * crop.height / crop.width;
    context.save();
    context.translate(canvas.width * 0.245 + pictureWidth, canvas.height * 0.023);
    context.scale(-1, 1);
    context.drawImage(crop, 0, 0, pictureWidth, pictureHeight);
    context.restore();
    context.fillStyle = reflection;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
  }

  function render(time, models) {
    if (video.readyState < 2 || time - lastFrameAt < 64 || video.currentTime === lastVideoTime) return;
    lastFrameAt = time;
    lastVideoTime = video.currentTime;
    if (time - lastDetectionAt >= 120) {
      lastDetectionAt = time;
      findFace(models.detector, time);
    }
    if (!cropBounds || time - lastFaceAt > 550) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      setStatus("framing", "카메라를 보고 얼굴과 어깨를 가운데 맞춰 주세요.");
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

  async function start() {
    if (requested) return;
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
      setStatus("loading", "웹캠 영상에서 사람을 분리할 준비를 하고 있어요.");
      modelsPromise ??= loadWindowModels().catch((error) => {
        modelsPromise = null;
        throw error;
      });
      const models = await modelsPromise;
      if (id !== requestId) return;
      analysis.width = 384;
      analysis.height = Math.max(1, Math.round(analysis.width * video.videoHeight / video.videoWidth));
      lastFaceAt = lastDetectionAt = lastFrameAt = -Infinity;
      lastVideoTime = -1;

      function update(time) {
        try {
          render(time, models);
          frame = requestAnimationFrame(update);
        } catch (error) {
          console.warn("Window camera could not render the current frame.", error);
          stop("error", "얼굴 합성을 다시 시작해 주세요.");
        }
      }
      frame = requestAnimationFrame(update);
    } catch (error) {
      if (id !== requestId) return;
      const messages = {
        NotAllowedError: "웹캠 권한을 허용한 뒤 다시 켜 주세요.",
        NotFoundError: "연결된 웹캠을 찾을 수 없어요.",
        NotReadableError: "다른 앱에서 웹캠을 사용 중인지 확인해 주세요.",
      };
      stop("error", messages[error.name] ?? "합성 모델을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 켜 주세요.");
    }
  }

  return { start, stop };
}
