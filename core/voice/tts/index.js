const EventEmitter = require('events');
const { execSync, spawn, spawnSync } = require('child_process');
const Logger = require('../../shared/index').Logger;

const DEFAULT_TTS_VOLUME = 100;
const MIN_AUDIBLE_TTS_VOLUME = 85;

class TextToSpeech extends EventEmitter {
  constructor(config) {
    super();
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.isSpeaking = false;
    this.rate = config?.voice?.tts?.rate || 0;
    this.volume = this._normalizeVolume(config?.voice?.tts?.volume);
    this.voiceName = 'Microsoft David Desktop';
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
        const preferred = this.availableVoices.find(v => v.toLowerCase().includes('zira'))
          || this.availableVoices.find(v => v.toLowerCase().includes('david'))
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
    if (!text || typeof text !== 'string' || text.trim().length === 0) return;

    if (this.isSpeaking && this.activeProcess) {
      this.stop();
    }

    this.isSpeaking = true;
    this.emit('speaking', text);

    const safeText = this._escapePowerShellString(text.trim());
    const desiredVoice = this._escapePowerShellString(this.voiceName.trim());
    const rate = this.rate;

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
        $synth.Speak('${safeText}')
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
          this.emit('completed', text);
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
    return new Promise((resolve) => {
      this.once('completed', resolve);
      this.once('error', resolve);
      this.once('stopped', resolve);
      this.speak(text);
    });
  }

  stop() {
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
    this.emit('stopped');
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

    const clamped = Math.max(0, Math.min(DEFAULT_TTS_VOLUME, Math.round(number)));
    return clamped === 0 ? DEFAULT_TTS_VOLUME : Math.max(MIN_AUDIBLE_TTS_VOLUME, clamped);
  }
}

module.exports = TextToSpeech;
