const ROUND_SECONDS = 30;
const COUNTDOWN_SECONDS = 3;
const MAX_SLEEP = 100;
const SLEEP_PER_MOTION = 10;
const START_HOUR = 7;

const byId = (id) => document.getElementById(id);
const startScreen = byId("start-screen");
const playScreen = byId("play-screen");
const gameRoom = byId("game-room");
const resultScreen = byId("result-screen");
const cameraToggle = byId("camera-toggle");
const startPreview = byId("start-preview");
const cameraCanvas = byId("window-camera");
const startCameraStatus = byId("start-camera-status");
const gameCameraStatus = byId("game-camera-status");
const windowCamera = createWindowCamera(cameraCanvas, (state, message) => {
  startCameraStatus.textContent = message;
  startCameraStatus.hidden = !message;
  byId("preview-camera-status").textContent = message;
  gameCameraStatus.textContent = message;
  gameCameraStatus.hidden = !message || state === "live";
  if (state === "error") {
    cameraToggle.checked = false;
    byId("camera-setting-state").textContent = "OFF";
  }
}, (video, time) => {
  if (phase === "countdown" || phase === "playing") {
    handMotion.update(video, time, phase === "playing");
    faceMotion.update(video, time, phase === "playing");
  }
});
const countdownOverlay = byId("countdown-overlay");
const feedback = byId("feedback");
const repeatPopup = byId("repeat-popup");
const sleepFace = byId("sleep-face");
const roomEffects = createRoomEffects(byId("room-effects"));
const attackButtons = new Map();
const motionInput = createMotionInput(applyMotion);
const handMotion = createHandMotion((gestureId) => motionInput.emit(gestureId), () => {
  handModelError = true;
  if (phase === "playing" && !activeButton) feedback.textContent = "손 인식을 시작하지 못했어요. 공격 버튼으로 플레이할 수 있어요.";
}, (message, active = false) => {
  handStatus = { message, active };
  showRecognitionFeedback();
});
const faceMotion = createFaceMotion((gestureId) => motionInput.emit(gestureId), () => {
  faceStatus = { message: "얼굴 인식을 시작하지 못했어요. 손 동작이나 공격 버튼을 사용해 주세요.", active: false };
  showRecognitionFeedback();
}, (message, active = false) => {
  faceStatus = { message, active };
  showRecognitionFeedback();
});

let phase = "ready";
let sleep = MAX_SLEEP;
let roundStartsAt = 0;
let timer;
let attackTimer;
let repeatPopupTimer;
let activeButton;
let soundOn = true;
const gameAudio = createGameAudio();
let handModelError = false;
let lastEffectiveGestureId = null;
let handStatus = { message: "", active: false };
let faceStatus = { message: "", active: false };

function showRecognitionFeedback() {
  if (phase !== "playing" || activeButton) return;
  const status = faceStatus.active ? faceStatus : handStatus.active ? handStatus
    : faceStatus.message ? faceStatus : handStatus;
  if (status.message && feedback.textContent !== status.message) feedback.textContent = status.message;
}

for (const [index, gesture] of gestures.entries()) {
  const guide = document.createElement("li");
  guide.dataset.gesture = gesture.id;
  const guideMeta = document.createElement("div");
  guideMeta.className = "gesture-meta";
  const guideNumber = document.createElement("span");
  guideNumber.textContent = `0${index + 1}`;
  guideMeta.append(guideNumber);
  const illustration = document.createElement("div");
  illustration.className = `gesture-art gesture-art-${gesture.id}`;
  illustration.setAttribute("aria-hidden", "true");
  const label = document.createElement("h3");
  label.textContent = gesture.label;
  const instruction = document.createElement("p");
  instruction.textContent = gesture.instruction;
  guide.append(guideMeta, illustration, label, instruction);
  byId("gesture-guide").append(guide);

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.gesture = gesture.id;
  button.dataset.duration = gesture.duration;
  const buttonLabel = document.createElement("span");
  buttonLabel.textContent = gesture.label;
  const description = document.createElement("small");
  description.className = "attack-instruction";
  description.textContent = gesture.instruction;
  buttonLabel.append(description);
  button.append(illustration.cloneNode(true), buttonLabel);
  button.addEventListener("click", () => motionInput.emit(gesture.id));
  byId("test-buttons").append(button);
  attackButtons.set(gesture.id, button);
}

