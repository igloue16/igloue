[CmdletBinding()]
param(
    [int]$ReadyTimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$configPath = Join-Path $repoRoot "supabase\config.toml"
$testPath = Join-Path $repoRoot "supabase\integration\p3e3d-local-webhook.test.ts"
$apiEndpoint = "http://127.0.0.1:54321/functions/v1/stripe-webhook"
$databaseContainer = "supabase_db_igloue"
$edgeContainer = "supabase_edge_runtime_igloue"
$projectId = "igloue"
$fakeSecretPrefix = "whsec_local_e2e_"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("igloue-p3e3d-" + [guid]::NewGuid().ToString("N"))
$envFile = Join-Path $tempRoot "edge.env"
$stdoutLog = Join-Path $tempRoot "edge.stdout.log"
$stderrLog = Join-Path $tempRoot "edge.stderr.log"
$edgeProcess = $null
$savedEnvironment = @{}
$environmentNames = @(
    "P3E3D_LOCAL_E2E",
    "STRIPE_WEBHOOK_SECRET",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy"
)

function Fail([string]$Message) {
    throw "P3E3D local E2E refused: $Message"
}

function Invoke-LocalDocker([string[]]$Arguments) {
    $output = & docker.exe @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        Fail ("Docker check failed: " + (($output | Out-String).Trim()))
    }
    return (($output | Out-String).Trim())
}

function Test-LocalDockerContext {
    $context = Invoke-LocalDocker @("context", "inspect") | ConvertFrom-Json
    $daemonHost = $context[0].Endpoints.docker.Host
    if (-not ($daemonHost -like "npipe://*" -or $daemonHost -like "unix://*")) {
        Fail "Docker context is not a local named-pipe or Unix-socket daemon"
    }
}

function Test-LocalStack {
    if (-not (Test-Path -LiteralPath $configPath)) { Fail "supabase/config.toml is missing" }
    if (-not (Test-Path -LiteralPath $testPath)) { Fail "P3E3D integration test is missing" }

    $config = Get-Content -Raw -LiteralPath $configPath
    if ($config -notmatch '(?m)^project_id\s*=\s*"igloue"\s*$') {
        Fail "supabase/config.toml is not the local igloue project"
    }
    if ($config -notmatch '(?m)^port\s*=\s*54321\s*$') {
        Fail "local Supabase API port is not 54321"
    }
    if ($env:SUPABASE_URL -and $env:SUPABASE_URL -notmatch '^https?://(?:127\.0\.0\.1|localhost)(?::\d+)?(?:/|$)') {
        Fail "SUPABASE_URL points outside loopback"
    }

    Test-LocalDockerContext
    $raw = Invoke-LocalDocker @("inspect", $databaseContainer)
    $containers = $raw | ConvertFrom-Json
    if ($containers.Count -ne 1) { Fail "expected the local Supabase database container" }

    foreach ($container in $containers) {
        $name = $container.Name.TrimStart("/")
        if ($name -ne $databaseContainer) { Fail "Docker container identity did not match project igloue" }
        if (-not $container.State.Running) { Fail "$name is not running" }
        $labels = $container.Config.Labels
        $labelMatches = ($labels.'com.supabase.cli.project' -eq $projectId) -or
            ($labels.'com.supabase.project' -eq $projectId) -or
            ($labels.'com.docker.compose.project' -eq $projectId)
        if (-not $labelMatches) { Fail "$name is not labeled as project igloue" }
        if ($container.Config.Image -notmatch "supabase/postgres") { Fail "$name is not the expected local Supabase database image" }
    }
}

function Get-SanitizedLog([string]$Path, [string]$Secret) {
    if (-not (Test-Path -LiteralPath $Path)) { return "" }
    $text = Get-Content -Raw -LiteralPath $Path
    return $text.Replace($Secret, "<redacted fake local secret>")
}

try {
    foreach ($name in $environmentNames) {
        $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    }
    foreach ($proxyName in @("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy")) {
        Remove-Item "Env:$proxyName" -ErrorAction SilentlyContinue
    }

    Test-LocalStack

    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    $fakeSecret = $fakeSecretPrefix + [guid]::NewGuid().ToString("N")
    Set-Content -LiteralPath $envFile -Encoding ASCII -Value @(
        "STRIPE_WEBHOOK_SECRET=$fakeSecret"
        "STRIPE_EXPECTED_LIVEMODE=false"
    )

    $serveCommand = 'npx.cmd supabase functions serve stripe-webhook --env-file "' + $envFile + '" --workdir "' + $repoRoot + '"'
    $edgeProcess = Start-Process -FilePath "cmd.exe" -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog `
        -ArgumentList @(
            "/d",
            "/c",
            $serveCommand
        )

    $ready = $false
    $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($edgeProcess.HasExited) {
            $diagnostic = Get-SanitizedLog $stderrLog $fakeSecret
            if (-not $diagnostic) { $diagnostic = Get-SanitizedLog $stdoutLog $fakeSecret }
            Fail ("local Edge runtime exited before readiness" + $(if ($diagnostic) { ": $diagnostic" } else { "" }))
        }
        try {
            $response = Invoke-WebRequest -Uri $apiEndpoint -Method Get -TimeoutSec 3 -UseBasicParsing
            if ($response.StatusCode -eq 405) {
                $ready = $true
                break
            }
        } catch {
            if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 405) {
                $ready = $true
                break
            }
            # The local router may need a few seconds while the function worker starts.
        }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { Fail "local Edge runtime did not answer the loopback webhook endpoint with HTTP 405 within $ReadyTimeoutSeconds seconds" }

    $env:P3E3D_LOCAL_E2E = "1"
    $env:STRIPE_WEBHOOK_SECRET = $fakeSecret

    Write-Host "P3E3D local E2E: running against $apiEndpoint"
    & deno.exe test `
        "--allow-env=P3E3D_LOCAL_E2E,STRIPE_WEBHOOK_SECRET,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,http_proxy,https_proxy,all_proxy" `
        "--allow-read=supabase/integration" `
        "--allow-net=127.0.0.1:54321" `
        "--allow-run=docker.exe" `
        "supabase/integration/p3e3d-local-webhook.test.ts"
    $testExitCode = $LASTEXITCODE
    if ($testExitCode -ne 0) {
        Fail "Deno integration test failed with exit code $testExitCode"
    }
    Write-Host "P3E3D local E2E: PASS"
} catch {
    Write-Error $_
    exit 1
} finally {
    foreach ($name in $environmentNames) {
        if ($savedEnvironment.ContainsKey($name)) {
            [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], "Process")
        }
    }

    if ($edgeProcess -and -not $edgeProcess.HasExited) {
        & taskkill.exe /PID $edgeProcess.Id /T /F *> $null
        $edgeProcess.WaitForExit()
    }

    # Supabase CLI can leave its disposable local Edge container behind after the
    # serving process exits. Remove only the exact project-local container.
    & docker.exe rm -f $edgeContainer *> $null

    if (Test-Path -LiteralPath $tempRoot) {
        for ($attempt = 0; $attempt -lt 5 -and (Test-Path -LiteralPath $tempRoot); $attempt++) {
            Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
            if (Test-Path -LiteralPath $tempRoot) { Start-Sleep -Milliseconds 250 }
        }
    }
}
