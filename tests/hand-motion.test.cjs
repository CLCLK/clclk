const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

function runtime(extra = {}) {
  const context = vm.createContext({ console, ...extra });
  for (const file of ["shake-motion.js", "tickle-motion.js", "wind-motion.js", "hand-motion.js"]) {
    vm.runInContext(readFileSync(join(__dirname, "..", file), "utf8"), context);
  }
  return context;
}

const context = runtime();

function windResult(gap = 0.12, poses = ["open", "open"], scale = 1, aspect = 16 / 9) {
  const result = resultFor(poses);
  result.landmarks = result.worldLandmarks.map((points, hand) => points.map(({ x, y, z }) => ({
    x: (0.5 + (x + hand * gap) * scale) / aspect, y: 0.4 + y * scale, z,
  })));
  result.gestures = poses.map(() => []);
  return result;
}

test("wind requires two open palms without distance restrictions regardless of image scale or hand order", () => {
  for (const scale of [0.5, 1, 2]) for (const aspect of [1, 16 / 9, 9 / 16]) {
    const result = windResult(0.12, ["open", "open"], scale, aspect);
    assert.equal(context.readWindPose(result, aspect), "ready");
    for (const value of Object.values(result)) value.reverse();
    assert.equal(context.readWindPose(result, aspect), "ready");
  }
  assert.equal(context.readWindPose(windResult(0.4), 16 / 9), "ready");
  assert.equal(context.readWindPose(windResult(0), 16 / 9), "ready");
  assert.equal(context.readWindPose(windResult(0.12, ["curled", "curled"]), 16 / 9), "closed");
  assert.equal(context.readWindPose(windResult(0.12, ["straight", "straight"]), 16 / 9), "closed");
  assert.equal(context.readWindPose(windResult(0.12, ["open"]), 16 / 9), "missing");
  const edge = windResult();
  edge.landmarks.forEach((points) => points.forEach((point) => point.x *= 0.1));
  assert.equal(context.readWindPose(edge, 16 / 9), "ready");
});

test("wind needs 1.5 valid seconds, repeats at 1.5-second intervals, and tolerates only brief gaps", () => {
  function run(input, duration = 6500) {
    let time = 0;
    const hits = [];
    const tracker = context.createWindTracker(() => hits.push(time));
    for (; time <= duration; time += 100) tracker.observe(input(time), time);
    return hits;
  }
  assert.deepEqual(run(() => true), [1500, 3000, 4500, 6000]);
  assert.deepEqual(run((t) => t < 1400), []);
  assert.equal(run((t) => t < 700 || t >= 1000)[0], 1900);
  assert.equal(run((t) => t < 700 || t >= 1700)[0], 3200);
  const tracker = context.createWindTracker(() => assert.fail("Lost camera time must not count"));
  tracker.observe(true, 0); tracker.observe(true, 7000);
  assert.equal(tracker.progress().seconds, 0);
  tracker.reset(); assert.equal(tracker.progress().active, false);
});

test("shared hand model routes the palm hold only to wind and resets on replay", async () => {
  const hits = [], statuses = [];
  let loads = 0;
  const shared = runtime({ MEDIAPIPE_MODELS: "test", loadVisionRuntime: async () => ({ files: {}, GestureRecognizer: {
    createFromOptions: async () => { loads++; return { recognizeForVideo: () => windResult() }; },
  } }) });
  const motion = shared.createHandMotion((id) => hits.push(id), () => assert.fail(), (message) => statuses.push(message));
  const video = { videoWidth: 1280, videoHeight: 720 };
  motion.update(video, 0, false); await new Promise(setImmediate);
  for (let time = 100; time <= 6000; time += 100) motion.update(video, time, false);
  assert.deepEqual(hits, []);
  for (let time = 6100; time <= 9200; time += 100) motion.update(video, time, true);
  assert.deepEqual(hits, ["wind", "wind"]);
  motion.reset();
  for (let time = 9300; time <= 10600; time += 100) motion.update(video, time, true);
  assert.deepEqual(hits, ["wind", "wind"]);
  assert.equal(loads, 1);
  assert.ok(statuses.some((message) => message.includes("바람 쏘기") && message.includes("/ 1.5초")));
});
const samples = (left, right) => [left, right].map((pose, id) => ({
  id, curl: typeof pose === "number" ? pose : pose === "straight" ? 0 : 0.7,
  indexOut: typeof pose === "number" ? pose < 0.3 : pose === "straight",
}));
const wave = (time, offset = 0) => (time + offset) % 600 < 300 ? "straight" : "curled";
const both = (time) => samples(wave(time), wave(time, 100));

