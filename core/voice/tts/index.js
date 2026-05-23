const EventEmitter = require('events');
const { execFileSync, execSync } = require('child_process');
const Logger = require('../../shared/index').Logger;

class TextToSpeech extends EventEmitter {
  constructor(config) {
    super();
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.isSpeaking = false;
    this.rate = config?.voice?.tts?.rate || 0;
    this.volume = config?.voice?.tts?.volume || 100;
    this.voiceName = 'Microsoft David Desktop';
    this.availableVoices = [];
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
        const preferred = this.availableVoices.find(v => v.toLowerCase().includes('david'))
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
        $synth.Volume = ${this.volume}
        $synth.Rate = ${rate}
        $synth.Speak('${safeText}')
        $synth.Dispose()
      `;

      execFileSync('powershell.exe', ['-NoProfile', '-Command', psScript], {
        timeout: 30000
      });

      this.isSpeaking = false;
      this.emit('completed', text);
    } catch (err) {
      this.logger.error('TTS speech failed', err);
      this.isSpeaking = false;
      this.emit('error', err);
    }
  }

  speakAsync(text) {
    return new Promise((resolve) => {
      this.once('completed', resolve);
      this.once('error', resolve);
      this.speak(text);
    });
  }

  stop() {
    try {
      execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        'Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.SpeakAsyncCancelAll(); $synth.Dispose()'
      ], {
        timeout: 3000
      });
    } catch (e) {}
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
}

module.exports = TextToSpeech;