function setAttackButtonsEnabled(enabled) {
  for (const button of attackButtons.values()) button.disabled = !enabled;
}

function showTime(elapsed) {
  const gameMinutes = START_HOUR * 60 + Math.floor(elapsed / ROUND_SECONDS * 60);
  const hours = String(Math.floor(gameMinutes / 60)).padStart(2, "0");
  const minutes = String(gameMinutes % 60).padStart(2, "0");
  const clock = byId("game-clock");
  const time = `${hours}:${minutes}`;
  if (clock.textContent !== time) {
    clock.textContent = time;
    clock.dateTime = time;
  }
}

function showSleep() {
  byId("sleep-meter").value = sleep;
  byId("sleep-value").textContent = `${sleep} / ${MAX_SLEEP}`;
  let expression = "deep";
  if (sleep <= 20) expression = "near-awake";
  else if (sleep <= 50) expression = "shallow";
  sleepFace.dataset.expression = expression;
}

function startRound() {
  gameAudio.stop();
  gameAudio.unlock();
  clearInterval(timer);
  hideRepeatPopup();
  clearAttack();
  handMotion.reset();
  faceMotion.reset();
  handStatus = { message: "", active: false };
  faceStatus = { message: "", active: false };
  handModelError = false;
  lastEffectiveGestureId = null;
  sleep = MAX_SLEEP;
  phase = "countdown";
  roundStartsAt = performance.now() + COUNTDOWN_SECONDS * 1000;
  showTime(0);
  showSleep();
  setAttackButtonsEnabled(false);
  feedback.textContent = "곧 시작해요. 얼굴과 양손이 카메라에 보이도록 준비해 주세요.";
  startScreen.hidden = true;
  hideResult();
  playScreen.hidden = false;
  document.body.classList.remove("on-start");
  document.body.classList.add("in-game");
  byId("game-window").append(cameraCanvas);
  windowCamera.start(cameraToggle.checked);
  countdownOverlay.hidden = false;
  playScreen.focus();
  updateTimer();
  timer = setInterval(updateTimer, 50);
}

function updateTimer() {
  // 실제 경과 시간을 읽어 탭이 잠시 멈춰도 게임 시각이 늦어지지 않습니다.
  const milliseconds = performance.now() - roundStartsAt;
  if (milliseconds < 0) {
    const remaining = String(Math.ceil(-milliseconds / 1000));
    const countdown = byId("countdown");
    if (countdown.textContent !== remaining) countdown.textContent = remaining;
    return;
  }

  const elapsed = Math.min(ROUND_SECONDS, milliseconds / 1000);
  showTime(elapsed);
  if (elapsed === ROUND_SECONDS) {
    finishRound(false);
    return;
  }

  if (phase === "countdown") {
    phase = "playing";
    gameAudio.startMusic();
    countdownOverlay.hidden = true;
    setAttackButtonsEnabled(true);
    feedback.textContent = handModelError
      ? "손 인식을 시작하지 못했어요. 공격 버튼으로 플레이할 수 있어요."
      : "흔들기·소음 1초 · 간지럽히기 2초 · 바람 쏘기 1.5초!";
  }
}

function applyMotion(gesture) {
  if (phase !== "playing") return;
  updateTimer();
  if (phase !== "playing") return;

  if (gesture.id === lastEffectiveGestureId) {
    showRepeatPopup();
    return;
  }
  hideRepeatPopup();
  lastEffectiveGestureId = gesture.id;
  sleep = Math.max(0, sleep - SLEEP_PER_MOTION);
  showSleep();
  feedback.textContent = `${gesture.label}! 졸음 −${SLEEP_PER_MOTION}`;
  showAttack(gesture.id);
  if (sleep === 0) {
    clearInterval(timer);
    phase = "finishing";
    setAttackButtonsEnabled(false);
  }
}

function showRepeatPopup() {
  // 빠르게 여러 번 눌러도 한 팝업의 노출 시간을 계속 늘리지 않습니다.
  if (!repeatPopup.hidden) return;
  repeatPopup.hidden = false;
  repeatPopupTimer = setTimeout(hideRepeatPopup, 1000);
}

