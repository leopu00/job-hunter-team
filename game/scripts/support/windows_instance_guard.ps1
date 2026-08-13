Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$MaxInput=2048
$Utf8=New-Object Text.UTF8Encoding($false,$true)
$Mutex=$null
$Desktop=$null
$Held=$false
if(-not('JhtGuardPath' -as [type])){Add-Type @'
using System;using System.Text;using System.Runtime.InteropServices;
public static class JhtGuardPath{
[DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern uint GetFinalPathNameByHandle(IntPtr h,StringBuilder b,uint n,uint f);
public static string Final(IntPtr h){var b=new StringBuilder(32768);uint n=GetFinalPathNameByHandle(h,b,(uint)b.Capacity,0);if(n==0||n>=b.Capacity)throw new InvalidOperationException("final_path");string s=b.ToString();return s.StartsWith(@"\\?\")?s.Substring(4):s;}}
'@
}

function Fail([string]$Code){[Console]::Error.WriteLine('JHT-INSTANCE-GUARD '+$Code);exit 1}
function Hex([byte[]]$Bytes){([BitConverter]::ToString($Bytes)).Replace('-','').ToLowerInvariant()}
function Hash([string]$Value){$h=[Security.Cryptography.SHA256]::Create();try{Hex ($h.ComputeHash($Utf8.GetBytes($Value)))}finally{$h.Dispose()}}
function Canon([string]$Path){([IO.Path]::GetFullPath($Path)).Replace('\','/').ToLowerInvariant()}
function Token([string]$Value,[string]$Pattern){$Value -cmatch $Pattern}
function Keys([object]$Value,[string[]]$Expected){
  $actual=@($Value.PSObject.Properties|ForEach-Object{$_.Name}|Sort-Object -CaseSensitive)
  $wanted=@($Expected|Sort-Object -CaseSensitive)
  if($actual.Count -ne $wanted.Count){return $false}
  for($i=0;$i -lt $actual.Count;$i++){if($actual[$i] -cne $wanted[$i]){return $false}}
  return $true
}
function Read-LineBounded {
  $b=New-Object Text.StringBuilder
  while($b.Length -le $MaxInput){
    $c=[Console]::In.Read()
    if($c -eq 10){return $b.ToString()}
    if($c -lt 32 -or $c -gt 126){throw 'input_character'}
    [void]$b.Append([char]$c)
  }
  throw 'input_oversize'
}
function FileAcl([Security.Principal.SecurityIdentifier]$Sid){
  $s=New-Object Security.AccessControl.FileSecurity
  $s.SetOwner($Sid);$s.SetAccessRuleProtection($true,$false)
  foreach($id in @($Sid,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))){
    $s.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($id,'FullControl','Allow')))
  }
  return $s
}
function DirAcl([Security.Principal.SecurityIdentifier]$Sid){
  $s=New-Object Security.AccessControl.DirectorySecurity
  $s.SetOwner($Sid);$s.SetAccessRuleProtection($true,$false)
  foreach($id in @($Sid,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))){
    $s.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
  }
  return $s
}
function Sddl($Security){$Security.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Owner,Access')}
function Assert-Dir([string]$Path,[Security.AccessControl.DirectorySecurity]$Expected){
  $item=Get-Item -LiteralPath $Path -Force
  if(-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'root_identity'}
  if((Sddl ($item.GetAccessControl([Security.AccessControl.AccessControlSections]'Access,Owner'))) -cne (Sddl $Expected)){throw 'root_acl'}
}
function Assert-File([string]$Path,[Security.AccessControl.FileSecurity]$Expected){
  $item=Get-Item -LiteralPath $Path -Force
  if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'file_identity'}
  if((Sddl ($item.GetAccessControl([Security.AccessControl.AccessControlSections]'Access,Owner'))) -cne (Sddl $Expected)){throw 'file_acl'}
}
function Read-Exact([string]$Path,[Security.AccessControl.FileSecurity]$Expected){
  Assert-File $Path $Expected
  $f=New-Object IO.FileStream($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
  try{
    if((Canon ([JhtGuardPath]::Final($f.SafeFileHandle.DangerousGetHandle()))) -cne (Canon $Path)){throw 'request_redirect'}
    Assert-File $Path $Expected
    if($f.Length -lt 2 -or $f.Length -gt $MaxInput){throw 'request_size'}
    $bytes=New-Object byte[] ([int]$f.Length);if($f.Read($bytes,0,$bytes.Length) -ne $bytes.Length){throw 'request_read'}
    return $Utf8.GetString($bytes)
  }finally{$f.Dispose()}
}
function Write-New([string]$Path,[string]$Text,[Security.AccessControl.FileSecurity]$Acl){
  $bytes=$Utf8.GetBytes($Text)
  if($bytes.Length -gt $MaxInput){throw 'ack_size'}
  $f=New-Object IO.FileStream($Path,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::FullControl,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough,$Acl)
  try{
    if((Canon ([JhtGuardPath]::Final($f.SafeFileHandle.DangerousGetHandle()))) -cne (Canon $Path)){throw 'ack_redirect'}
    $f.Write($bytes,0,$bytes.Length);$f.Flush($true)
  }finally{$f.Dispose()}
  Assert-File $Path $Acl
}
function MutexAcl([Security.Principal.SecurityIdentifier]$Sid){
  $s=New-Object Security.AccessControl.MutexSecurity
  $s.SetOwner($Sid);$s.SetAccessRuleProtection($true,$false)
  foreach($id in @($Sid,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))){
    $s.AddAccessRule((New-Object Security.AccessControl.MutexAccessRule($id,'FullControl','Allow')))
  }
  return $s
}
function Assert-Mutex($Value,$Expected){
  if((Sddl ($Value.GetAccessControl())) -cne (Sddl $Expected)){throw 'mutex_acl'}
}

try{
  $raw=Read-LineBounded
  try{$input=$raw|ConvertFrom-Json -ErrorAction Stop}catch{throw 'input_json'}
  if(-not(Keys $input @('desktop_pid','instance_id','mode','nonce','request_id','request_token','schema','source_sha256'))){throw 'input_schema'}
  if($input.schema -isnot [int] -or $input.schema -ne 1 -or $input.desktop_pid -isnot [int] -or $input.desktop_pid -le 0){throw 'input_type'}
  if($input.mode -cnotin @('normal','update') -or -not (Token $input.instance_id '^instance-[0-9a-f]{24}$') -or -not (Token $input.nonce '^[0-9a-f]{32}$') -or -not (Token $input.request_id '^(normal|verify|apply|recover)-[0-9a-f]{24}$') -or -not (Token $input.request_token '^guard-[0-9a-f]{32}$') -or -not (Token $input.source_sha256 '^[0-9a-f]{64}$')){throw 'input_value'}
  $canonical=([ordered]@{desktop_pid=[int]$input.desktop_pid;instance_id=[string]$input.instance_id;mode=[string]$input.mode;nonce=[string]$input.nonce;request_id=[string]$input.request_id;request_token=[string]$input.request_token;schema=1;source_sha256=[string]$input.source_sha256}|ConvertTo-Json -Compress)
  if($raw -cne $canonical){throw 'input_canonical'}

  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  if($null -eq $sid){throw 'identity'}
  $root=[IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Job Hunter Team\host-runtime\instance-guard'))
  $dirAcl=DirAcl $sid
  if(-not[IO.Directory]::Exists($root)){[void][IO.Directory]::CreateDirectory($root,$dirAcl)}
  Assert-Dir $root $dirAcl
  $fileAcl=FileAcl $sid
  $request=Join-Path $root ('request-'+$input.request_token+'.json')
  if($input.mode -ceq 'update'){
    $requestRaw=Read-Exact $request $fileAcl
    try{$bound=$requestRaw|ConvertFrom-Json -ErrorAction Stop}catch{throw 'request_json'}
    if(-not(Keys $bound @('desktop_pid','instance_id','mode','nonce','request_id','request_token','schema','source_sha256'))){throw 'request_schema'}
    $requestCanonical=([ordered]@{desktop_pid=[int]$bound.desktop_pid;instance_id=[string]$bound.instance_id;mode=[string]$bound.mode;nonce=[string]$bound.nonce;request_id=[string]$bound.request_id;request_token=[string]$bound.request_token;schema=[int]$bound.schema;source_sha256=[string]$bound.source_sha256}|ConvertTo-Json -Compress)
    if($requestRaw -cne $requestCanonical -or $requestCanonical -cne $canonical){throw 'request_binding'}
    [IO.File]::Delete($request)
  } elseif([IO.File]::Exists($request)){throw 'request_squat'}

  $Desktop=[Diagnostics.Process]::GetProcessById([int]$input.desktop_pid)
  [void]$Desktop.Handle
  $desktopStarted=$Desktop.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
  $desktopExe=Canon $Desktop.MainModule.FileName
  $self=[Diagnostics.Process]::GetCurrentProcess();[void]$self.Handle
  $guardStarted=$self.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
  $guardExe=Canon $self.MainModule.FileName

  $fingerprint=Hash ('jht-instance-guard-v1|'+$sid.Value)
  $mutexName='Local\JobHunterTeam.InstanceGuard.v1.'+$fingerprint
  $mutexAcl=MutexAcl $sid
  $created=$false
  $Mutex=New-Object Threading.Mutex($false,$mutexName,[ref]$created,$mutexAcl)
  Assert-Mutex $Mutex $mutexAcl
  $abandoned=$false
  try{$Held=$Mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$Held=$true;$abandoned=$true}
  if(-not $Held){throw 'mutex_busy'}
  Assert-Mutex $Mutex $mutexAcl
  if($abandoned){while(-not$Desktop.WaitForExit(250)){};throw 'mutex_abandoned'}

  $ack=[ordered]@{desktop_exe_path=$desktopExe;desktop_pid=$Desktop.Id;desktop_started=$desktopStarted;guard_exe_path=$guardExe;guard_pid=$PID;guard_started=$guardStarted;instance_id=[string]$input.instance_id;mode=[string]$input.mode;mutex_fingerprint=$fingerprint;nonce=[string]$input.nonce;request_id=[string]$input.request_id;request_token=[string]$input.request_token;schema=1;source_sha256=[string]$input.source_sha256;type='ready'}
  $json=$ack|ConvertTo-Json -Compress
  $ackPath=Join-Path $root ('ack-'+$input.request_token+'.json')
  Write-New $ackPath $json $fileAcl
  [Console]::OutputEncoding=$Utf8
  [Console]::Out.WriteLine($json);[Console]::Out.Flush()
  while(-not$Desktop.WaitForExit(250)){[Console]::Out.WriteLine('ALIVE');[Console]::Out.Flush()}
  exit 0
}catch{Fail ([string]$_.Exception.Message)}finally{
  if($Held -and $Mutex){try{$Mutex.ReleaseMutex()}catch{}}
  if($Mutex){$Mutex.Dispose()}
  if($Desktop){$Desktop.Dispose()}
}
