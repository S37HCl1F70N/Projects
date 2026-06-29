# Penny_For_Your_Time.ps1
# Entry point for the Penny_For_Your_Time application

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# --------------------------------------------------
# Resolve project paths
# --------------------------------------------------
$script:ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

$paths = @{
    ConfigApp             = Join-Path $script:ProjectRoot 'Config\AppConfig.ps1'
    TimeHelpers           = Join-Path $script:ProjectRoot 'Functions\TimeHelpers.ps1'
    StateFunctions        = Join-Path $script:ProjectRoot 'Functions\StateFunctions.ps1'
    ProgressBarFunctions  = Join-Path $script:ProjectRoot 'Functions\ProgressBarFunctions.ps1'
    DisplayFunctions      = Join-Path $script:ProjectRoot 'Functions\DisplayFunctions.ps1'
    MainForm              = Join-Path $script:ProjectRoot 'UI\MainForm.ps1'
    EventHandlers         = Join-Path $script:ProjectRoot 'UI\EventHandlers.ps1'
    AppIcon               = Join-Path $script:ProjectRoot 'Assets\icon.ico'
}

# --------------------------------------------------
# Validate required files
# --------------------------------------------------
# --------------------------------------------------
# Validate required files
# --------------------------------------------------
$requiredFiles = @(
    $paths.ConfigApp
    $paths.TimeHelpers
    $paths.StateFunctions
    $paths.ProgressBarFunctions
    $paths.DisplayFunctions
    $paths.MainForm
    $paths.EventHandlers
)

$missingFiles = @(
    $requiredFiles | Where-Object { -not (Test-Path -LiteralPath $_) }
)

if ($missingFiles.Count -gt 0) {
    $messageLines = @(
        'The application cannot start because required files are missing.'
        ''
    )

    $messageLines += ($missingFiles | ForEach-Object { " - $_" })
    $message = $messageLines -join [Environment]::NewLine

    [System.Windows.Forms.MessageBox]::Show(
        $message,
        'Penny fo your time - Missing Files',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null

    throw $message
}

# --------------------------------------------------
# Load config, functions, UI, and event wiring
# --------------------------------------------------
. $paths.ConfigApp
. $paths.TimeHelpers
. $paths.StateFunctions
. $paths.ProgressBarFunctions
. $paths.DisplayFunctions
. $paths.MainForm
. $paths.EventHandlers

# --------------------------------------------------
# Apply optional icon
# --------------------------------------------------
if (Test-Path -LiteralPath $paths.AppIcon) {
    try {
        $form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($paths.AppIcon)
    }
    catch {
        try {
            $form.Icon = New-Object System.Drawing.Icon($paths.AppIcon)
        }
        catch {
            # If the icon fails to load, the app shall still run.
        }
    }
}

# --------------------------------------------------
# Initialize default control values
# --------------------------------------------------
$now = Get-Date
$dtpStart.Value = $now
$dtpEnd.Value = $now.AddHours(1)

# --------------------------------------------------
# Initialize application state
# --------------------------------------------------
Reset-RunState

if (Get-Command -Name Update-Display -ErrorAction SilentlyContinue) {
    # Not strictly necessary at launch after reset, but harmless.
    # Left here only if thy internal UI logic expects it.
}

if ($updatePlannedDuration) {
    & $updatePlannedDuration
}

# --------------------------------------------------
# Launch form
# --------------------------------------------------
[void]$form.ShowDialog()