function hideRepeatPopup() {
  clearTimeout(repeatPopupTimer);
  repeatPopup.hidden = true;
}

function clearAttack() {
  clearTimeout(attackTimer);
  activeButton?.classList.remove("is-active");
  activeButton = null;
  gameRoom.classList.remove("is-shaking", "is-tickled");
  roomEffects.clear();
}

function showAttack(gestureId) {
  clearAttack();
  activeButton = attackButtons.get(gestureId);
  activeButton.classList.add("is-active");
  gameAudio.play(gestureId);
  let duration = 640;
  if (gestureId === "shake") {
    // 다른 공격에서 넘어와도 흔들림 애니메이션을 처음부터 재생합니다.
    void gameRoom.offsetWidth;
    gameRoom.classList.add("is-shaking");
    duration = 940;
  } else if (gestureId === "tickle") {
    void gameRoom.offsetWidth;
    gameRoom.classList.add("is-tickled");
    duration = 1200;
  } else {
    duration = gestureId === "wind" ? 1500 : 1200;
    roomEffects.play(gestureId, duration);
  }
  attackTimer = setTimeout(() => {
    clearAttack();
    if (phase === "finishing") finishRound(true);
  }, duration);
}

function finishRound(won) {
  gameAudio.stop();
  gameAudio.play(won ? "win" : "lose");
  clearInterval(timer);
  hideRepeatPopup();
  clearAttack();
  phase = "result";
  setAttackButtonsEnabled(false);
  countdownOverlay.hidden = true;
  feedback.textContent = "";
  gameRoom.classList.add(won ? "round-won" : "round-lost");
  const title = byId("result-title");
  title.textContent = won ? "기상 성공!" : "무단 결근!";
  byId("result-stamp").textContent = won ? "✦" : "Zz";
  byId("result-eyebrow").textContent = won ? "오늘의 기상 미션 완료" : "앗, 벌써 오전 8시";
  byId("result-message").textContent = won ? "오늘도 출근할게요" : "오늘은 못가겠어요~";
  resultScreen.hidden = false;
  title.focus({ preventScroll: true });
}

function hideResult() {
  resultScreen.hidden = true;
  gameRoom.classList.remove("round-won", "round-lost");
}

cameraToggle.addEventListener("change", () => {
  byId("camera-setting-state").textContent = cameraToggle.checked ? "ON" : "OFF";
  windowCamera.start(cameraToggle.checked);
});
byId("start-button").addEventListener("click", startRound);
byId("preview-button").addEventListener("click", () => {
  byId("start-preview-room").append(cameraCanvas);
  startPreview.showModal();
  windowCamera.start();
});
startPreview.addEventListener("close", () => {
  if (phase === "ready") windowCamera.start(cameraToggle.checked);
});
window.addEventListener("pagehide", () => { windowCamera.stop(); gameAudio.stop(); });
byId("replay-button").addEventListener("click", startRound);
byId("result-replay-button").addEventListener("click", startRound);
byId("sound-button").addEventListener("click", (event) => {
  soundOn = !soundOn;
  gameAudio.setEnabled(soundOn);
  event.currentTarget.setAttribute("aria-pressed", String(soundOn));
  byId("sound-state").textContent = soundOn ? "ON" : "OFF";
});
function returnToStart() {
  gameAudio.stop();
  clearInterval(timer);
  hideRepeatPopup();
  clearAttack();
  handMotion.reset();
  faceMotion.reset();
  handStatus = { message: "", active: false };
  faceStatus = { message: "", active: false };
  phase = "ready";
  countdownOverlay.hidden = true;
  setAttackButtonsEnabled(false);
  windowCamera.start(cameraToggle.checked);
  hideResult();
  playScreen.hidden = true;
  startScreen.hidden = false;
  document.body.classList.remove("in-game");
  document.body.classList.add("on-start");
  byId("start-button").focus();
}
byId("restart-button").addEventListener("click", returnToStart);
byId("back-button").addEventListener("click", returnToStart);

// 첫 방문에는 브라우저가 권한을 묻고, 이미 허용했다면 바로 연결합니다.
cameraToggle.checked = true;
byId("camera-setting-state").textContent = "ON";
windowCamera.start();
