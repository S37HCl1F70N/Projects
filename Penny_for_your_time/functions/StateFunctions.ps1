# Functions\StateFunctions.ps1
# Runtime state transitions and reset/completion behavior

function Shift-RunWindowForward {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [timespan]$Offset
    )

    if ($Offset.TotalSeconds -le 0) {
        return
    }

    if ($script:SelectedStartTime) {
        $script:SelectedStartTime = $script:SelectedStartTime.Add($Offset)
    }

    if ($script:SelectedEndTime) {
        $script:SelectedEndTime = $script:SelectedEndTime.Add($Offset)
    }

    if ($script:CurrentBreakStart) {
        $script:CurrentBreakStart = $script:CurrentBreakStart.Add($Offset)
    }

    if ($script:BreakIntervals -and $script:BreakIntervals.Count -gt 0) {
        $shifted = New-Object System.Collections.Generic.List[object]

        foreach ($interval in $script:BreakIntervals) {
            $shifted.Add([pscustomobject]@{
                Start = $interval.Start.Add($Offset)
                End   = $interval.End.Add($Offset)
            })
        }

        $script:BreakIntervals.Clear()

        foreach ($interval in $shifted) {
            $script:BreakIntervals.Add($interval)
        }
    }
}

function Reset-RunState {
    [CmdletBinding()]
    param()

    $script:SelectedStartTime = $null
    $script:SelectedEndTime = $null
    $script:RunActive = $false

    $script:PauseActive = $false
    $script:PauseStartedAt = $null

    $script:CounterPaused = $false
    $script:CounterPauseStartedAt = $null
    $script:TotalCounterPausedSeconds = 0
    $script:CurrentBreakStart = $null

    if ($script:BreakIntervals) {
        $script:BreakIntervals.Clear()
    }

    if ($script:timer) {
        $script:timer.Stop()
    }

    if ($script:lblStatusValue) {
        $script:lblStatusValue.Text = 'Idle'
    }

    if ($script:lblElapsedValue) {
        $script:lblElapsedValue.Text = '00:00:00'
    }

    if ($script:lblRemainingValue) {
        $script:lblRemainingValue.Text = '00:00:00'
    }

    if ($script:lblPlannedDurationValue) {
        $script:lblPlannedDurationValue.Text = '00:00:00'
    }

    if ($script:lblBreakValue) {
        $script:lblBreakValue.Text = '00:00:00'
    }

    if ($script:lblPaidValue) {
        $script:lblPaidValue.Text = '00:00:00'
    }

    if ($script:lblCounterValue) {
        $script:lblCounterValue.Text = '$0.00'
    }

    if ($script:btnPause) {
        $script:btnPause.Text = 'Pause'
        $script:btnPause.Enabled = $false
    }

    if ($script:btnBreak) {
        $script:btnBreak.Text = 'Break'
        $script:btnBreak.Enabled = $false
    }

    if ($script:pnlProgressTrack) {
        $script:pnlProgressTrack.Controls.Clear()
    }
}

function Complete-Run {
    [CmdletBinding()]
    param()

    if ($script:timer) {
        $script:timer.Stop()
    }

    if ($script:CounterPaused -and $script:CurrentBreakStart) {
        $script:BreakIntervals.Add([pscustomobject]@{
            Start = $script:CurrentBreakStart
            End   = $script:SelectedEndTime
        })
        $script:CurrentBreakStart = $null
    }

    $script:RunActive = $false
    $script:PauseActive = $false
    $script:PauseStartedAt = $null
    $script:CounterPaused = $false
    $script:CounterPauseStartedAt = $null

    if ($script:btnPause) {
        $script:btnPause.Enabled = $false
        $script:btnPause.Text = 'Pause'
    }

    if ($script:btnBreak) {
        $script:btnBreak.Enabled = $false
        $script:btnBreak.Text = 'Break'
    }

    if ($script:lblStatusValue) {
        $script:lblStatusValue.Text = 'Complete'
    }

    $totalRunSeconds = 0
    if ($script:SelectedStartTime -and $script:SelectedEndTime) {
        $totalRunSeconds = [int][Math]::Max(
            0,
            ($script:SelectedEndTime - $script:SelectedStartTime).TotalSeconds
        )
    }

    $breakSeconds = Get-EffectiveCounterPauseSeconds
    if ($breakSeconds -gt $totalRunSeconds) {
        $breakSeconds = $totalRunSeconds
    }

    $paidSeconds = $totalRunSeconds - $breakSeconds
    if ($paidSeconds -lt 0) {
        $paidSeconds = 0
    }

    $finalValue = $paidSeconds * $script:PerSecondRate

    if ($script:lblElapsedValue) {
        $script:lblElapsedValue.Text = Format-Seconds -TotalSeconds $totalRunSeconds
    }

    if ($script:lblRemainingValue) {
        $script:lblRemainingValue.Text = '00:00:00'
    }

    if ($script:lblBreakValue) {
        $script:lblBreakValue.Text = Format-Seconds -TotalSeconds $breakSeconds
    }

    if ($script:lblPaidValue) {
        $script:lblPaidValue.Text = Format-Seconds -TotalSeconds $paidSeconds
    }

    if ($script:lblCounterValue) {
        $script:lblCounterValue.Text = ('${0:N2}' -f $finalValue)
    }

    Update-CustomProgressBar -Now $script:SelectedEndTime

    [System.Windows.Forms.MessageBox]::Show(
        "Timer complete.`r`n`r`nPaid time: $(Format-Seconds -TotalSeconds $paidSeconds)`r`nBreak time: $(Format-Seconds -TotalSeconds $breakSeconds)`r`nTotal earned: $('{0:N2}' -f $finalValue)",
        $script:AppName,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
}
