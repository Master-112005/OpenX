$ErrorActionPreference = 'Stop'

$ruleName = 'OpenX Phone Pairing'
$ports = '8080-8099'

$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existingRule) {
  Set-NetFirewallRule -DisplayName $ruleName -Enabled True -Direction Inbound -Action Allow -Profile Domain,Private,Public
  Get-NetFirewallPortFilter -AssociatedNetFirewallRule $existingRule |
    Set-NetFirewallPortFilter -Protocol TCP -LocalPort $ports
} else {
  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $ports `
    -Profile Domain,Private,Public | Out-Null
}

Get-NetConnectionProfile |
  Where-Object { $_.InterfaceAlias -eq 'Wi-Fi' -and $_.NetworkCategory -eq 'Public' } |
  ForEach-Object {
    try {
      Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private
    } catch {
      Write-Warning "Could not change Wi-Fi profile to Private: $($_.Exception.Message)"
    }
  }

Write-Host "OpenX phone pairing firewall rule is enabled for TCP $ports."
Write-Host "You can close this window."
Start-Sleep -Seconds 5
