// 음악과 효과음을 한 곳에서 관리합니다. 시작 버튼을 누른 뒤에만 소리를 냅니다.
function createGameAudio() {
  const files = { bgm: 'on-the-other-side.mp3', clock: 'clock-ticking.wav', shake: 'shake.mp3', tickle: 'tickle.mp3',
    noise: 'noise.mp3', wind: 'wind.mp3', win: 'win.mp3', lose: 'lose.wav' };
  const buffers = new Map();
  const sources = new Set();
  let context, master, music, effect;
  let enabled = true;
  let generation = 0;
  let effectRequest = 0;
  let wantsMusic = false;

  function load(name) {
    if (!buffers.has(name)) {
      buffers.set(name, fetch(`audio/${files[name]}`).then(response => {
        if (!response.ok) throw new Error(`Audio ${name}: ${response.status}`);
        return response.arrayBuffer();
      }).then(data => context.decodeAudioData(data)).then(buffer => {
        // 생성된 녹음마다 다른 음량을 맞추되 최대 진폭은 넘지 않게 합니다.
        let sum = 0, peak = 0;
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          for (const value of buffer.getChannelData(ch)) {
            sum += value * value;
            peak = Math.max(peak, Math.abs(value));
          }
        }
        const rms = Math.sqrt(sum / (buffer.length * buffer.numberOfChannels));
        const scale = Math.min(8, 0.18 / (rms || 1), 0.88 / (peak || 1));
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          const samples = buffer.getChannelData(ch);
          for (let i = 0; i < samples.length; i++) samples[i] *= scale;
        }
        return buffer;
      }).catch(error => {
        buffers.delete(name);
        console.warn('소리를 불러오지 못했어요.', error);
        return null;
      }));
    }
    return buffers.get(name);
  }

  function unlock() {
    if (!window.AudioContext) return;
    if (!context) {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = enabled ? 1 : 0;
      master.connect(context.destination);
      Object.keys(files).forEach(load);
    }
    context.resume().catch(error => console.warn('소리를 다시 켜 주세요.', error));
  }

  function source(buffer, volume, loop = false) {
    const node = context.createBufferSource();
    const gain = context.createGain();
    node.buffer = buffer;
    node.loop = loop;
    gain.gain.value = volume;
    node.connect(gain).connect(master);
    sources.add(node);
    node.onended = () => { sources.delete(node); node.disconnect(); gain.disconnect(); };
    node.start();
    return node;
  }

  async function startMusic() {
    if (!context || wantsMusic) return;
    wantsMusic = true;
    const request = generation;
    const [buffer, ticking] = await Promise.all([load('bgm'), load('clock')]);
    if (buffer && request === generation && wantsMusic) {
      music = source(buffer, 0.25, true);
      // 같은 음량 보정을 거친 째깍 소리는 음악의 절반보다 작은 게인으로 겹칩니다.
      if (ticking) source(ticking, 0.12, true);
    }
  }

  async function play(name) {
    if (!context || !enabled || !files[name]) return;
    const request = ++effectRequest;
    const round = generation;
    const buffer = await load(name);
    if (!buffer || round !== generation || request !== effectRequest || !enabled) return;
    effect?.stop();
    effect = source(buffer, name === 'lose' ? 0.95 : 0.8);
    const current = effect;
    current.addEventListener('ended', () => { if (effect === current) effect = null; });
  }

  function stop() {
    generation++;
    effectRequest++;
    wantsMusic = false;
    for (const node of sources) node.stop();
    sources.clear();
    music = effect = null;
  }

  function setEnabled(value) {
    enabled = value;
    if (value) unlock();
    if (master) master.gain.setTargetAtTime(value ? 1 : 0, context.currentTime, 0.02);
    if (!value) { effectRequest++; effect?.stop(); effect = null; }
  }

  return { unlock, startMusic, play, stop, setEnabled };
}
