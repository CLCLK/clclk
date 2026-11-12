const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

function runtime(extra = {}) {
  const context = vm.createContext({ console, ...extra });
  for (const file of ["shake-motion.js", "tickle-motion.js", "hand-motion.js"]) {
    vm.runInContext(readFileSync(join(__dirname, "..", file), "utf8"), context);
  }
  return context;
}

const context = runtime();
const samples = (left, right) => [{ id: "Left", pose: left }, { id: "Right", pose: right }];
const wave = (time, offset = 0) => (time + offset) % 600 < 300 ? "straight" : "curled";
const both = (time) => samples(wave(time), wave(time, 100));

function play(input, duration = 6000) {
  const hits = [];
  let time = 0;
  const tracker = context.createTickleTracker(() => hits.push(time));
  for (; time <= duration; time += 50) tracker.observe(input(time), time);
  return hits;
}

test("both index fingers must move for at least two seconds; continuous movement fires once", () => {
  const hits = play(both);
  assert.equal(hits.length, 1);
  assert.ok(hits[0] >= 2300);
  assert.deepEqual(play(() => samples("straight", "straight")), []);
  assert.deepEqual(play(() => samples("curled", "curled")), []);
  assert.deepEqual(play((t) => samples(wave(t), "straight")), []);
  assert.deepEqual(play((t) => t < 1800 ? both(t) : samples("straight", "straight")), []);
  assert.deepEqual(play((t) => samples(wave(t), t < 1000 ? wave(t) : "straight")), []);
});

test("brief loss is tolerated, sustained loss breaks the two-second sequence", () => {
  assert.equal(play((t) => t >= 1300 && t < 1400 ? null : both(t)).length, 1);
  assert.deepEqual(play((t) => t < 1500 || t >= 2000 && t < 3500 ? both(t) : null), []);
});

test("a pause rearms; short hand loss after success does not cause another hit", () => {
  const hits = play((t) => t < 3500 ? both(t) : t < 4800 ? samples("straight", "straight") : both(t - 4800), 8500);
  assert.equal(hits.length, 2);
  assert.ok(hits[1] >= 7100);
  assert.equal(play((t) => t >= 3000 && t < 3350 ? null : both(t), 7500).length, 1);
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
  assert.deepEqual(read(result), samples("straight", "curled"));
  assert.equal(read(resultFor(["straight", "open"])), null);
  assert.equal(read(resultFor(["straight"])), null);
  const uncertain = resultFor(["straight", "curled"]);
  uncertain.handedness[1][0].score = 0.3;
  assert.equal(read(uncertain), null);
  for (const value of Object.values(result)) value.reverse();
  assert.deepEqual(read(result), samples("straight", "curled"));
  assert.deepEqual(read(resultFor(["straight", "curled"], 1.5, 0.1)), samples("straight", "curled"));
  const noWorld = resultFor(["straight", "curled"]);
  delete noWorld.worldLandmarks;
  assert.deepEqual(read(noWorld), samples("straight", "curled"));
});

test("shared model routes tickle once, excludes shake during tickle, and resets for replay", async () => {
  let frame;
  let loads = 0;
  const hits = [];
  const shared = runtime({
    MEDIAPIPE_MODELS: "test",
    loadVisionRuntime: async () => ({ files: {}, GestureRecognizer: {
      createFromOptions: async () => {
        loads++;
        return { recognizeForVideo: () => frame };
      },
    } }),
  });
  const motion = shared.createHandMotion((id) => hits.push(id), () => assert.fail("Model failure"));
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
  assert.deepEqual(hits, ["tickle"]);
  motion.reset();
  for (let t = 10000; t < 15000; t += 50) {
    frame = resultFor(["curled", "curled"], pulse(t));
    motion.update(video, t, true);
  }
  assert.deepEqual(hits, ["tickle", "shake"]);
  assert.equal(loads, 1);
});
