[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string]$BrokerUrl,

  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string]$AgentId,

  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string]$CapabilityPublicKeyPath,

  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string]$AgentCertificatePath,

  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string]$AgentPrivateKeyPath,

  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string]$BrokerCaPath,

  [string]$CapabilityIssuer,
  [string]$InstallRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$ListenHost = '127.0.0.1',
  [ValidateRange(1, 65535)]
  [int]$ListenPort = 4100,
  [string[]]$AllowedReadPaths = @('E:\PLM', 'E:\logs'),
  [switch]$EnableWrite,
  [string[]]$AllowedWritePaths = @(),
  [string]$StagingDirectory,
  [string[]]$DiagnosticHosts = @('localhost', '127.0.0.1', '::1'),
  [string]$AuditLogPath,
  [switch]$EnableDiagnostics,
  [switch]$EnableDbDiagnostics,
  [string]$DbServer,
  [ValidateRange(1, 65535)]
  [int]$DbPort = 1433,
  [string]$DbName,
  [string]$DbUser,
  [SecureString]$DbPassword,
  [ValidateRange(1, 120000)]
  [int]$DbConnectTimeoutMs = 10000,
  [ValidateRange(1, 120000)]
  [int]$DbRequestTimeoutMs = 30000,
  [switch]$TrustDbServerCertificate,
  [switch]$EnableTeamcenterRead,
  [string]$TeamcenterUrl,
  [string]$TeamcenterUser,
  [SecureString]$TeamcenterPassword,
  [string]$TeamcenterGroup,
  [string]$TeamcenterRole,
  [string]$TeamcenterLocale = 'en_US',
  [string]$TeamcenterJava = 'java',
  [string]$TeamcenterSoaClientEncoding,
  [string]$TeamcenterSoaLib,
  [string[]]$TeamcenterSoaExtraJars = @(),
  [string]$TeamcenterSoaAdapterJar,
  [switch]$EnableBrowserDiagnostics,
  [string]$BrowserDevtoolsUrl = 'http://127.0.0.1:9222',
  [switch]$AllowDirectPrivilegedTools,
  [ValidateSet('localtunnel', 'static')]
  [string]$Tunnel = 'localtunnel',
  [string]$PublicUrl,
  [string]$TunnelHost,
  [string]$CloudflaredPath,
  [switch]$StartAgent,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

