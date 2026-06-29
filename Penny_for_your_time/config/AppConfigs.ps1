# Config\AppConfig.ps1
# Application configuration and shared state defaults

# --------------------------------------------------
# Financial configuration
# --------------------------------------------------
$script:HourlyRate = 44.1289
$script:PerSecondRate = $script:HourlyRate / 3600

# --------------------------------------------------
# Runtime state
# --------------------------------------------------
$script:SelectedStartTime = $null
$script:SelectedEndTime = $null
$script:RunActive = $false

# Full pause state:
# Everything stops until resumed.
$script:PauseActive = $false
$script:PauseStartedAt = $null

# Break state:
# The work window continues, but pay accumulation pauses.
$script:CounterPaused = $false
$script:CounterPauseStartedAt = $null
$script:TotalCounterPausedSeconds = 0

# Chronological break tracking for segmented progress rendering
$script:BreakIntervals = New-Object System.Collections.Generic.List[object]
$script:CurrentBreakStart = $null

# --------------------------------------------------
# Application metadata
# --------------------------------------------------
$script:AppName = 'Penny fo your time'
$script:AppVersion = '1.0.0'

# --------------------------------------------------
# Theme colors
# --------------------------------------------------
$script:ColorBackground = [System.Drawing.Color]::FromArgb(32, 32, 32)
$script:ColorForeground = [System.Drawing.Color]::White
$script:ColorMutedText = [System.Drawing.Color]::Gainsboro

$script:ColorTrack = [System.Drawing.Color]::FromArgb(70, 70, 70)
$script:ColorPaid = [System.Drawing.Color]::LimeGreen
$script:ColorBreak = [System.Drawing.Color]::OrangeRed
$script:ColorCounter = [System.Drawing.Color]::LightGreen

# --------------------------------------------------
# Fonts
# --------------------------------------------------
$script:FontLabel = New-Object System.Drawing.Font('Segoe UI', 10)
$script:FontValue = New-Object System.Drawing.Font(
    'Segoe UI',
    11,
    [System.Drawing.FontStyle]::Bold
)
$script:FontMoney = New-Object System.Drawing.Font(
    'Segoe UI',
    20,
    [System.Drawing.FontStyle]::Bold
)
$script:FontSmall = New-Object System.Drawing.Font('Segoe UI', 9)

# --------------------------------------------------
# Form sizing
# --------------------------------------------------
$script:FormWidth = 580
$script:FormHeight = 545

# --------------------------------------------------
# Progress track sizing
# --------------------------------------------------
$script:ProgressTrackWidth = 495
$script:ProgressTrackHeight = 24

# --------------------------------------------------
# Shared control references
# Assigned later in UI\MainForm.ps1
# --------------------------------------------------
$script:form = $null
$script:timer = $null

$script:dtpStart = $null
$script:dtpEnd = $null

$script:btnStart = $null
$script:btnPause = $null
$script:btnReset = $null
$script:btnBreak = $null

$script:lblStatusValue = $null
$script:lblPlannedDurationValue = $null
$script:lblElapsedValue = $null
$script:lblRemainingValue = $null
$script:lblPaidValue = $null
$script:lblBreakValue = $null
$script:lblCounterValue = $null

$script:pnlProgressTrack = $null

# --------------------------------------------------
# Shared scriptblock references
# Assigned later in UI\EventHandlers.ps1
# --------------------------------------------------
$script:updatePlannedDuration = $null
