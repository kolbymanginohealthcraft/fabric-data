#requires -Modules Microsoft.Graph.Authentication
<#
  Pull the Patient Satisfaction survey workbooks straight from Brad Miller's OneDrive into data/,
  via Microsoft Graph. Replaces the manual browser-download + pull-satisfaction.js staging step.

  AUTH: delegated Connect-MgGraph (Files.Read.All) on the Microsoft Graph PowerShell first-party
  app (id 14d82eec-...). Silent if a WAM/MSAL token is cached; otherwise ONE interactive browser
  sign-in. NO Azure app registration, NO client secret. Delegated => access is bounded to files
  Kolby can already open (Brad's files are shared with him). Files.Read.All is already consented
  in the tenant (verified 2026-06-23) so no admin request is needed.

  Resolution: each file is fetched by its known itemId (deterministic); if that 404s (file was
  re-created) it falls back to a name search scoped to Brad's drive, newest match wins.

  Usage:  pwsh/powershell -File queries/pull-satisfaction-graph.ps1
  Then:   python -m evaluation.build_satisfaction  (and the rest of the satisfaction chain)
#>
[CmdletBinding()]
param(
  [string]$DataDir
)

$ErrorActionPreference = 'Stop'

if (-not $DataDir) {
  $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  $DataDir = Join-Path $scriptDir "..\data"
}

# Brad Miller's OneDrive drive (brad.miller@aegistherapies.com). Stable anchor that disambiguates
# from the many same-named survey workbooks elsewhere in the tenant.
$BRAD_DRIVE = "b!7m-LLfumj0259lp7XGLLO68eTY7VdGVBhaNVMczCRH4Zv4WoBawKToAAmIDmCON2"

$TARGETS = @(
  @{ Name = "Patient Satisfaction Survey.xlsx"; Id = "01VZOF3PVX7T6BO44ZGVDIXPQDYTLGSFX3"; Out = "satisfaction-main.xlsx"  },
  @{ Name = "Ohana Survey.xlsx";                Id = "01VZOF3PWA2KVPYEGSRZDIQAGRC72PJEAN"; Out = "satisfaction-ohana.xlsx" }
)

function Resolve-Item($t) {
  # 1) deterministic: known itemId
  try {
    $m = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/drives/$BRAD_DRIVE/items/$($t.Id)"
    if ($m.name -eq $t.Name) { return $m }
  } catch { }
  # 2) fallback: name search scoped to Brad's drive, newest match
  $body = @{ requests = @(@{ entityTypes = @('driveItem'); query = @{ queryString = $t.Name }; size = 25 }) } | ConvertTo-Json -Depth 8
  $r = Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/v1.0/search/query" -Body $body -ContentType "application/json"
  @($r.value.hitsContainers.hits | ForEach-Object { $_.resource } |
    Where-Object { $_.name -eq $t.Name -and $_.parentReference.driveId -eq $BRAD_DRIVE }) |
    Sort-Object { [datetime]$_.lastModifiedDateTime } -Descending | Select-Object -First 1
}

Connect-MgGraph -Scopes "Files.Read.All" -NoWelcome | Out-Null
$ctx = Get-MgContext
if (-not ($ctx.Scopes -contains 'Files.Read.All')) {
  throw "Files.Read.All not present on this connection (scopes: $($ctx.Scopes -join ', '))"
}
Write-Host "Connected as $($ctx.Account)"

if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir | Out-Null }
$DataDir = (Resolve-Path $DataDir).Path

$ok = 0
foreach ($t in $TARGETS) {
  $item = Resolve-Item $t
  if (-not $item) { Write-Warning "MISS $($t.Name): not found in Brad's drive (itemId + search both failed)"; continue }
  $dest = Join-Path $DataDir $t.Out
  Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/drives/$BRAD_DRIVE/items/$($item.id)/content" `
    -OutputFilePath $dest
  $magic = [Text.Encoding]::ASCII.GetString(([IO.File]::ReadAllBytes($dest))[0..1])
  if ($magic -ne 'PK') { Write-Warning "FAIL $($t.Out): not a valid xlsx (magic='$magic')"; continue }
  $size = [math]::Round((Get-Item $dest).Length / 1MB, 2)
  Write-Host ("OK   {0,-24} <- {1}  | {2} MB | modified {3}" -f $t.Out, $t.Name, $size, $item.lastModifiedDateTime)
  $ok++
}
Write-Host "done: $ok/$($TARGETS.Count) staged into $DataDir"
if ($ok -ne $TARGETS.Count) { exit 1 }
