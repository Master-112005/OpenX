const EventEmitter = require('events');
const { execSync, spawn, spawnSync } = require('child_process');
const Logger = require('../../../core/assistant/Data').Logger;

const DEFAULT_TTS_VOLUME = 100;
const DEFAULT_MAX_SPEECH_CHARS = 520;
const DEFAULT_PREFERRED_VOICES = [
  'Microsoft Zira Desktop',
  'Microsoft Aria Online',
  'Microsoft Jenny Online',
  'Microsoft David Desktop'
];

class TextToSpeech extends EventEmitter {
  constructor(config) {
    super();
    this.logger = new Logger(config?.logging || { level: 'info' });
    this.isSpeaking = false;
    this.rate = this._normalizeRate(config?.voice?.tts?.rate);
    this.volume = this._normalizeVolume(config?.voice?.tts?.volume);
    this.configuredVoiceName = String(config?.voice?.tts?.voiceName || '').trim();
    this.preferredVoices = Array.isArray(config?.voice?.tts?.preferredVoices)
      ? config.voice.tts.preferredVoices.map(voice => String(voice || '').trim()).filter(Boolean)
      : DEFAULT_PREFERRED_VOICES;
    this.naturalize = config?.voice?.tts?.naturalize !== false;
    this.maxSpeechChars = this._normalizeMaxSpeechChars(config?.voice?.tts?.maxSpeechChars);
    this.voiceName = this.configuredVoiceName || 'Microsoft Zira Desktop';
    this.availableVoices = [];
    this.activeProcess = null;
  }

  async initialize() {
    this.logger.info('Initializing text-to-speech');
    try {
      const result = execSync(
        'powershell -Command "Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }"',
        { encoding: 'utf8', timeout: 5000 }
      );
      this.availableVoices = result
        .split(/\r?\n/)
        .map(voice => voice.trim())
        .filter(Boolean);

      if (this.availableVoices.length > 0) {
        const preferred = this._selectPreferredVoice()
          || this.availableVoices.find(v => v.toLowerCase().includes('zira'))
          || this.availableVoices.find(v => v.toLowerCase().includes('microsoft'))
          || this.availableVoices[0];
        this.voiceName = preferred.trim();
      }

      this.logger.info(`TTS initialized with voice: ${this.voiceName}`);
      return true;
    } catch (err) {
      this.logger.warn('Could not initialize SAPI TTS', err);
      return false;
    }
  }

  speak(text) {
    const speechText = this._prepareSpeechText(text);
    if (!speechText) return;

    if (this.isSpeaking && this.activeProcess) {
      this.stop();
    }

    this.isSpeaking = true;
    this.emit('speaking', speechText);

    const safeText = this._escapePowerShellString(speechText);
    const desiredVoice = this._escapePowerShellString(this.voiceName.trim());
    const rate = this.rate;
    const useSsml = this.naturalize;
    const ssmlText = this._escapePowerShellString(this._buildSsml(speechText));

    try {
      const psScript = `
        Add-Type -AssemblyName System.Speech
        $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
        $desiredVoice = '${desiredVoice}'
        if ($desiredVoice) {
          $installedVoices = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name.Trim() }
          if ($installedVoices -contains $desiredVoice) {
            $synth.SelectVoice($desiredVoice)
          }
        }
        $synth.SetOutputToDefaultAudioDevice()
        $synth.Volume = ${this.volume}
        $synth.Rate = ${rate}
        if (${useSsml ? '$true' : '$false'}) {
          $synth.SpeakSsml('${ssmlText}')
        } else {
          $synth.Speak('${safeText}')
        }
        $synth.Dispose()
      `;

      this.activeProcess = spawn('powershell.exe', ['-NoProfile', '-Command', psScript], {
        stdio: 'ignore'
      });

      this.activeProcess.once('exit', (code, signal) => {
        this.activeProcess = null;
        this.isSpeaking = false;
        
        if (signal === 'SIGTERM' || signal === 'SIGKILL' || signal === 'SIGINT') {
          this.emit('stopped');
        } else {
          this.emit('completed', speechText);
        }
      });

      this.activeProcess.once('error', (err) => {
        this.logger.error('TTS process error', err);
        this.activeProcess = null;
        this.isSpeaking = false;
        this.emit('error', err);
      });

    } catch (err) {
      this.logger.error('TTS speech spawn failed', err);
      this.isSpeaking = false;
      this.emit('error', err);
    }
  }

