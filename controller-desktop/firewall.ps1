param(
  [Parameter(Mandatory=$true)][string]$ProgramPath,
  [Parameter(Mandatory=$true)][string]$Ports
)

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $args = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -ProgramPath `"$ProgramPath`" -Ports `"$Ports`""
  Start-Process powershell.exe -Verb RunAs -ArgumentList $args -Wait
  exit
}

$name = 'PitLink Controller - Private LAN'
if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $name -Description 'PitLink local WSS controller' -Direction Inbound -Action Allow -Profile Private -Protocol TCP -LocalPort $Ports -Program $ProgramPath | Out-Null
}
