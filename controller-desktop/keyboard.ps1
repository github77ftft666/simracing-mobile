Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PitLinkKeyboard {
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  public static void Key(ushort key, bool down) {
    var input = new INPUT { type = 1, ki = new KEYBDINPUT { wVk = key, dwFlags = down ? 0u : 2u } };
    SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
  }
}
'@

$keys = @{ left = 0x41; right = 0x44; throttle = 0x57; brake = 0x53 }
$active = @{}
function Set-Key($name, $isDown) {
  if ($active[$name] -eq $isDown) { return }
  [PitLinkKeyboard]::Key([UInt16]$keys[$name], [bool]$isDown)
  $active[$name] = $isDown
}
function Pulse-Key($key) {
  [PitLinkKeyboard]::Key([UInt16]$key, $true)
  Start-Sleep -Milliseconds 40
  [PitLinkKeyboard]::Key([UInt16]$key, $false)
}
try {
  while ($line = [Console]::In.ReadLine()) {
    $message = $line | ConvertFrom-Json
    if ($message.type -eq 'state') {
      Set-Key 'left' $message.left
      Set-Key 'right' $message.right
      Set-Key 'throttle' $message.throttle
      Set-Key 'brake' $message.brake
    } elseif ($message.type -eq 'event') {
      if ($message.action -eq 'gearUp') { Pulse-Key 0x20 }
      if ($message.action -eq 'gearDown') { Pulse-Key 0xA4 }
    }
  }
} finally {
  foreach ($name in $keys.Keys) { Set-Key $name $false }
}
