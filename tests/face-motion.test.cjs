const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const source = readFileSync(join(__dirname, "..", "face-motion.js"), "utf8");
function runtime(extra = {}) {
  const context = vm.createContext({ console, document: { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) }, ...extra });
  vm.runInContext(source, context);
  return context;
}
const context = runtime();
const wide = { mouthRatio: 0.5, faceRatio: 0.2 };
const closed = { mouthRatio: 0.08, faceRatio: 0.03 };

function play(input, duration = 6500) {
  let time = 0;
  const hits = [];
  const tracker = context.createNoiseTracker(() => hits.push(time));
  for (; time <= duration; time += 100) tracker.observe(input(time), time);
  return hits;
}

test("closed, slightly open, and brief mouth openings do not trigger", () => {
  assert.deepEqual(play(() => closed), []);
  assert.deepEqual(play(() => ({ mouthRatio: 0.25, faceRatio: 0.08 })), []);
  assert.deepEqual(play((t) => t < 1800 ? wide : closed), []);
  assert.deepEqual(play(() => null), []);
});

test("two seconds triggers once per interval and automatically recognizes again", () => {
  assert.deepEqual(play(() => wide), [2000, 4000, 6000]);
  assert.deepEqual(play((t) => t < 2200 ? wide : closed), [2000]);
  assert.deepEqual(play((t) => t < 200 ? wide : { mouthRatio: 0.3, faceRatio: 0.1 }), [2000, 4000, 6000]);
});

test("brief gaps retain progress without credit; long gaps and tab suspension reset", () => {
  const hits = play((t) => t >= 800 && t < 1000 ? null : wide);
  assert.equal(hits[0], 2300);
  assert.deepEqual(play((t) => t < 1500 || t >= 2000 && t < 3500 ? wide : null), []);
  const tracker = context.createNoiseTracker(() => assert.fail("A suspended tab must not complete an attack"));
  tracker.observe(wide, 0);
  tracker.observe(wide, 5000);
  assert.equal(tracker.progress().seconds, 0);
  tracker.reset();
  assert.equal(tracker.progress().active, false);
});

function faceResult(height = 0.1, width = 0.2, scale = 1, angle = 0, aspect = 16 / 9) {
  const points = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
  for (const [index, x, y] of [[13, 0, -height / 2], [14, 0, height / 2], [61, -width / 2, 0], [291, width / 2, 0], [33, -0.2, -0.2], [263, 0.2, -0.2]]) {
    points[index] = { x: (0.7 + scale * (x * Math.cos(angle) - y * Math.sin(angle))) / aspect,
      y: 0.5 + scale * (x * Math.sin(angle) + y * Math.cos(angle)) };
  }
  return { faceLandmarks: [points] };
}

test("mouth ratios are stable across distance, rotation and aspect; small pursed lips are excluded", () => {
  for (const aspect of [1, 16 / 9, 9 / 16]) {
    const opening = context.readMouthOpening(faceResult(0.1, 0.2, 0.6, 0.3, aspect), aspect);
    assert.ok(Math.abs(opening.mouthRatio - 0.5) < 0.001);
    assert.ok(Math.abs(opening.faceRatio - 0.25) < 0.001);
  }
  assert.deepEqual(play(() => context.readMouthOpening(faceResult(0.03, 0.07), 16 / 9)), []);
  assert.equal(context.readMouthOpening({ faceLandmarks: [] }, 1), null);
  const invalid = faceResult();
  invalid.faceLandmarks[0][13].x = NaN;
  assert.equal(context.readMouthOpening(invalid, 1), null);
});

test("one face model is reused and only gameplay scores; replay resets progress", async () => {
  let loads = 0, reads = 0;
  const hits = [], statuses = [];
  const app = runtime({ MEDIAPIPE_MODELS: "test", loadVisionRuntime: async () => ({ files: {}, FaceLandmarker: {
    createFromOptions: async (files, options) => {
      assert.equal(options.numFaces, 1);
      loads++;
      return { detectForVideo: () => { reads++; return faceResult(); } };
    },
  } }) });
  const face = app.createFaceMotion((id) => hits.push(id), () => assert.fail("Model failure"), (message) => statuses.push(message));
  const video = { videoWidth: 1280, videoHeight: 720 };
  face.update(video, 0, false);
  await new Promise(setImmediate);
  for (let time = 100; time < 3000; time += 50) face.update(video, time, false);
  assert.equal(reads, 0);
  for (let time = 3000; time <= 5200; time += 50) face.update(video, time, true);
  assert.deepEqual(hits, ["noise"]);
  assert.ok(reads <= 23);
  face.reset();
  for (let time = 5300; time < 7200; time += 100) face.update(video, time, true);
  assert.deepEqual(hits, ["noise"]);
  assert.equal(loads, 1);
  assert.ok(statuses.some((message) => message.includes("소음 내기") && message.includes("2.0초")));
});

test("model failure reports once and permits a retry on a new round", async () => {
  let failures = 0;
  const app = runtime({ loadVisionRuntime: async () => { throw new Error("Test model failure"); }, console: { warn() {} } });
  const face = app.createFaceMotion(() => assert.fail(), () => failures++);
  face.update({}, 0, false);
  await new Promise(setImmediate);
  face.update({}, 100, true);
  assert.equal(failures, 1);
  face.reset();
  face.update({}, 200, false);
  await new Promise(setImmediate);
  assert.equal(failures, 2);
});