function play(input, duration = 6000) {
  const hits = [];
  let time = 0;
  const tracker = context.createTickleTracker(() => hits.push(time));
  for (; time <= duration; time += 50) tracker.observe(input(time), time);
  return hits;
}

function spacedHits(hits, minimum, count = 2) {
  assert.ok(hits.length >= count, JSON.stringify(hits));
  assert.ok(hits[0] >= minimum, JSON.stringify(hits));
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i] - hits[i - 1] >= minimum, JSON.stringify(hits));
}

test("both index fingers must move for two seconds; continuous movement automatically starts the next interval", () => {
  const hits = play(both);
  spacedHits(hits, 2000);
  assert.ok(hits[0] >= 2300);
  assert.deepEqual(play(() => samples("straight", "straight")), []);
  assert.deepEqual(play(() => samples("curled", "curled")), []);
  assert.deepEqual(play((t) => samples(wave(t), "straight")), []);
  assert.deepEqual(play((t) => t < 1800 ? both(t) : samples("straight", "straight")), []);
  assert.deepEqual(play((t) => samples(wave(t), t < 1000 ? wave(t) : "straight")), []);
});

test("brief loss is tolerated, sustained loss breaks the two-second sequence", () => {
  spacedHits(play((t) => t >= 1300 && t < 1400 ? null : both(t)), 2000);
  spacedHits(play((t) => t >= 1300 && t < 1750 ? null : both(t)), 2000);
  assert.deepEqual(play((t) => t < 1500 || t >= 2300 && t < 3800 ? both(t) : null), []);
});

test("a pause restarts progress; short loss cannot create rapid duplicate hits", () => {
  const hits = play((t) => t < 3500 ? both(t) : t < 5100 ? samples("straight", "straight") : both(t - 5100), 9000);
  assert.equal(hits.length, 2);
  assert.ok(hits[1] >= 7100);
  spacedHits(play((t) => t >= 3000 && t < 3350 ? null : both(t), 7500), 2000);
});

// Synthetic joints let us test shape rules without a camera or a model download.
function resultFor(poses, scale = 1, shift = 0) {
  const worldLandmarks = poses.map((pose) => {
    const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0.09, z: 0 }));
    for (const [finger, base] of [5, 9, 13, 17].entries()) {
      const x = (finger - 1.5) * 0.025;
      const straight = pose === "open" || base === 5 && pose === "straight";
      points[base] = { x, y: 0.04, z: 0 };
      points[base + 1] = { x, y: 0.01, z: 0 };
      points[base + 2] = { x, y: straight ? -0.015 : 0.025, z: straight ? 0 : -0.02 };
      points[base + 3] = { x, y: straight ? -0.04 : 0.05, z: straight ? 0 : -0.025 };
    }
    return points;
  });
  return {
    worldLandmarks,
    landmarks: worldLandmarks.map((points, index) => points.map(({ x, y, z }) => ({ x: x * scale + 0.3 + index * 0.4 + shift, y: y * scale + 0.4, z: z * scale }))),
    handedness: poses.map((_, index) => [{ categoryName: index ? "Right" : "Left", score: 0.99 }]),
    gestures: poses.map(() => [{ categoryName: "Closed_Fist", score: 0.99 }]),
  };
}

test("joint geometry recognizes curling, rejects open palms, and survives hand ordering and translation", () => {
  const result = resultFor(["straight", "curled"]);
  const read = (value) => JSON.parse(JSON.stringify(context.readTickleHands(value, 16 / 9)));
  const expected = read(result);
  assert.ok(expected[0].curl < 0.05 && expected[0].indexOut);
  assert.ok(expected[1].curl > 0.6 && !expected[1].indexOut);
  assert.equal(read(resultFor(["straight", "open"])), null);
  assert.equal(read(resultFor(["straight"])), null);
  const uncertain = resultFor(["straight", "curled"]);
  uncertain.handedness[1][0].score = 0.3;
  assert.deepEqual(read(uncertain), expected);
  uncertain.handedness[1][0].categoryName = "Left";
  assert.deepEqual(read(uncertain), expected);
  for (const value of Object.values(result)) value.reverse();
  assert.deepEqual(read(result), expected);
  assert.deepEqual(read(resultFor(["straight", "curled"], 1.5, 0.1)), expected);
  const noWorld = resultFor(["straight", "curled"]);
  delete noWorld.worldLandmarks;
  assert.ok(read(noWorld)[0].curl < 0.05 && read(noWorld)[1].curl > 0.6);
});

test("partial bends work, but small landmark jitter and stationary pointing do not", () => {
  const partial = (t, offset) => (t + offset) % 800 < 400 ? 0.18 : 0.41;
  spacedHits(play((t) => samples(partial(t, 0), partial(t, 150))), 2000);
  assert.deepEqual(play((t) => samples(0.18 + Math.sin(t) * 0.03, 0.18 + Math.cos(t) * 0.03)), []);
  const tracker = context.createTickleTracker(() => assert.fail("Static pointing"));
  tracker.observe(samples("straight", "straight"), 0);
  assert.equal(tracker.isActive(), false);
});

