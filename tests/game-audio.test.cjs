const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup({ delayMusic = false } = {}) {
  const nodes = [], gains = [], fetched = [];
  let releaseMusic;
  const musicReady = new Promise(resolve => { releaseMusic = resolve; });
  class AudioContext {
    currentTime = 0;
    destination = {};
    resume() { return Promise.resolve(); }
    createGain() {
      const gain = { gain: { value: 1, setTargetAtTime(value) { this.value = value; } },
        connect() { return this; }, disconnect() {} };
      gains.push(gain);
      return gain;
    }
    createBufferSource() {
      const node = { stopped: false, connect(gain) { this.gain = gain; return gain; },
        disconnect() {}, start() { nodes.push(this); },
        stop() { this.stopped = true; this.onended?.(); }, addEventListener() {} };
      return node;
    }
    async decodeAudioData(path) {
      if (delayMusic && path.includes('on-the-other-side')) await musicReady;
      const samples = new Float32Array([.1, -.1, .1, -.1]);
      return { path, numberOfChannels: 1, length: samples.length, getChannelData: () => samples };
    }
  }
  const sandbox = { window: { AudioContext }, AudioContext, console,
    fetch: async path => { fetched.push(path); return { ok: true, arrayBuffer: async () => path }; } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../game-audio.js'), 'utf8'), sandbox);
  return { audio: sandbox.createGameAudio(), nodes, gains, fetched, releaseMusic };
}

test('music and quieter clock layer start once; attacks keep their original sound', async () => {
  const { audio, nodes, fetched } = setup();
  audio.unlock();
  await audio.startMusic();
  await audio.startMusic();
  assert.equal(nodes.length, 2);
  assert.ok(nodes.every(node => node.loop));
  assert.equal(nodes[0].buffer.path, 'audio/on-the-other-side.mp3');
  assert.equal(nodes[1].buffer.path, 'audio/clock-ticking.wav');
  assert.ok(nodes[1].gain.gain.value <= nodes[0].gain.gain.value / 2);
  assert.ok(!fetched.includes('audio/bgm.mp3'));
  await audio.play('shake');
  assert.equal(nodes[2].buffer.path, 'audio/shake.mp3');
  assert.equal(nodes[2].gain.gain.value, .8);
  assert.ok(nodes.slice(0, 2).every(node => !node.stopped));
});

test('mute controls both layers and replay stops the previous pair', async () => {
  const { audio, nodes, gains } = setup();
  audio.unlock();
  await audio.startMusic();
  audio.setEnabled(false);
  assert.equal(gains[0].gain.value, 0);
  audio.setEnabled(true);
  assert.equal(gains[0].gain.value, 1);
  assert.equal(nodes.length, 2);
  audio.stop();
  assert.ok(nodes.every(node => node.stopped));
  await audio.startMusic();
  assert.equal(nodes.filter(node => !node.stopped).length, 2);
  audio.stop();
  assert.ok(nodes.every(node => node.stopped));
});

test('leaving during music loading cannot start either layer later', async () => {
  const { audio, nodes, releaseMusic } = setup({ delayMusic: true });
  audio.unlock();
  const pending = audio.startMusic();
  audio.stop();
  releaseMusic();
  await pending;
  assert.equal(nodes.length, 0);
});
