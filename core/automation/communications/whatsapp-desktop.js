const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Logger } = require('../../shared/index');

// How long (ms) we wait for the background PowerShell script to write its result.
// Keep well below the IPC handler's implicit UI timeout.
const POLL_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 300;

function escapePowerShell(value) {
  return String(value ?? '').replace(/'/g, "''");
}

class WhatsAppDesktopController {
  constructor(config) {
    this.logger = new Logger(config?.logging || { level: 'info' });
    this.activeChildren = new Set();
  }

  sendMessage(contactName, messageText) {
    if (!contactName) {
      return { success: false, error: 'No contact name provided' };
    }
    if (!messageText) {
      return { success: false, error: 'No message text provided' };
    }

    return this._dispatch({ mode: 'message', contactName, messageText });
  }

  startVoiceCall(contactName) {
    if (!contactName) {
      return { success: false, error: 'No contact name provided' };
    }

    return this._dispatch({ mode: 'call', contactName });
  }

  /**
   * Spawns the PowerShell automation script as a tracked background process.
   * Returns a Promise that resolves once the script writes its result JSON,
   * or fails after POLL_TIMEOUT_MS if verification does not complete.
   *
   * @returns {Promise<{success: boolean, data?: object, error?: string}>}
   */
  _dispatch({ mode, contactName, messageText = '' }) {
    const resultFile = path.join(
      os.tmpdir(),
      `jarvis-wa-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );

    const script = this._buildScript({ mode, contactName, messageText, resultFile });

    return new Promise((resolve) => {
      let settled = false;
      let child = null;
      let pollHandle = null;
      let timeoutHandle = null;

      const settle = (result, options = {}) => {
        if (settled) return;
        settled = true;
        if (pollHandle) clearInterval(pollHandle);
        if (timeoutHandle) clearTimeout(timeoutHandle);

        if (child) {
          this.activeChildren.delete(child);
          if (options.killChild) {
            this._killChild(child);
          }
        }

        // Clean up temp file
        try { fs.unlinkSync(resultFile); } catch (_) {}

        resolve(result);
      };

      // Spawn PowerShell asynchronously and keep ownership for timeout/shutdown cleanup.
      try {
        child = spawn('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy', 'Bypass',
          '-Command', script
        ], {
          stdio: 'ignore',
          windowsHide: true
        });
        this.activeChildren.add(child);
        child.once('exit', () => {
          this.activeChildren.delete(child);
        });
        child.once('error', () => {
          this.activeChildren.delete(child);
        });
      } catch (spawnErr) {
        this.logger.error('WhatsApp desktop: failed to spawn PowerShell', spawnErr.message);
        return resolve({
          success: false,
          error: `WhatsApp desktop: failed to spawn PowerShell — ${spawnErr.message}`
        });
      }

      // Poll the result file written by the PS script
      pollHandle = setInterval(() => {
        try {
          if (!fs.existsSync(resultFile)) return;
          const raw = fs.readFileSync(resultFile, 'utf8').trim();
          if (!raw) return;

          let parsed;
          try { parsed = JSON.parse(raw); } catch (_) { return; }

          if (parsed.success) {
            this.logger.info('WhatsApp desktop automation succeeded', { mode, contactName });
            settle({
              success: true,
              data: {
                contactName,
                platform: 'whatsapp',
                mode,
                delivery: parsed.delivery || (mode === 'message' ? 'sent' : undefined),
                verification: parsed.verification || null,
                transport: 'whatsapp-desktop'
              }
            });
          } else {
            const errMsg = parsed.error || 'WhatsApp desktop automation failed';
            this.logger.error('WhatsApp desktop automation failed', errMsg);
            settle({ success: false, error: errMsg });
          }
        } catch (_) {
          // File not ready yet — keep polling
        }
      }, POLL_INTERVAL_MS);

      // Hard timeout — after this we give up polling.
      // Verification failure is reported as failure and the owned worker is stopped.
      timeoutHandle = setTimeout(() => {
        this.logger.warn(
          'WhatsApp desktop automation',
          `Timed out after ${POLL_TIMEOUT_MS}ms waiting for result; terminating worker`
        );
        settle({
          success: false,
          error: `WhatsApp desktop automation timed out before verification for ${contactName}`
        }, { killChild: true });
      }, POLL_TIMEOUT_MS);
    });
  }

  destroy() {
    for (const child of Array.from(this.activeChildren)) {
      this._killChild(child);
      this.activeChildren.delete(child);
    }
  }

  _killChild(child) {
    const pid = child?.pid;
    if (!pid) {
      return;
    }

    try {
      spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], { stdio: 'ignore' });
    } catch (error) {
      this.logger.warn('WhatsApp desktop: failed to terminate PowerShell worker', error.message);
    }
  }

  _buildScript({ mode, contactName, messageText, resultFile }) {
    const safeMode        = escapePowerShell(mode);
    const safeContact     = escapePowerShell(contactName);
    const safeMessage     = escapePowerShell(messageText);
    const safeResultFile  = escapePowerShell(resultFile);

    return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$mode        = '${safeMode}'
$contactName = '${safeContact}'
$messageText = '${safeMessage}'
$resultFile  = '${safeResultFile}'
$originalClipboard = $null

function Write-Result {
  param([hashtable]$Payload)
  $json = $Payload | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($resultFile, $json, [System.Text.Encoding]::UTF8)
}

function Fail-Action {
  param([string]$Message)
  Write-Result @{ success = $false; error = $Message }
  exit 1
}

function Get-RootWebArea {
  $root = [System.Windows.Automation.AutomationElement]::RootElement

  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $windows = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition
    )

    # First pass: prefer the Electron/Chrome window (Class = Chrome_WidgetWin_1)
    # which is the one that actually exposes RootWebArea and all UI controls.
    # The WinUIDesktopWin32WindowClass is a thin shell wrapper with no controls.
    for ($index = 0; $index -lt $windows.Count; $index++) {
      $window = $windows.Item($index)
      if ([string]$window.Current.Name -notlike '*WhatsApp*') { continue }
      if ([string]$window.Current.ClassName -notlike '*Chrome_WidgetWin*') { continue }

      $docCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        'RootWebArea'
      )
      $document = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $docCondition)
      if ($document) { return $document }
    }

    # Second pass: try any WhatsApp window (broader fallback)
    for ($index = 0; $index -lt $windows.Count; $index++) {
      $window = $windows.Item($index)
      if ([string]$window.Current.Name -notlike '*WhatsApp*') { continue }

      $docCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        'RootWebArea'
      )
      $document = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $docCondition)
      if ($document) { return $document }
    }

    Start-Sleep -Milliseconds 400
  }

  Fail-Action 'WhatsApp Desktop window did not expose its automation document'
}

function Get-WaElementByName {
  param(
    [System.Windows.Automation.AutomationElement]$Root,
    [System.Windows.Automation.ControlType]$ControlType,
    [string]$Name
  )

  $condition = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      $ControlType
    )),
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      $Name
    ))
  )

  return $Root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Normalize-UiText {
  param([string]$Value)
  return ([string]$Value).Trim().ToLowerInvariant()
}

function Find-ChatCandidate {
  param(
    [System.Windows.Automation.AutomationElement]$Root,
    [string]$Contact
  )

  $normalizedContact = Normalize-UiText $Contact
  $items = $Root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::DataItem
    ))
  )

  $exact      = $null
  $startsWith = $null
  $startsWithLength = [int]::MaxValue

  for ($index = 0; $index -lt $items.Count; $index++) {
    $item = $items.Item($index)
    $name = [string]$item.Current.Name
    if (-not $name) { continue }

    $normalizedName = Normalize-UiText $name
    if ($normalizedName -eq $normalizedContact) { return $item }

    if ($normalizedName.StartsWith($normalizedContact) -and $name.Length -lt $startsWithLength) {
      $startsWith = $item
      $startsWithLength = $name.Length
    }

    if (-not $exact -and $normalizedName.Contains($normalizedContact)) {
      $exact = $item
    }
  }

  if ($startsWith) { return $startsWith }
  return $exact
}

# Tries multiple known search box names to handle WhatsApp version differences
function Focus-SearchBox {
  param([System.Windows.Automation.AutomationElement]$Root)
  $knownNames = @('Search or start a new chat', 'Search', 'Search contacts or messages')
  foreach ($name in $knownNames) {
    $el = Get-WaElementByName $Root ([System.Windows.Automation.ControlType]::Edit) $name
    if ($el) { return $el }
  }
  # Generic fallback: any edit box whose name contains 'search'
  $allEdits = $Root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit
    ))
  )
  for ($i = 0; $i -lt $allEdits.Count; $i++) {
    $n = Normalize-UiText ([string]$allEdits.Item($i).Current.Name)
    if ($n -like '*search*') { return $allEdits.Item($i) }
  }
  return $null
}

function Set-SearchText {
  param(
    [System.Windows.Automation.AutomationElement]$Root,
    [string]$Value
  )

  # Primary method: Ctrl+F keyboard shortcut focuses the search box reliably
  # (confirmed working via diagnostic — clipboard paste sometimes misses focus)
  $shell = New-Object -ComObject WScript.Shell
  $shell.SendKeys('^f')
  Start-Sleep -Milliseconds 600
  $shell.SendKeys($Value)
  return $true
}

function Is-ChatAlreadyOpen {
  param(
    [System.Windows.Automation.AutomationElement]$Root,
    [string]$Contact
  )

  $normalizedContact = Normalize-UiText $Contact
  $buttons = $Root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button
    ))
  )

  for ($index = 0; $index -lt $buttons.Count; $index++) {
    $button = $buttons.Item($index)
    $name = Normalize-UiText ([string]$button.Current.Name)
    if (-not $name) { continue }
    if ($name -eq $normalizedContact -or $name.StartsWith("$normalizedContact click here for contact info")) {
      return $true
    }
  }

  return $false
}

function Try-ActivateChatCandidate {
  param([System.Windows.Automation.AutomationElement]$Candidate)

  try {
    $selectionPattern = $null
    if ($Candidate.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionPattern)) {
      $selectionPattern.Select()
      return $true
    }

    $invokePattern = $null
    if ($Candidate.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) {
      $invokePattern.Invoke()
      return $true
    }

    $Candidate.SetFocus()
    $shell = New-Object -ComObject WScript.Shell
    Start-Sleep -Milliseconds 100
    $shell.SendKeys('{ENTER}')
    return $true
  } catch {
    return $false
  }
}

function Open-ChatByName {
  param(
    [System.Windows.Automation.AutomationElement]$Root,
    [string]$Contact
  )

  # If the chat is already open, nothing to do
  if (Is-ChatAlreadyOpen $Root $Contact) { return }

  # Step 1: Use Ctrl+F to focus the search box and type the contact name.
  # Diagnostic confirmed this is the most reliable method.
  $shell = New-Object -ComObject WScript.Shell
  $shell.SendKeys('^f')
  Start-Sleep -Milliseconds 600
  $shell.SendKeys($Contact)
  Start-Sleep -Milliseconds 1500

  # Step 2: Try to click a matching data item in the search results
  $normalizedContact = Normalize-UiText $Contact
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    $diCond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::DataItem
    )
    $items = $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $diCond)

    for ($i = 0; $i -lt $items.Count; $i++) {
      $item = $items.Item($i)
      $itemName = Normalize-UiText ([string]$item.Current.Name)
      if (-not $itemName) { continue }
      # Match if the item name contains the contact name
      if (-not $itemName.Contains($normalizedContact)) { continue }

      # Try SelectionItemPattern first (most reliable)
      $sel = $null
      if ($item.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sel)) {
        $sel.Select()
        Start-Sleep -Milliseconds 300
        return
      }
      # Try InvokePattern
      $inv = $null
      if ($item.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$inv)) {
        $inv.Invoke()
        Start-Sleep -Milliseconds 300
        return
      }
      # Fallback: press Enter (works when item is in the result list)
      $shell.SendKeys('{ENTER}')
      Start-Sleep -Milliseconds 300
      return
    }
    Start-Sleep -Milliseconds 300
  }

  # Step 3: If no match found by clicking, just press Enter to open the top result
  $shell.SendKeys('{ENTER}')
  Start-Sleep -Milliseconds 500
}

# Waits for the chat message compose box to appear.
# Uses multiple heuristics because WhatsApp changes the edit box label across versions:
#   v1: "Type a message to <Contact>"
#   v2: "Type a message"  /  "Type a message..."
#   v3+: generic edit with no contact name in label
function Wait-ForChatReady {
  param(
    [System.Windows.Automation.AutomationElement]$Root,
    [string]$Contact
  )

  $normalizedContact = Normalize-UiText $Contact

  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $allEdits = $Root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Edit
      ))
    )

    for ($index = 0; $index -lt $allEdits.Count; $index++) {
      $edit = $allEdits.Item($index)
      $editName = Normalize-UiText ([string]$edit.Current.Name)
      $editAutoId = [string]$edit.Current.AutomationId

      # The search box always has AutomationId '_r_c_' in this WhatsApp version.
      # Skip it — the message compose box has an empty AutomationId.
      if ($editAutoId -eq '_r_c_') { continue }

      # Also skip by name if it looks like a search box
      if ($editName -like '*search*') { continue }

      # Strict match: old WhatsApp versions (contact name in label)
      if ($editName.StartsWith('type a message to ') -and $editName.Contains($normalizedContact)) {
        return $edit
      }

      # Loose match: newer versions
      if ($editName -like '*type a message*' -or $editName -like '*start typing*' -or $editName -eq 'message') {
        return $edit
      }

      # If there are 2 edit boxes total, the non-search one is the message input
      if ($allEdits.Count -ge 2) {
        return $edit
      }
    }

    Start-Sleep -Milliseconds 300
  }

  Fail-Action "WhatsApp opened, but the chat for $Contact was not ready (no message input found)"
}

function Send-ChatMessage {
  param(
    [System.Windows.Automation.AutomationElement]$Root,
    [string]$Contact,
    [string]$Body
  )

  $messageEdit = Wait-ForChatReady $Root $Contact
  $messageEdit.SetFocus()
  Set-Clipboard -Value $Body

  $shell = New-Object -ComObject WScript.Shell
  Start-Sleep -Milliseconds 150
  $shell.SendKeys('^v')
  Start-Sleep -Milliseconds 150
  $shell.SendKeys('{ENTER}')
}

# Clicks the voice/audio call button and waits for any call-state UI signal.
# Returns best-effort success if the call was initiated but no call-state UI
# was found (prevents timeout failures for the user).
function Start-VoiceCall {
  param(
    [System.Windows.Automation.AutomationElement]$Root,
    [string]$Contact
  )

  $null = Wait-ForChatReady $Root $Contact

  # Try known button names across WhatsApp versions
  $callButtonNames = @('Voice call', 'Audio call', 'Call')
  $button = $null
  foreach ($btnName in $callButtonNames) {
    $button = Get-WaElementByName $Root ([System.Windows.Automation.ControlType]::Button) $btnName
    if ($button) { break }
  }

  if (-not $button) {
    # Broadest fallback: any button whose name contains 'call' but is not 'video call' / 'end call'
    $allButtons = $Root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button
      ))
    )
    for ($i = 0; $i -lt $allButtons.Count; $i++) {
      $n = Normalize-UiText ([string]$allButtons.Item($i).Current.Name)
      if ($n -like '*call*' -and $n -notlike '*video*' -and $n -notlike '*end*') {
        $button = $allButtons.Item($i)
        break
      }
    }
  }

  if (-not $button) {
    Fail-Action "WhatsApp did not expose the voice call button for $Contact"
  }

  # Click the button
  $invokePattern = $null
  if ($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) {
    $invokePattern.Invoke()
  } else {
    $button.SetFocus()
    $shell = New-Object -ComObject WScript.Shell
    Start-Sleep -Milliseconds 100
    $shell.SendKeys('{ENTER}')
  }

  Start-Sleep -Milliseconds 800

  # Poll for call-state UI signals (buttons AND text labels, across all WhatsApp UI generations)
  $callStatePatterns = 'ringing|calling|connecting|end call|hang up|mute|speaker|call ended'
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    # Check buttons
    $allButtons = $Root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button
      ))
    )
    for ($index = 0; $index -lt $allButtons.Count; $index++) {
      $buttonName = Normalize-UiText ([string]$allButtons.Item($index).Current.Name)
      if ($buttonName -match $callStatePatterns) { return 'voice-call-state-detected' }
    }

    # Check text/static elements
    $textCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Text
    )
    $textElements = $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCondition)
    for ($i = 0; $i -lt $textElements.Count; $i++) {
      $txt = Normalize-UiText ([string]$textElements.Item($i).Current.Name)
      if ($txt -match 'ringing|calling|connecting') { return 'voice-call-state-detected' }
    }

    Start-Sleep -Milliseconds 300
  }

  # Call button was clicked but no call-state UI confirmed — return best-effort success
  # rather than failing (the OS/WhatsApp handles the actual call placement)
  return 'call-initiated-best-effort'
}

try {
  try {
    $originalClipboard = Get-Clipboard -Raw -ErrorAction Stop
  } catch {
    $originalClipboard = $null
  }

  $startApp = Get-StartApps | Where-Object { $_.Name -like 'WhatsApp*' } | Select-Object -First 1
  if ($startApp -and $startApp.AppID) {
    Start-Process explorer.exe "shell:AppsFolder\\$($startApp.AppID)"
  } else {
    Start-Process 'whatsapp:'
  }

  $shell = New-Object -ComObject WScript.Shell
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 300
    if ($shell.AppActivate('WhatsApp')) { break }
  }

  $rootArea = Get-RootWebArea

  $chatsButton = Get-WaElementByName $rootArea ([System.Windows.Automation.ControlType]::Button) 'Chats'
  if ($chatsButton) {
    $invokePattern = $null
    if ($chatsButton.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) {
      $invokePattern.Invoke()
      Start-Sleep -Milliseconds 200
    }
  }

  Open-ChatByName $rootArea $contactName

  if ($mode -eq 'message') {
    Send-ChatMessage $rootArea $contactName $messageText
    Write-Result @{
      success  = $true
      delivery = 'sent'
      verification = 'chat-input-submitted'
    }
  } elseif ($mode -eq 'call') {
    $verification = Start-VoiceCall $rootArea $contactName
    Write-Result @{
      success      = $true
      verification = $verification
    }
  } else {
    Fail-Action "Unsupported WhatsApp mode: $mode"
  }
} catch {
  Write-Result @{ success = $false; error = $_.Exception.Message }
} finally {
  try {
    if ($null -ne $originalClipboard) {
      Set-Clipboard -Value $originalClipboard
    }
  } catch {}
}
`.trim();
  }
}

module.exports = WhatsAppDesktopController;
