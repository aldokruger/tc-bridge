param(
  [string]$TeamcenterLib = $env:TC_TEAMCENTER_SOA_LIB,
  [string]$JdkHome = 'E:\PLM\JAVA_JDK',
  [string]$OutputDir = (Join-Path $PSScriptRoot '..\build\soa-adapter')
)

$ErrorActionPreference = 'Stop'
if (-not $TeamcenterLib) { throw 'Defina TC_TEAMCENTER_SOA_LIB ou informe -TeamcenterLib.' }

$javac = Join-Path $JdkHome 'bin\javac.exe'
$jar = Join-Path $JdkHome 'bin\jar.exe'
if (-not (Test-Path -LiteralPath $javac)) { throw "JDK nao encontrado: $javac" }
if (-not (Test-Path -LiteralPath $TeamcenterLib)) { throw "Biblioteca SOA nao encontrada: $TeamcenterLib" }

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'java\src\main\java\com\aldokruger\tcbridge\TeamcenterSoaAdapter.java'
$classes = Join-Path $OutputDir 'classes'
$artifact = Join-Path $OutputDir 'tc-bridge-soa-adapter.jar'
$javacArgumentsFile = Join-Path $OutputDir 'javac.args'
$classpath = (Get-ChildItem -LiteralPath $TeamcenterLib -Filter '*.jar' | ForEach-Object FullName) -join ';'

New-Item -ItemType Directory -Force -Path $classes | Out-Null
# The SOA client has enough JARs to exceed Windows' command-line limit.
# javac expands @argument files itself, avoiding that limit.
@(
  '-encoding'
  'UTF-8'
  '-cp'
  ('"{0}"' -f $classpath)
  '-d'
  ('"{0}"' -f $classes)
  ('"{0}"' -f $source)
) | Set-Content -LiteralPath $javacArgumentsFile -Encoding ascii
& $javac "@$javacArgumentsFile"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o adaptador SOA.' }
& $jar --create --file $artifact -C $classes .
if ($LASTEXITCODE -ne 0) { throw 'Falha ao empacotar o adaptador SOA.' }

Write-Output "Adaptador criado: $artifact"
