#requires -Version 7.0
<#
EFLUZ isolated Telegram Serverless staging deploy.
Run ONLY with separate test bot CLI token (not Telegram Bot API token).
Does not export/import production data or change the production webhook.
Usage: pwsh -File scripts/deployEflStaging.ps1 -StagingAppId 123 -ProductionAppId 456
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[1-9][0-9]{0,19}$')][string]$StagingAppId,
  [Parameter(Mandatory=$true)][ValidatePattern('^[1-9][0-9]{0,19}$')][string]$ProductionAppId
)
$ErrorActionPreference = 'Stop'
if ($StagingAppId -eq $ProductionAppId) { throw 'STAGING_EQUALS_PRODUCTION' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { throw 'Bun is required: https://bun.sh/' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required' }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'npx is required' }
$previousToken = [Environment]::GetEnvironmentVariable('TGCLOUD_TOKEN','Process')
$previousStaging = [Environment]::GetEnvironmentVariable('TGCLOUD_STAGING_APP_ID','Process')
$previousProduction = [Environment]::GetEnvironmentVariable('TGCLOUD_PRODUCTION_APP_ID','Process')
$previousConfirmation = [Environment]::GetEnvironmentVariable('CONFIRM_TGCLOUD_STAGING_DEPLOY','Process')
$token = $null
try {
  $secure = Read-Host 'Paste separate staging bot SERVERLESS CLI access token (not bot API token)' -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  if (-not $token -or $token -notmatch '^app([1-9][0-9]*):\S{10,}$' -or $Matches[1] -ne $StagingAppId) {
    throw 'INVALID_STAGING_APP_TOKEN'
  }
  $env:TGCLOUD_TOKEN = $token
  $env:TGCLOUD_STAGING_APP_ID = $StagingAppId
  $env:TGCLOUD_PRODUCTION_APP_ID = $ProductionAppId
  $env:CONFIRM_TGCLOUD_STAGING_DEPLOY = 'DEPLOY_STAGING_ONLY'
  Push-Location $root
  try {
    node scripts/verifyTgcloudStagingGate.mjs
    if ($LASTEXITCODE -ne 0) { throw 'STAGING_GATE_FAILED' }
    bun install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'DEPENDENCY_INSTALL_FAILED' }
    node scripts/checkTgcloudModules.mjs
    if ($LASTEXITCODE -ne 0) { throw 'MODULE_CHECK_FAILED' }
    bun run build:tgcloud
    if ($LASTEXITCODE -ne 0) { throw 'BUILD_FAILED' }
    node scripts/verifyTgcloudStatic.mjs
    if ($LASTEXITCODE -ne 0) { throw 'STATIC_CHECK_FAILED' }
    Write-Host 'Deploying ONLY to verified staging app...'
    npx --yes --package=@tgcloud/cli tgcloud push
    if ($LASTEXITCODE -ne 0) { throw 'STAGING_PUSH_FAILED' }
    npx --yes --package=@tgcloud/cli tgcloud migrate --dry-run
    if ($LASTEXITCODE -ne 0) { throw 'STAGING_SCHEMA_REVIEW_FAILED' }
    npx --yes --package=@tgcloud/cli tgcloud migrate --safe
    if ($LASTEXITCODE -ne 0) { throw 'STAGING_SAFE_MIGRATION_FAILED' }
    Write-Host 'STAGING_CODE_DEPLOYED. Data import and production cutover NOT performed.'
  } finally { Pop-Location }
} finally {
  $token = $null
  $env:TGCLOUD_TOKEN = $previousToken
  $env:TGCLOUD_STAGING_APP_ID = $previousStaging
  $env:TGCLOUD_PRODUCTION_APP_ID = $previousProduction
  $env:CONFIRM_TGCLOUD_STAGING_DEPLOY = $previousConfirmation
}
