const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getFaceShoulderCrop } = require('../camera-framing.js');

test('작은 얼굴도 같은 얼굴~어깨 비율로 확대한다', () => {
  for (const height of [45, 100, 190]) {
    const face = { originX: 600, originY: 180, width: height * .8, height };
    const crop = getFaceShoulderCrop(face, 1280, 720);
    assert.ok(Math.abs(face.height / crop.height - 1 / 2.05) < .001);
    assert.ok(crop.y < face.originY);
    assert.ok(crop.y + crop.height > face.originY + face.height * 1.7);
  }
});

test('화면 가장자리와 아주 가까운 얼굴에서도 카메라 경계를 벗어나지 않는다', () => {
  for (const [w, h] of [[1280, 720], [640, 480], [720, 1280]]) {
    for (const x of [0, w / 2, w - 40]) {
      for (const y of [0, h - 60]) {
        for (const size of [40, 600]) {
          const crop = getFaceShoulderCrop({ originX: x, originY: y, width: size, height: size }, w, h);
          assert.ok(crop.x >= 0 && crop.y >= 0);
          assert.ok(crop.x + crop.width <= w + .001 && crop.y + crop.height <= h + .001);
          assert.ok(Math.abs(crop.width / crop.height - 16 / 9) < .001);
        }
      }
    }
  }
});
