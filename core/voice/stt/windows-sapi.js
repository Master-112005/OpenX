const EventEmitter = require('events');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Logger = require('../../shared/index').Logger;

class WindowsSapiSpeechEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.activeProcess = null;
    this.ready = false;
  }

  async initialize() {
    this.ready = true;
    this.emit('ready', {
      event: 'ready',
      backend: 'windows-sapi',
      activationMode: this.config?.voice?.activationMode || 'hotkey'
    });
    return true;
  }

  listen(options = {}) {
    if (this.activeProcess) {
      this.stopActiveRecognition();
    }

    const mode = String(options.mode || 'command');
    const startSpeechTimeoutMs = Number(options.startSpeechTimeoutMs) > 0
      ? Number(options.startSpeechTimeoutMs)
      : 20000;
    const maxDurationMs = Number(options.maxDurationMs) > 0
      ? Number(options.maxDurationMs)
      : startSpeechTimeoutMs;
    const timeoutMs = Math.max(1000, Math.min(startSpeechTimeoutMs, maxDurationMs));

    this.emit('event', {
      event: 'stt_session_activated',
      mode,
      startSpeechTimeoutMs,
      maxDurationMs,
      timeoutMs
    });

    const scriptPath = this._writeRecognitionScriptFile(timeoutMs, mode);

    try {
      this.activeProcess = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      this._deleteTempScript(scriptPath);
      this.emit('event', {
        event: 'error',
        message: `Windows SAPI recognition failed: ${error.message}`
      });
      return;
    }

    let stdout = '';
    let stderr = '';

    this.activeProcess.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });

    this.activeProcess.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });

    this.activeProcess.once('error', (error) => {
      this.activeProcess = null;
      this._deleteTempScript(scriptPath);
      this.emit('event', {
        event: 'error',
        message: `Windows SAPI recognition failed: ${error.message}`
      });
    });

    this.activeProcess.once('exit', () => {
      this.activeProcess = null;
      this._deleteTempScript(scriptPath);

      if (stderr.trim()) {
        this.emit('event', {
          event: 'warning',
          message: this._cleanPowerShellMessage(stderr)
        });
      }

      const payload = this._parseRecognitionOutput(stdout, mode, timeoutMs);
      this.emit('event', payload);
    });
  }

  pause() {
    this.stopActiveRecognition();
    this.emit('event', { event: 'paused' });
  }

  resume() {
    this.emit('event', { event: 'resumed' });
  }

  shutdown() {
    this.stopActiveRecognition();
    this.ready = false;
    this.removeAllListeners();
  }

  stopActiveRecognition() {
    if (!this.activeProcess) {
      return;
    }

    try {
      const pid = this.activeProcess.pid;
      if (pid) {
        spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], {
          windowsHide: true,
          stdio: 'ignore'
        });
      }
    } catch (error) {
      this.logger.warn('Failed to stop SAPI recognition', error.message);
    }

    this.activeProcess = null;
  }

  _parseRecognitionOutput(stdout, mode, timeoutMs) {
    const lines = String(stdout || '')
      .trim()
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const parsed = JSON.parse(lines[index]);
        if (parsed?.event) {
          return parsed;
        }
      } catch (error) {}
    }

    return {
      event: 'session_timeout',
      mode,
      reason: 'no-speech-detected',
      timeoutMs
    };
  }

  _cleanPowerShellMessage(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
  }

  _writeRecognitionScriptFile(timeoutMs, mode) {
    const script = this._buildRecognitionScript(timeoutMs, mode);
    const directory = path.join(os.tmpdir(), 'openx-sapi');
    fs.mkdirSync(directory, { recursive: true });
    const filename = `recognize-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`;
    const scriptPath = path.join(directory, filename);
    fs.writeFileSync(scriptPath, script, 'utf8');
    return scriptPath;
  }

  _deleteTempScript(scriptPath) {
    if (!scriptPath) {
      return;
    }

    try {
      fs.unlinkSync(scriptPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.logger.debug?.('Failed to delete temporary SAPI script', error.message);
      }
    }
  }

  _buildRecognitionScript(timeoutMs, mode) {
    const safeMode = this._escapePowerShellString(mode);
    const safeTimeout = Math.max(1000, Math.min(60000, Math.round(timeoutMs)));
    const commandPhrases = this._buildCommandPhrases();
    const phraseArray = this._toPowerShellArray(commandPhrases);

    return `
      $ErrorActionPreference = 'Stop'
      Add-Type -AssemblyName System.Speech
      function Write-Json($payload) {
        [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress))
      }
      try {
        $culture = [System.Globalization.CultureInfo]::GetCultureInfo('en-US')
        try {
          $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture)
        } catch {
          $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
        }
        $recognizer.SetInputToDefaultAudioDevice()
        $commandPhrases = ${phraseArray}
        if ($commandPhrases.Count -gt 0) {
          $choices = New-Object System.Speech.Recognition.Choices
          $choices.Add([string[]]$commandPhrases) | Out-Null
          $grammarBuilder = New-Object System.Speech.Recognition.GrammarBuilder
          $grammarBuilder.Culture = $recognizer.RecognizerInfo.Culture
          $grammarBuilder.Append($choices)
          $commandGrammar = New-Object System.Speech.Recognition.Grammar($grammarBuilder)
          $commandGrammar.Name = 'OpenX Commands'
          $recognizer.LoadGrammar($commandGrammar)
        }
        $dictation = New-Object System.Speech.Recognition.DictationGrammar
        $dictation.Name = 'OpenX Dictation'
        $recognizer.LoadGrammar($dictation)
        $result = $recognizer.Recognize([TimeSpan]::FromMilliseconds(${safeTimeout}))
        if ($null -eq $result) {
          Write-Json @{
            event = 'session_timeout'
            mode = '${safeMode}'
            reason = 'no-speech-detected'
            timeoutMs = ${safeTimeout}
          }
        } else {
          $alternates = @()
          foreach ($alternate in ($result.Alternates | Select-Object -First 5)) {
            $alternates += @{
              text = $alternate.Text
              confidence = [Math]::Max(0, [Math]::Min(1, $alternate.Confidence))
            }
          }
          Write-Json @{
            event = 'result'
            text = $result.Text
            confidence = [Math]::Max(0, [Math]::Min(1, $result.Confidence))
            grammar = $result.Grammar.Name
            alternates = $alternates
            isFinal = $true
            speechDetected = $true
            mode = '${safeMode}'
            backend = 'windows-sapi'
          }
        }
        $recognizer.Dispose()
      } catch {
        Write-Json @{
          event = 'error'
          message = $_.Exception.Message
        }
      }
    `;
  }

  _escapePowerShellString(value) {
    return String(value || '').replace(/'/g, "''");
  }

  _toPowerShellArray(values) {
    const escaped = values
      .map(value => `'${this._escapePowerShellString(value)}'`)
      .join(',');
    return `@(${escaped})`;
  }

  _buildCommandPhrases() {
    const verbs = [
      'open',
      'close',
      'launch',
      'start',
      'run',
      'search',
      'search for',
      'find',
      'play',
      'pause',
      'resume',
      'stop',
      'mute',
      'unmute',
      'increase',
      'decrease',
      'set',
      'switch to',
      'show',
      'create',
      'delete',
      'move',
      'copy',
      'rename',
      'call',
      'message',
      'maximize',
      'minimize',
      'click',
      'go to'
    ];
    const targetAliases = [
      ['chrome', 'google chrome', 'chrome browser'],
      ['youtube', 'you tube', 'youtube app', 'youtube website'],
      ['edge', 'microsoft edge', 'edge browser'],
      ['firefox', 'mozilla firefox', 'firefox browser'],
      ['spotify', 'spotify app'],
      ['notepad'],
      ['calculator'],
      ['downloads', 'downloads folder'],
      ['documents', 'documents folder'],
      ['desktop'],
      ['volume'],
      ['brightness'],
      ['timer'],
      ['alarm'],
      ['reminder'],
      ['whatsapp', 'whats app'],
      ['teams', 'microsoft teams'],
      ['word', 'microsoft word'],
      ['excel', 'microsoft excel'],
      ['powerpoint', 'microsoft powerpoint'],
      ['music'],
      ['window', 'current window'],
      ['folder'],
      ['file'],
      ['browser']
    ];
    const webTargets = [
      'chatgpt',
      'chat gpt',
      'claude',
      'gemini',
      'perplexity',
      'github',
      'gmail',
      'google drive',
      'google docs'
    ];
    const standalone = [
      'help',
      'show help',
      'what can you do',
      'system status',
      'pause music',
      'resume music',
      'stop music',
      'increase volume',
      'decrease volume',
      'mute volume',
      'unmute volume',
      'increase brightness',
      'decrease brightness',
      'open first result',
      'open the first result',
      'open first link',
      'open the first link',
      'click first result',
      'click the first result',
      'click first link',
      'click the first link',
      'play liked songs',
      'play songs',
      'play music',
      'next song',
      'previous song'
    ];
    const phrases = new Set(standalone);

    for (const verb of verbs) {
      for (const aliases of targetAliases) {
        for (const target of aliases) {
          phrases.add(`${verb} ${target}`);
          phrases.add(`${verb} the ${target}`);
          phrases.add(`please ${verb} ${target}`);
          phrases.add(`can you ${verb} ${target}`);
          phrases.add(`could you ${verb} ${target}`);
        }
      }
    }

    for (const target of targetAliases.flat()) {
      phrases.add(`open up ${target}`);
      phrases.add(`bring up ${target}`);
      phrases.add(`go to ${target}`);
    }

    for (const target of webTargets) {
      phrases.add(`open ${target}`);
      phrases.add(`open ${target} in chrome`);
      phrases.add(`search for ${target}`);
      phrases.add(`search for ${target} in chrome`);
      phrases.add(`google ${target}`);
      phrases.add(`click the first result for ${target}`);
      phrases.add(`open first result for ${target}`);
    }

    return Array.from(phrases).sort();
  }
}

module.exports = WindowsSapiSpeechEngine;
