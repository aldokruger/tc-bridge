[CmdletBinding()]
param(
  [ValidateNotNullOrEmpty()]
  [string]$Root = 'E:\PLM\Teamcenter2606'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
  throw "Diretorio nao encontrado: $Root"
}

$files = @(
  Get-ChildItem -LiteralPath $Root -Recurse -File -ErrorAction SilentlyContinue
)

if ($files.Count -eq 0) {
  Write-Warning "Nenhum arquivo encontrado em: $Root"
  return
}

for ($index = 0; $index -lt $files.Count; $index++) {
  $file = $files[$index]
  $percentComplete = [Math]::Round((($index + 1) / $files.Count) * 100, 1)

  Write-Progress `
    -Activity 'Procurando definicoes de TC_DATA' `
    -Status "$($index + 1) de $($files.Count): $($file.FullName)" `
    -PercentComplete $percentComplete

  Select-String `
    -LiteralPath $file.FullName `
    -Pattern '^\s*(set\s+)?TC_DATA\s*=' `
    -CaseSensitive:$false `
    -ErrorAction SilentlyContinue
}

Write-Progress -Activity 'Procurando definicoes de TC_DATA' -Completed
