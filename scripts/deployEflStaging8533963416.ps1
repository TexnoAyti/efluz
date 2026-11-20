#requires -Version 7.0
<#
EFLUZ Telegram Serverless: one-command isolated staging deploy.
Uses the previously reviewed deployEflStaging.ps1.
The staging CLI token is entered privately in the local terminal, never
stored in this file or passed to the command line.
No production webhook change, production import or production deployment.
#>
[CmdletBinding()]
param(
  [switch]$TokenFromClipboard,
  [switch]$RealUi
)
$ErrorActionPreference = 'Stop'
$staging = '8533963416'
$production = '8785073471'
if ($staging -eq $production) { throw 'STAGING_EQUALS_PRODUCTION' }
$deploy = Join-Path $PSScriptRoot 'deployEflStaging.ps1'
if (-not (Test-Path -LiteralPath $deploy)) { throw 'STAGING_DEPLOY_SCRIPT_MISSING' }
$params = @{
  StagingAppId = $staging
  ProductionAppId = $production
}
if ($TokenFromClipboard) { $params.TokenFromClipboard = $true }
if ($RealUi) { $params.RealUi = $true }
Write-Host 'EFLUZ Telegram Serverless staging only (app8533963416).'
Write-Host 'Production app8785073471 will not be targeted.'
& $deploy @params
if (-not $?) { throw 'STAGING_DEPLOY_SCRIPT_FAILED' }