function playShake(input, duration = 6500) {
  const hits = [];
  let time = 0;
  const tracker = context.createShakeTracker(() => hits.push(time));
  for (; time <= duration; time += 50) tracker.observe(input(time), time);
  return hits;
}

test("smaller punches and wrist return paths work, but one hand and static jitter do not", () => {
  const bump = (t, shift = 0) => Math.max(0, 1 - Math.abs((t + shift) % 800 - 250) / 220);
  const punches = (t) => [1 + 0.1 * bump(t), 1 + 0.1 * bump(t, 200)];
  spacedHits(playShake(punches), 1000);
  spacedHits(playShake((t) => t >= 1300 && t < 1750 ? null : punches(t)), 1000);
  assert.deepEqual(playShake((t) => [1 + 0.1 * bump(t), 1]), []);
  assert.deepEqual(playShake((t) => t < 800 ? punches(t) : [1, 1]), []);
  assert.deepEqual(playShake((t) => [1 + Math.min(t, 2000) / 10000, 1 + Math.min(t, 2000) / 10000]), []);
  assert.deepEqual(playShake((t) => [1 + Math.sin(t) * 0.01, 1 + Math.cos(t) * 0.01]), []);
  spacedHits(playShake((t) => [0, 200].map((shift, i) => ({ size: 0.1, x: i * 0.4, y: bump(t, shift) * 0.035 }))), 1000);
  // 왕복 중심이 조금씩 앞으로 이동해도 원점 복귀를 기다리며 멈추지 않아야 합니다.
  spacedHits(playShake((t) => [0, 200].map((shift, i) => ({ size: 0.1, x: i * 0.4, y: 0.000004 * t + bump(t, shift) * 0.035 }))), 1000);
  const afterPause = playShake((t) => t < 3500 ? punches(t) : t < 5100 ? [1, 1] : punches(t - 5100), 9000);
  spacedHits(afterPause, 1000);
  assert.ok(afterPause.some((t) => t > 6100));
});

test("joint geometry accepts a fist when the gesture label is uncertain and rejects open hands", () => {
  const result = resultFor(["curled", "curled"]);
  result.gestures = [[], []];
  assert.equal(context.readFistSamples(result, 16 / 9).length, 2);
  const open = resultFor(["open", "open"]);
  open.gestures = [[], []];
  assert.equal(context.readFistSamples(open, 16 / 9), null);
});

test("shared model repeats qualified gestures, excludes shake during tickle, and resets for replay", async () => {
  let frame;
  let loads = 0;
  const hits = [];
  const statuses = [];
  const shared = runtime({
    MEDIAPIPE_MODELS: "test",
    loadVisionRuntime: async () => ({ files: {}, GestureRecognizer: {
      createFromOptions: async () => {
        loads++;
        return { recognizeForVideo: () => frame };
      },
    } }),
  });
  const motion = shared.createHandMotion((id) => hits.push(id), () => assert.fail("Model failure"), (message) => statuses.push(message));
  const video = { videoWidth: 1280, videoHeight: 720 };
  motion.update(video, 0, false);
  await new Promise(setImmediate);
  const pulse = (t) => 1 + 0.45 * Math.max(0, 1 - Math.abs(t % 640 - 160) / 150);
  for (let t = 0; t < 5000; t += 50) {
    frame = resultFor([wave(t), wave(t, 100)], pulse(t));
    motion.update(video, t, false);
  }
  assert.deepEqual(hits, []);
  motion.reset();
  for (let t = 5000; t < 10000; t += 50) {
    frame = resultFor([wave(t), wave(t, 100)], pulse(t));
    motion.update(video, t, true);
  }
  assert.ok(hits.length >= 2 && hits.every((id) => id === "tickle"));
  const tickleCount = hits.length;
  motion.reset();
  for (let t = 10000; t < 15000; t += 50) {
    frame = resultFor(["curled", "curled"], pulse(t));
    motion.update(video, t, true);
  }
  assert.ok(hits.length > tickleCount + 1 && hits.slice(tickleCount).every((id) => id === "shake"));
  assert.equal(loads, 1);
  assert.ok(statuses.some((message) => message.includes("간지럽히기") && message.includes("/ 2.0초")));
  assert.ok(statuses.some((message) => message.includes("흔들기") && message.includes("/ 1.0초")));
  frame = { landmarks: [] };
  motion.update(video, 16000, true);
  assert.ok(statuses.at(-1).includes("손 0/2개"));
});
