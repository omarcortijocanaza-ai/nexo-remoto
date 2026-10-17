'use strict';

const wrtc = require('@roamhq/wrtc');

const { RTCVideoSource, RTCAudioSource } = wrtc.nonstandard;

function even(value) { return Math.max(2, Math.round(value / 2) * 2); }

class WebRtcHost {
  constructor({ getMonitor, getAudioTarget, spawnRawVideo, spawnSystemAudio, onRealtimeEvent, onLog = () => {} }) {
    this.getMonitor = getMonitor;
    this.getAudioTarget = getAudioTarget;
    this.spawnRawVideo = spawnRawVideo;
    this.spawnSystemAudio = spawnSystemAudio;
    this.onRealtimeEvent = onRealtimeEvent;
    this.onLog = onLog;
    this.peers = new Set();
    this.videoSource = new RTCVideoSource({ isScreencast: true, needsDenoising: false });
    this.audioSource = new RTCAudioSource();
    this.videoTrack = this.videoSource.createTrack();
    this.audioTrack = this.audioSource.createTrack();
    this.videoCapture = null;
    this.audioCapture = null;
    this.videoStream = null;
    this.captureKey = '';
    this.fpsCap = [30, 45, 60].includes(Number(process.env.NEXO_CPU_MAX_FPS)) ? Number(process.env.NEXO_CPU_MAX_FPS) : 60;
    this.heightCap = [720, 900, 1080].includes(Number(process.env.NEXO_CPU_MAX_HEIGHT)) ? Number(process.env.NEXO_CPU_MAX_HEIGHT) : 1080;
    this.fps = Math.min(45, this.fpsCap);
    this.maxHeight = Math.min(720, this.heightCap);
    this.framesCaptured = 0;
    this.captureStartedAt = 0;
    this.stopTimer = null;
    this.backgroundIdleMs = Math.max(60000, Number(process.env.NEXO_BACKGROUND_IDLE_MS) || 15 * 60 * 1000);
    // Un par en segundo plano deja de responder al canal de control porque el
    // navegador congela sus temporizadores, pero ICE y DTLS siguen vivos: sólo
    // el estado del transporte distingue una pestaña oculta de una zombi. Un
    // par que ya no está conectado no merece las horas de gracia, porque
    // mantiene viva la captura de vídeo y el audio sin que nadie los reciba.
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const peer of this.peers) {
        const connected = peer.pc.connectionState === 'connected';
        const timeout = peer.background && connected ? this.backgroundIdleMs : 15000;
        if (now - peer.lastSeen > timeout) this.closePeer(peer);
      }
    }, 5000);
    this.sweepTimer.unref();
  }

  dimensions(monitor = this.getMonitor()) {
    const maxWidth = Math.round(this.maxHeight * 16 / 9);
    const scale = Math.min(1, maxWidth / monitor.width, this.maxHeight / monitor.height);
    return { width: even(monitor.width * scale), height: even(monitor.height * scale) };
  }

  async acceptOffer(offer, options = {}) {
    const requestedFps = Math.min(Number(options.fps), this.fpsCap);
    if ([30, 45, 60].includes(requestedFps) && requestedFps !== this.fps) {
      this.fps = requestedFps;
      if (this.peers.size) this.ensureCaptures(true);
    }
    const requestedHeight = Math.min(Number(options.height), this.heightCap);
    if ([720, 900, 1080].includes(requestedHeight) && requestedHeight !== this.maxHeight) {
      this.maxHeight = requestedHeight;
      if (this.peers.size) this.ensureCaptures(true);
    }
    const pc = new wrtc.RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      bundlePolicy: 'max-bundle'
    });
    const peer = { pc, channels: new Set(), closed: false, background: false, gpuVideo: false, lastSeen: Date.now() };
    this.peers.add(peer);
    clearTimeout(this.stopTimer);
    this.ensureCaptures();

    pc.addTrack(this.videoTrack);
    pc.addTrack(this.audioTrack);
    pc.ondatachannel = event => this.attachChannel(peer, event.channel);
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this.closePeer(peer);
    };

    try {
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.waitForIce(pc, 2500);
      return { type: pc.localDescription.type, sdp: pc.localDescription.sdp };
    } catch (error) {
      this.closePeer(peer);
      throw error;
    }
  }

  waitForIce(pc, timeout) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(done, timeout);
      const handler = () => { if (pc.iceGatheringState === 'complete') done(); };
      function done() {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', handler);
        resolve();
      }
      pc.addEventListener('icegatheringstatechange', handler);
    });
  }

  attachChannel(peer, channel) {
    peer.channels.add(channel);
    channel.onmessage = event => {
      try {
        peer.lastSeen = Date.now();
        const data = JSON.parse(String(event.data));
        if (data.type === 'lifecycle') {
          peer.background = data.state === 'hidden';
          return channel.send(JSON.stringify({ type: 'lifecycle-ack', state: data.state }));
        }
        if (data.type === 'video-mode') {
          peer.gpuVideo = data.mode === 'gpu';
          this.ensureCaptures();
          return channel.send(JSON.stringify({ type: 'video-mode-ack', mode: peer.gpuVideo ? 'gpu' : 'cpu' }));
        }
        if (data.type === 'ping') return channel.send(JSON.stringify({ type: 'pong', sent: data.sent }));
        Promise.resolve(this.onRealtimeEvent(data)).catch(error => this.onLog(`Entrada WebRTC: ${error.message}`));
      } catch (error) { this.onLog(`Mensaje WebRTC inválido: ${error.message}`); }
    };
    channel.onclose = () => peer.channels.delete(channel);
  }

  notify(data) {
    const message = JSON.stringify(data);
    for (const peer of this.peers) {
      for (const channel of peer.channels) {
        if (channel.readyState === 'open' && channel.label === 'control') {
          try { channel.send(message); } catch {}
        }
      }
    }
  }

  stats() {
    const now = Date.now();
    return {
      peers: this.peers.size,
      profile: { fps: this.fps, maxHeight: this.maxHeight, ...this.dimensions() },
      captureFps: this.captureStartedAt ? Math.round(this.framesCaptured * 1000 / Math.max(1, now - this.captureStartedAt)) : 0,
      sessions: [...this.peers].map(peer => ({ state: peer.pc.connectionState, background: peer.background, gpuVideo: peer.gpuVideo, idleMs: now - peer.lastSeen }))
    };
  }

  monitorChanged() {
    const monitor = this.getMonitor();
    const dimensions = this.dimensions(monitor);
    this.notify({ type: 'display', ...monitor, streamWidth: dimensions.width, streamHeight: dimensions.height });
    if (this.peers.size) this.ensureCaptures(true);
  }

  closePeer(peer) {
    if (peer.closed) return;
    peer.closed = true;
    this.peers.delete(peer);
    try { peer.pc.close(); } catch {}
    if (!this.peers.size) {
      clearTimeout(this.stopTimer);
      this.stopTimer = setTimeout(() => this.stopCaptures(), 1200);
    } else this.ensureCaptures();
  }

  ensureCaptures(force = false) {
    const monitor = this.getMonitor();
    const { width, height } = this.dimensions(monitor);
    const key = `${monitor.name}:${width}x${height}@${this.fps}`;
    const needsCpuVideo = [...this.peers].some(peer => !peer.gpuVideo);
    if (needsCpuVideo && (force || !this.videoCapture || this.captureKey !== key)) this.startVideo(monitor, width, height, key);
    if (!needsCpuVideo && this.videoCapture) this.stopVideo();
    if (!this.audioCapture) this.startAudio();
  }

  stopVideo() {
    if (this.videoCapture) this.videoCapture.kill('SIGTERM');
    if (this.videoStream) this.videoStream.destroy();
    this.videoCapture = null;
    this.videoStream = null;
    this.captureKey = '';
    this.framesCaptured = 0;
    this.captureStartedAt = 0;
  }

  startVideo(monitor, width, height, key) {
    if (this.videoCapture) this.videoCapture.kill('SIGTERM');
    if (this.videoStream) this.videoStream.destroy();
    const frameBytes = width * height * 3 / 2;
    const fps = this.fps;
    this.framesCaptured = 0;
    this.captureStartedAt = Date.now();
    let spawned;
    try {
      spawned = this.spawnRawVideo({ monitor, width, height, fps });
    } catch (error) {
      this.onLog(`Captura WebRTC: ${error.message}`);
      return;
    }
    const { child, stream: videoStream } = spawned;
    this.videoStream = videoStream;
    this.videoCapture = child;
    this.captureKey = key;
    let frame = Buffer.allocUnsafe(frameBytes);
    let offset = 0;
    videoStream.on('data', chunk => {
      let position = 0;
      while (position < chunk.length) {
        const count = Math.min(frameBytes - offset, chunk.length - position);
        chunk.copy(frame, offset, position, position + count);
        offset += count;
        position += count;
        if (offset === frameBytes) {
          const data = new Uint8ClampedArray(frame.buffer, frame.byteOffset, frameBytes);
          this.videoSource.onFrame({ width, height, data });
          this.framesCaptured++;
          frame = Buffer.allocUnsafe(frameBytes);
          offset = 0;
        }
      }
    });
    let errorText = '';
    child.stderr.on('data', data => { if (errorText.length < 4096) errorText += data; });
    child.on('error', error => this.onLog(`Captura WebRTC: ${error.message}`));
    child.on('close', code => {
      videoStream.destroy();
      if (this.videoStream === videoStream) this.videoStream = null;
      if (this.videoCapture !== child) return;
      this.videoCapture = null;
      if (code && this.peers.size) this.onLog(`Captura WebRTC terminó (${code}): ${errorText.trim().slice(-300)}`);
      if (this.peers.size) setTimeout(() => this.ensureCaptures(), 350);
    });
  }

  async startAudio() {
    if (this.audioCapture) return;
    let target;
    try { target = await this.getAudioTarget(); }
    catch { target = 'alsa_output.pci-0000_09_00.4.analog-stereo'; }
    if (!this.peers.size || this.audioCapture) return;
    let child;
    try {
      child = this.spawnSystemAudio({ target, latencyMs: 20 });
    } catch (error) {
      this.onLog(`Audio WebRTC: ${error.message}`);
      return;
    }
    this.audioCapture = child;
    let errorText = '';
    child.stderr.on('data', data => { if (errorText.length < 4096) errorText += data; });
    const blockBytes = 480 * 2 * 2;
    let block = Buffer.allocUnsafe(blockBytes);
    let offset = 0;
    child.stdout.on('data', chunk => {
      let position = 0;
      while (position < chunk.length) {
        const count = Math.min(blockBytes - offset, chunk.length - position);
        chunk.copy(block, offset, position, position + count);
        offset += count;
        position += count;
        if (offset === blockBytes) {
          const exact = block.buffer.slice(block.byteOffset, block.byteOffset + blockBytes);
          const samples = new Int16Array(exact);
          this.audioSource.onData({ samples, sampleRate: 48000, bitsPerSample: 16, channelCount: 2, numberOfFrames: 480 });
          block = Buffer.allocUnsafe(blockBytes);
          offset = 0;
        }
      }
    });
    child.on('error', error => this.onLog(`Audio WebRTC: ${error.message}`));
    child.on('close', code => {
      if (this.audioCapture !== child) return;
      this.audioCapture = null;
      if (this.peers.size) {
        this.onLog(`Audio WebRTC terminó (${code ?? 'señal'}): ${errorText.trim().slice(-300) || 'sin detalle'}`);
        setTimeout(() => this.startAudio(), 1000);
      }
    });
  }

  stopCaptures() {
    this.stopVideo();
    if (this.audioCapture) this.audioCapture.kill('SIGTERM');
    this.audioCapture = null;
  }

  close() {
    clearInterval(this.sweepTimer);
    for (const peer of [...this.peers]) this.closePeer(peer);
    this.stopCaptures();
    this.videoTrack.stop();
    this.audioTrack.stop();
  }
}

module.exports = { WebRtcHost };