function ConvertFrom-SecureValue {
  param([SecureString]$Value)

  if ($null -eq $Value) {
    return ''
  }

  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function New-RandomToken {
  $bytes = [byte[]]::new(48)
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function ConvertTo-EnvFlag {
  param([Parameter(Mandatory)][bool]$Enabled)

  if ($Enabled) {
    return '1'
  }
  return '0'
}

function Assert-ExistingFile {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Name
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Name nao encontrado: $Path"
  }
}

function Add-EnvValue {
  param(
    [Parameter(Mandatory)][System.Collections.Generic.List[string]]$Lines,
    [Parameter(Mandatory)][string]$Name,
    [AllowEmptyString()][string]$Value
  )

  if ($Value -match "[\r\n]") {
    throw "$Name nao pode conter quebra de linha."
  }
  $Lines.Add("$Name=$Value")
}

if (-not $BrokerUrl.StartsWith('wss://', [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'BrokerUrl deve usar wss://.'
}
if ($AllowedReadPaths.Count -eq 0) {
  throw 'Informe ao menos um AllowedReadPaths.'
}
if ($EnableWrite -and $AllowedWritePaths.Count -eq 0) {
  throw '-EnableWrite exige ao menos um AllowedWritePaths.'
}

foreach ($item in @(
  @{ Path = $CapabilityPublicKeyPath; Name = 'CapabilityPublicKeyPath' },
  @{ Path = $AgentCertificatePath; Name = 'AgentCertificatePath' },
  @{ Path = $AgentPrivateKeyPath; Name = 'AgentPrivateKeyPath' },
  @{ Path = $BrokerCaPath; Name = 'BrokerCaPath' }
)) {
  Assert-ExistingFile -Path $item.Path -Name $item.Name
}

if (-not $CapabilityIssuer) {
  $brokerUri = [Uri]$BrokerUrl
  $CapabilityIssuer = "https://$($brokerUri.Host)"
  if (-not $brokerUri.IsDefaultPort -and $brokerUri.Port -ne 443) {
    $CapabilityIssuer += ":$($brokerUri.Port)"
  }
}

if ($EnableDbDiagnostics) {
  foreach ($item in @(
    @{ Name = 'DbServer'; Value = $DbServer },
    @{ Name = 'DbName'; Value = $DbName },
    @{ Name = 'DbUser'; Value = $DbUser }
  )) {
    if (-not $item.Value) { throw "-EnableDbDiagnostics exige -$($item.Name)." }
  }
  if ($null -eq $DbPassword) { $DbPassword = Read-Host 'Senha do usuario MSSQL de diagnostico' -AsSecureString }
}

if ($EnableTeamcenterRead) {
  foreach ($item in @(
    @{ Name = 'TeamcenterUrl'; Value = $TeamcenterUrl },
    @{ Name = 'TeamcenterUser'; Value = $TeamcenterUser },
    @{ Name = 'TeamcenterSoaLib'; Value = $TeamcenterSoaLib },
    @{ Name = 'TeamcenterSoaAdapterJar'; Value = $TeamcenterSoaAdapterJar }
  )) {
    if (-not $item.Value) { throw "-EnableTeamcenterRead exige -$($item.Name)." }
  }
  if ($null -eq $TeamcenterPassword) { $TeamcenterPassword = Read-Host 'Senha do usuario SOA Teamcenter' -AsSecureString }
}

$environmentFile = Join-Path $InstallRoot '.env'
if ((Test-Path -LiteralPath $environmentFile) -and -not $Force) {
  throw "O arquivo ja existe: $environmentFile. Use -Force somente se desejar substitui-lo."
}

if (-not $AuditLogPath) {
  $AuditLogPath = Join-Path $InstallRoot 'logs\tc-agent-audit.jsonl'
}
if (-not $StagingDirectory) {
  $StagingDirectory = Join-Path $InstallRoot 'staging'
}

New-Item -ItemType Directory -Force -Path $InstallRoot, (Split-Path -Parent $AuditLogPath), $StagingDirectory | Out-Null

$token = New-RandomToken
$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add('# Gerado por scripts/setup-tc-agent.ps1. Nao versionar este arquivo.')
Add-EnvValue -Lines $lines -Name 'TC_TOKEN' -Value $token
Add-EnvValue -Lines $lines -Name 'TC_HOST' -Value $ListenHost
Add-EnvValue -Lines $lines -Name 'TC_PORT' -Value $ListenPort
Add-EnvValue -Lines $lines -Name 'TC_ALLOWED_READ_PATHS' -Value ($AllowedReadPaths -join ';')
Add-EnvValue -Lines $lines -Name 'TC_ALLOW_WRITE' -Value (ConvertTo-EnvFlag -Enabled $EnableWrite.IsPresent)
Add-EnvValue -Lines $lines -Name 'TC_ALLOWED_WRITE_PATHS' -Value ($AllowedWritePaths -join ';')
Add-EnvValue -Lines $lines -Name 'TC_STAGING_DIR' -Value $StagingDirectory
Add-EnvValue -Lines $lines -Name 'TC_ALLOW_DIAGNOSTICS' -Value (ConvertTo-EnvFlag -Enabled $EnableDiagnostics.IsPresent)
Add-EnvValue -Lines $lines -Name 'TC_DIAGNOSTIC_HOSTS' -Value ($DiagnosticHosts -join ';')
Add-EnvValue -Lines $lines -Name 'TC_ALLOW_DB_DIAGNOSTICS' -Value (ConvertTo-EnvFlag -Enabled $EnableDbDiagnostics.IsPresent)
Add-EnvValue -Lines $lines -Name 'TC_DB_SERVER' -Value $DbServer
Add-EnvValue -Lines $lines -Name 'TC_DB_PORT' -Value $DbPort
Add-EnvValue -Lines $lines -Name 'TC_DB_NAME' -Value $DbName
Add-EnvValue -Lines $lines -Name 'TC_DB_USER' -Value $DbUser
Add-EnvValue -Lines $lines -Name 'TC_DB_PASSWORD' -Value (ConvertFrom-SecureValue $DbPassword)
Add-EnvValue -Lines $lines -Name 'TC_DB_ENCRYPT' -Value 'true'
Add-EnvValue -Lines $lines -Name 'TC_DB_TRUST_SERVER_CERTIFICATE' -Value (ConvertTo-EnvFlag -Enabled $TrustDbServerCertificate.IsPresent)
Add-EnvValue -Lines $lines -Name 'TC_DB_CONNECT_TIMEOUT_MS' -Value $DbConnectTimeoutMs
Add-EnvValue -Lines $lines -Name 'TC_DB_REQUEST_TIMEOUT_MS' -Value $DbRequestTimeoutMs
Add-EnvValue -Lines $lines -Name 'TC_ALLOW_TEAMCENTER_READ' -Value (ConvertTo-EnvFlag -Enabled $EnableTeamcenterRead.IsPresent)
Add-EnvValue -Lines $lines -Name 'TC_TEAMCENTER_URL' -Value $TeamcenterUrl
Add-EnvValue -Lines $lines -Name 'TC_TEAMCENTER_USER' -Value $TeamcenterUser
Add-EnvValue -Lines $lines -Name 'TC_TEAMCENTER_PASSWORD' -Value (ConvertFrom-SecureValue $TeamcenterPassword)
Add-EnvValue -Lines $lines -Name 'TC_TEAMCENTER_GROUP' -Value $TeamcenterGroup
Add-EnvValue -Lines $lines -Name 'TC_TEAMCENTER_ROLE' -Value $TeamcenterRole
Add-EnvValue -Lines $lines -Name 'TC_TEAMCENTER_LOCALE' -Value $TeamcenterLocale
Add-EnvValue -Lines $lines -Name 'TC_TEAMCENTER_JAVA' -Value $TeamcenterJava
Add-EnvValue -Lines $lines -Name 'TC_TEAMCENTER_SOA_CLIENT_ENCODING' -Value $TeamcenterSoaClientEncoding
Add-EnvValue -Lines $lines -Name 'TC_TEAMCENTER_SOA_LIB' -Value $TeamcenterSoaLib
Add-EnvValue -Lines $lines -Name 'TC_TEAMCENTER_SOA_EXTRA_JARS' -Value ($TeamcenterSoaExtraJars -join ';')
Add-EnvValue -Lines $lines -Name 'TC_TEAMCENTER_SOA_ADAPTER_JAR' -Value $TeamcenterSoaAdapterJar
Add-EnvValue -Lines $lines -Name 'TC_ALLOW_BROWSER_DIAGNOSTICS' -Value (ConvertTo-EnvFlag -Enabled $EnableBrowserDiagnostics.IsPresent)
Add-EnvValue -Lines $lines -Name 'TC_BROWSER_DEVTOOLS_URL' -Value $BrowserDevtoolsUrl
Add-EnvValue -Lines $lines -Name 'TC_ALLOW_CAPABILITY_TASKS' -Value '1'
Add-EnvValue -Lines $lines -Name 'TC_ENFORCE_CAPABILITIES' -Value (ConvertTo-EnvFlag -Enabled (-not $AllowDirectPrivilegedTools.IsPresent))
Add-EnvValue -Lines $lines -Name 'TC_AGENT_ID' -Value $AgentId
Add-EnvValue -Lines $lines -Name 'TC_CAPABILITY_PUBLIC_KEY' -Value $CapabilityPublicKeyPath
Add-EnvValue -Lines $lines -Name 'TC_CAPABILITY_ISSUER' -Value $CapabilityIssuer
Add-EnvValue -Lines $lines -Name 'TC_AUDIT_LOG_PATH' -Value $AuditLogPath
Add-EnvValue -Lines $lines -Name 'TC_BROKER_URL' -Value $BrokerUrl
Add-EnvValue -Lines $lines -Name 'TC_AGENT_CERTIFICATE' -Value $AgentCertificatePath
Add-EnvValue -Lines $lines -Name 'TC_AGENT_PRIVATE_KEY' -Value $AgentPrivateKeyPath
Add-EnvValue -Lines $lines -Name 'TC_BROKER_CA' -Value $BrokerCaPath
Add-EnvValue -Lines $lines -Name 'TC_TUNNEL' -Value $Tunnel
Add-EnvValue -Lines $lines -Name 'TC_PUBLIC_URL' -Value $PublicUrl
Add-EnvValue -Lines $lines -Name 'TC_TUNNEL_HOST' -Value $TunnelHost
Add-EnvValue -Lines $lines -Name 'TC_CLOUDFLARED_PATH' -Value $CloudflaredPath

$lines | Set-Content -LiteralPath $environmentFile -Encoding UTF8
& icacls $environmentFile /inheritance:r /grant:r "${env:USERNAME}:(R,W)" 'SYSTEM:(F)' 'Administrators:(F)' | Out-Null

Write-Host "Configuracao criada: $environmentFile"
Write-Host "Token MCP gerado: $token"
Write-Warning 'Guarde o token agora em um gerenciador de segredos. Ele nao sera exibido novamente pelo script.'

if ($StartAgent) {
  $agentEntryPoint = Join-Path $InstallRoot 'bin\tc-agent.js'
  if (-not (Test-Path -LiteralPath $agentEntryPoint -PathType Leaf)) {
    throw "tc-agent.js nao encontrado: $agentEntryPoint"
  }
  Push-Location $InstallRoot
  try {
    & node $agentEntryPoint
  } finally {
    Pop-Location
  }
}
