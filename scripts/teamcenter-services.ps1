[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('Status', 'Stop', 'Start', 'Restart')]
  [string]$Action = 'Status',

  [ValidateRange(10, 300)]
  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-TeamcenterServices {
  Get-Service | Where-Object {
    $_.Name -match 'Teamcenter|Active Workspace.*Index' -or
    $_.DisplayName -match 'Teamcenter|Active Workspace.*Index'
  } | Sort-Object DisplayName
}

function Wait-ServiceState {
  param(
    [Parameter(Mandatory)]
    [string]$Name,

    [Parameter(Mandatory)]
    [System.ServiceProcess.ServiceControllerStatus]$ExpectedState
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $service = Get-Service -Name $Name
    if ($service.Status -eq $ExpectedState) {
      return $true
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

  Write-Error "Timeout aguardando o servico '$Name' atingir o estado $ExpectedState."
  return $false
}

function Stop-TeamcenterService {
  param([Parameter(Mandatory)][System.ServiceProcess.ServiceController]$Service)

  if ($Service.Status -eq 'Stopped') {
    Write-Host "[OK] Parado: $($Service.DisplayName)"
    return
  }

  Write-Host "[STOP] $($Service.DisplayName)"
  try {
    Stop-Service -Name $Service.Name -ErrorAction Stop
    [void](Wait-ServiceState -Name $Service.Name -ExpectedState Stopped)
  } catch {
    Write-Error "Falha ao parar '$($Service.DisplayName)': $($_.Exception.Message)"
  }
}

function Start-TeamcenterService {
  param([Parameter(Mandatory)][System.ServiceProcess.ServiceController]$Service)

  if ($Service.Status -eq 'Running') {
    Write-Host "[OK] Em execucao: $($Service.DisplayName)"
    return
  }

  Write-Host "[START] $($Service.DisplayName)"
  try {
    Start-Service -Name $Service.Name -ErrorAction Stop
    [void](Wait-ServiceState -Name $Service.Name -ExpectedState Running)
  } catch {
    Write-Error "Falha ao iniciar '$($Service.DisplayName)': $($_.Exception.Message)"
  }
}

function Split-ServiceGroups {
  param([Parameter(Mandatory)][object[]]$Services)

  $webTier = @($Services | Where-Object { $_.Name -eq 'Teamcenter WebTier' })
  $processManager = @($Services | Where-Object { $_.Name -eq 'Teamcenter Process Manager' })
  $serverManagers = @($Services | Where-Object { $_.Name -like 'Teamcenter Server Manager*' })
  $fsc = @($Services | Where-Object { $_.DisplayName -like 'Teamcenter FSC Service*' })
  $handledServices = @($webTier + $processManager + $serverManagers + $fsc)
  $handled = @($handledServices | Select-Object -ExpandProperty Name)
  $other = @($Services | Where-Object { $_.Name -notin $handled })

  return [pscustomobject]@{
    WebTier        = $webTier
    ProcessManager = $processManager
    ServerManagers = $serverManagers
    Fsc            = $fsc
    Other          = $other
  }
}

function Invoke-StopSequence {
  param([Parameter(Mandatory)][object[]]$Services)

  $groups = Split-ServiceGroups -Services $Services
  @($groups.WebTier + $groups.Other + $groups.ServerManagers + $groups.ProcessManager + $groups.Fsc) |
    ForEach-Object { Stop-TeamcenterService -Service $_ }
}

function Invoke-StartSequence {
  param([Parameter(Mandatory)][object[]]$Services)

  $groups = Split-ServiceGroups -Services $Services
  @($groups.Fsc + $groups.ProcessManager + $groups.ServerManagers + $groups.Other + $groups.WebTier) |
    ForEach-Object { Start-TeamcenterService -Service $_ }
}

if ($Action -ne 'Status' -and -not (Test-Administrator)) {
  throw 'Execute o PowerShell como Administrador para iniciar, parar ou reiniciar servicos.'
}

$services = @(Get-TeamcenterServices)
if ($services.Count -eq 0) {
  throw 'Nenhum servico Teamcenter foi encontrado.'
}

switch ($Action) {
  'Status' {
    $services | Select-Object Status, Name, DisplayName | Format-Table -AutoSize
  }
  'Stop' {
    Invoke-StopSequence -Services $services
    Get-TeamcenterServices | Select-Object Status, Name, DisplayName | Format-Table -AutoSize
  }
  'Start' {
    Invoke-StartSequence -Services $services
    Get-TeamcenterServices | Select-Object Status, Name, DisplayName | Format-Table -AutoSize
  }
  'Restart' {
    $runningServiceNames = @($services | Where-Object Status -eq 'Running' | Select-Object -ExpandProperty Name)
    $runningServices = @($services | Where-Object Name -in $runningServiceNames)

    Invoke-StopSequence -Services $runningServices
    Invoke-StartSequence -Services $runningServices
    Get-TeamcenterServices | Select-Object Status, Name, DisplayName | Format-Table -AutoSize
  }
}
