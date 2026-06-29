# Functions\TimeHelpers.ps1
# Time and duration helper functions

function Format-Seconds {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [int]$TotalSeconds
    )

    if ($TotalSeconds -lt 0) {
        $TotalSeconds = 0
    }

    $timeSpan = [TimeSpan]::FromSeconds($TotalSeconds)

    return ('{0:00}:{1:00}:{2:00}' -f [int]$timeSpan.TotalHours, $timeSpan.Minutes, $timeSpan.Seconds)
}

function Get-SelectedTimeRange {
    [CmdletBinding()]
    param()

    if (-not $script:dtpStart -or -not $script:dtpEnd) {
        throw 'Time picker controls have not been initialized.'
    }

    $today = Get-Date

    $startDateTime = Get-Date `
        -Year $today.Year `
        -Month $today.Month `
        -Day $today.Day `
        -Hour $script:dtpStart.Value.Hour `
        -Minute $script:dtpStart.Value.Minute `
        -Second 0

    $endDateTime = Get-Date `
        -Year $today.Year `
        -Month $today.Month `
        -Day $today.Day `
        -Hour $script:dtpEnd.Value.Hour `
        -Minute $script:dtpEnd.Value.Minute `
        -Second 0

    if ($endDateTime -le $startDateTime) {
        $endDateTime = $endDateTime.AddDays(1)
    }

    $totalSeconds = [int][Math]::Floor(($endDateTime - $startDateTime).TotalSeconds)

    return [pscustomobject]@{
        StartTime    = $startDateTime
        EndTime      = $endDateTime
        TotalSeconds = $totalSeconds
    }
}

function Get-EffectiveCounterPauseSeconds {
    [CmdletBinding()]
    param()

    $pausedSeconds = $script:TotalCounterPausedSeconds

    if ($script:CounterPaused -and $script:CounterPauseStartedAt) {
        $pausedSeconds += [int][Math]::Floor(
            ((Get-Date) - $script:CounterPauseStartedAt).TotalSeconds
        )
    }

    if ($pausedSeconds -lt 0) {
        $pausedSeconds = 0
    }

    return $pausedSeconds
}
