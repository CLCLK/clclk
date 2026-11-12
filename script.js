const ROUND_SECONDS = 60;
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
const cameraPreview = byId("camera-preview");
const startPreview = byId("start-preview");
const countdownOverlay = byId("countdown-overlay");
const feedback = byId("feedback");
const sleepFace = byId("sleep-face");
const roomEffects = createRoomEffects(byId("room-effects"));
const attackButtons = new Map();
const motionInput = createMotionInput(applyMotion);

let phase = "ready";
let sleep = MAX_SLEEP;
let roundStartsAt = 0;
let timer;
let attackTimer;
let activeButton;
let soundOn = true;
let audioContext;
let soundVolume;

for (const gesture of gestures) {
  const icon = document.createElement("span");
  icon.className = "gesture-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = gesture.icon;

  const guide = document.createElement("li");
  const illustration = document.createElement("div");
  illustration.className = `gesture-art gesture-art-${gesture.id}`;
  illustration.setAttribute("aria-hidden", "true");
  const label = document.createElement("h3");
  label.textContent = gesture.label;
  const instruction = document.createElement("p");
  instruction.textContent = gesture.instruction;
  guide.append(illustration, label, instruction);
  byId("gesture-guide").append(guide);

  const button = document.createElement("button");
  button.type = "button";
  button.append(icon.cloneNode(true), gesture.label);
  button.addEventListener("click", () => motionInput.emit(gesture.id));
  byId("test-buttons").append(button);
  attackButtons.set(gesture.id, button);
}

function setAttackButtonsEnabled(enabled) {
  for (const button of attackButtons.values()) button.disabled = !enabled;
}

function showTime(elapsed) {
  const gameMinutes = START_HOUR * 60 + elapsed;
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
  clearInterval(timer);
  clearAttack();
  sleep = MAX_SLEEP;
  phase = "countdown";
  roundStartsAt = performance.now() + COUNTDOWN_SECONDS * 1000;
  showTime(0);
  showSleep();
  setAttackButtonsEnabled(false);
  feedback.textContent = "카운트다운이 끝나면 버튼을 눌러 주세요.";
  startScreen.hidden = true;
  hideResult();
  playScreen.hidden = false;
  document.body.classList.remove("on-start");
  document.body.classList.add("in-game");
  cameraPreview.hidden = !cameraToggle.checked;
  gameRoom.classList.toggle("camera-example", cameraToggle.checked);
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

  const elapsed = Math.min(ROUND_SECONDS, Math.floor(milliseconds / 1000));
  showTime(elapsed);
  if (elapsed === ROUND_SECONDS) {
    finishRound(false);
    return;
  }

  if (phase === "countdown") {
    phase = "playing";
    countdownOverlay.hidden = true;
    setAttackButtonsEnabled(true);
    feedback.textContent = "공격 버튼을 눌러 깨워 주세요.";
  }
}

function applyMotion(gesture) {
  if (phase !== "playing") return;
  updateTimer();
  if (phase !== "playing") return;

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
  let duration = 640;
  if (gestureId === "shake") {
    // 같은 버튼을 빠르게 다시 눌러도 흔들림을 처음부터 재생합니다.
    void gameRoom.offsetWidth;
    gameRoom.classList.add("is-shaking");
    playShakeSound();
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

function playShakeSound() {
  if (!soundOn || !window.AudioContext) return;
  if (!audioContext) {
    audioContext = new AudioContext();
    soundVolume = audioContext.createGain();
    soundVolume.connect(audioContext.destination);
  }
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  const tone = audioContext.createOscillator();
  const volume = audioContext.createGain();
  const now = audioContext.currentTime;
  tone.type = "triangle";
  tone.frequency.setValueAtTime(110, now);
  tone.frequency.exponentialRampToValueAtTime(48, now + 0.38);
  volume.gain.setValueAtTime(0.12, now);
  volume.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  tone.connect(volume).connect(soundVolume);
  tone.start(now);
  tone.stop(now + 0.4);
}

function finishRound(won) {
  clearInterval(timer);
  clearAttack();
  phase = "result";
  setAttackButtonsEnabled(false);
  countdownOverlay.hidden = true;
  feedback.textContent = "";
  gameRoom.classList.add(won ? "round-won" : "round-lost");
  const title = byId("result-title");
  title.textContent = won ? "기상 성공!" : "무단 결근!";
  byId("result-message").textContent = won ? "오늘도 출근할게요" : "이번 달은 …";
  resultScreen.hidden = false;
  title.focus({ preventScroll: true });
}

function hideResult() {
  resultScreen.hidden = true;
  gameRoom.classList.remove("round-won", "round-lost");
}

cameraToggle.addEventListener("change", () => {
  byId("camera-setting-state").textContent = cameraToggle.checked ? "ON" : "OFF";
});
byId("start-button").addEventListener("click", startRound);
byId("preview-button").addEventListener("click", () => startPreview.showModal());
byId("replay-button").addEventListener("click", startRound);
byId("sound-button").addEventListener("click", (event) => {
  soundOn = !soundOn;
  if (soundVolume) soundVolume.gain.value = soundOn ? 1 : 0;
  event.currentTarget.setAttribute("aria-pressed", String(soundOn));
  byId("sound-state").textContent = soundOn ? "ON" : "OFF";
});
byId("restart-button").addEventListener("click", () => {
  phase = "ready";
  hideResult();
  playScreen.hidden = true;
  startScreen.hidden = false;
  document.body.classList.remove("in-game");
  document.body.classList.add("on-start");
  byId("start-button").focus();
});
