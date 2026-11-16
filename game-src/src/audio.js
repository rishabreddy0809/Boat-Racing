// Fully synthesised audio: engine, water rush, guns, rockets, explosions.
export function createAudio() {
  let ctx = null, master, engGain, engFilter, oscs = [], rushGain, rushFilter, noiseBuf;
  let muted = false;

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;

    engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 300;
    engFilter.Q.value = 2;
    engGain = ctx.createGain();
    engGain.gain.value = 0;
    engFilter.connect(engGain);
    engGain.connect(master);
    for (const [type, det] of [['sawtooth', 0], ['sawtooth', 7], ['square', -1200], ['sawtooth', 1207]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = det;
      o.frequency.value = 50;
      const g = ctx.createGain();
      g.gain.value = det === 1207 ? 0.12 : 0.3;
      o.connect(g);
      g.connect(engFilter);
      o.start();
      oscs.push(o);
    }
    const rush = ctx.createBufferSource();
    rush.buffer = noiseBuf;
    rush.loop = true;
    rushFilter = ctx.createBiquadFilter();
    rushFilter.type = 'bandpass';
    rushFilter.frequency.value = 900;
    rushFilter.Q.value = 0.5;
    rushGain = ctx.createGain();
    rushGain.gain.value = 0;
    rush.connect(rushFilter);
    rushFilter.connect(rushGain);
    rushGain.connect(master);
    rush.start();
  }

  function engine(speedFrac, throttle, boost, active) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = 46 + speedFrac * 78 + throttle * 14 + (boost ? 18 : 0);
    for (const o of oscs) o.frequency.setTargetAtTime(f, t, 0.08);
    engFilter.frequency.setTargetAtTime(260 + speedFrac * 1300 + throttle * 500, t, 0.1);
    engGain.gain.setTargetAtTime(active ? 0.1 + throttle * 0.1 + speedFrac * 0.06 : 0, t, 0.15);
    rushGain.gain.setTargetAtTime(active ? speedFrac * speedFrac * 0.3 : 0, t, 0.2);
    rushFilter.frequency.setTargetAtTime(600 + speedFrac * 1500, t, 0.2);
  }

  function noise(dur, f0, f1, gain, type = 'lowpass', q = 0.7) {
    if (!ctx || gain <= 0.002) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t);
    fl.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(fl);
    fl.connect(g);
    g.connect(master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }
  function tone(type, f0, f1, dur, gain) {
    if (!ctx || gain <= 0.002) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  const att = (dist) => 1 / (1 + (dist / 45) * (dist / 45));

  return {
    init,
    engine,
    // heavy machine gun: low thump, mechanical clack, short crack
    gun(dist = 0) {
      const a = att(dist);
      noise(0.16, 2200, 180, 0.42 * a, 'lowpass');
      tone('square', 120 + Math.random() * 14, 42, 0.11, 0.22 * a);
      noise(0.035, 7000, 3500, 0.16 * a, 'highpass');
    },
    ricochet(dist = 0) {
      const f = 1900 + Math.random() * 1400;
      tone('sine', f, f * 0.42, 0.28, 0.07 * att(dist));
    },
    servo(g = 0.02) {
      tone('sawtooth', 150, 140, 0.06, g);
    },
    hit(dist = 0) {
      const a = att(dist);
      noise(0.05, 5000, 1800, 0.14 * a, 'bandpass', 3);
      tone('triangle', 900 + Math.random() * 500, 300, 0.05, 0.06 * a);
    },
    rocket(dist = 0) {
      noise(0.9, 2400, 300, 0.32 * att(dist), 'bandpass', 0.8);
    },
    explosion(dist = 0, big = 1) {
      const a = att(dist * 0.5) * big;
      noise(1.5, 1400, 40, 0.95 * a, 'lowpass');
      tone('sine', 95, 26, 0.9, 0.8 * a);
      noise(0.25, 6000, 800, 0.3 * a, 'highpass');
    },
    splash(dist = 0) {
      noise(0.5, 1800, 300, 0.22 * att(dist), 'bandpass', 0.6);
    },
    thud() {
      tone('sine', 120, 40, 0.25, 0.5);
      noise(0.2, 900, 120, 0.3);
    },
    beep(f = 880, dur = 0.09, g = 0.1) {
      tone('square', f, f, dur, g);
    },
    mine() {
      tone('sine', 300, 140, 0.18, 0.2);
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.55;
      return muted;
    },
  };
}