  speakAsync(text) {
    const speechText = this._prepareSpeechText(text);
    if (!speechText) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const cleanup = () => {
        this.off('completed', onCompleted);
        this.off('error', onError);
        this.off('stopped', onStopped);
      };
      const finish = (value) => {
        cleanup();
        resolve(value);
      };
      const onCompleted = (value) => finish({ outcome: 'completed', value });
      const onError = (value) => finish({ outcome: 'failed', error: value });
      const onStopped = (value) => finish({ outcome: 'cancelled', value });

      this.once('completed', onCompleted);
      this.once('error', onError);
      this.once('stopped', onStopped);
      this.speak(speechText);
    });
  }

  stop() {
    const wasSpeaking = Boolean(this.activeProcess || this.isSpeaking);
    if (this.activeProcess) {
      try {
        const pid = this.activeProcess.pid;
        if (pid) {
          spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], { stdio: 'ignore' });
        }
      } catch (err) {
        this.logger.warn('Failed to kill TTS active process', err.message);
      }
      this.activeProcess = null;
    }
    this.isSpeaking = false;
    if (wasSpeaking) this.emit('stopped');
  }

  setVoice(voiceName) {
    if (this.availableVoices.includes(voiceName)) {
      this.voiceName = voiceName;
      return true;
    }
    return false;
  }

  getVoices() {
    return [...this.availableVoices];
  }

  destroy() {
    this.stop();
    this.removeAllListeners();
  }

  _escapePowerShellString(value) {
    return String(value || '').replace(/'/g, "''");
  }

  _normalizeVolume(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return DEFAULT_TTS_VOLUME;
    }

    return Math.max(0, Math.min(DEFAULT_TTS_VOLUME, Math.round(number)));
  }

  _normalizeRate(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return -1;
    }
    return Math.max(-10, Math.min(10, Math.round(number)));
  }

  _normalizeMaxSpeechChars(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_MAX_SPEECH_CHARS;
    return Math.max(160, Math.min(1200, Math.round(number)));
  }

  _prepareSpeechText(text) {
    const normalized = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return '';
    if (normalized.length <= this.maxSpeechChars) return normalized;
    const clipped = normalized.slice(0, this.maxSpeechChars);
    const sentenceBoundary = Math.max(
      clipped.lastIndexOf('. '),
      clipped.lastIndexOf('! '),
      clipped.lastIndexOf('? ')
    );
    if (sentenceBoundary >= 120) return clipped.slice(0, sentenceBoundary + 1).trim();
    const wordBoundary = clipped.lastIndexOf(' ');
    const limit = wordBoundary >= 80 ? wordBoundary : Math.max(1, this.maxSpeechChars - 1);
    return `${clipped.slice(0, limit).trim()}.`;
  }

  _selectPreferredVoice() {
    if (this.configuredVoiceName) {
      const configured = this.availableVoices.find(voice => voice.toLowerCase() === this.configuredVoiceName.toLowerCase());
      if (configured) {
        return configured;
      }
    }

    for (const preferred of this.preferredVoices) {
      const exact = this.availableVoices.find(voice => voice.toLowerCase() === preferred.toLowerCase());
      if (exact) {
        return exact;
      }

      const partial = this.availableVoices.find(voice => voice.toLowerCase().includes(preferred.toLowerCase()));
      if (partial) {
        return partial;
      }
    }

    return null;
  }

  _buildSsml(text) {
    const escaped = this._escapeXml(text)
      .replace(/([.!?])\s+/g, '$1<break time="180ms"/> ')
      .replace(/,\s+/g, ',<break time="90ms"/> ');
    return `<speak version="1.0" xml:lang="en-US"><prosody rate="medium" pitch="+1st">${escaped}</prosody></speak>`;
  }

  _escapeXml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

module.exports = TextToSpeech;
