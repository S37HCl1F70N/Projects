# UI\EventHandlers.ps1
# Wire up control events and runtime behavior

# --------------------------------------------------
# Shared scriptblock: planned duration updater
# --------------------------------------------------
$script:updatePlannedDuration = {
    $range = Get-SelectedTimeRange
    $script:lblPlannedDurationValue.Text = Format-Seconds -TotalSeconds $range.TotalSeconds
}

# --------------------------------------------------
# Time picker events
# --------------------------------------------------
$script:dtpStart.Add_ValueChanged($script:updatePlannedDuration)
$script:dtpEnd.Add_ValueChanged($script:updatePlannedDuration)

# --------------------------------------------------
# Timer tick
# --------------------------------------------------
$script:timer.Add_Tick({
    if (-not $script:RunActive) {
        return
    }

    if ($script:PauseActive) {
        return
    }

    Update-Display

    $now = Get-Date

    if ($now -ge $script:SelectedEndTime) {
        Complete-Run
        return
    }

    if ($now -lt $script:SelectedStartTime) {
        $script:lblStatusValue.Text = 'Waiting to start'
    }
    elseif ($script:CounterPaused) {
        $script:lblStatusValue.Text = 'On break'
    }
    else {
        $script:lblStatusValue.Text = 'Running'
    }
})

# --------------------------------------------------
# Start button
# --------------------------------------------------
$script:btnStart.Add_Click({
    try {
        $range = Get-SelectedTimeRange

        if ($range.TotalSeconds -lt 1) {
            [System.Windows.Forms.MessageBox]::Show(
                'The selected duration is invalid.',
                $script:AppName,
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning
            ) | Out-Null
            return
        }

        $script:SelectedStartTime = $range.StartTime
        $script:SelectedEndTime = $range.EndTime
        $script:RunActive = $true

        $script:PauseActive = $false
        $script:PauseStartedAt = $null

        $script:CounterPaused = $false
        $script:CounterPauseStartedAt = $null
        $script:TotalCounterPausedSeconds = 0
        $script:BreakIntervals.Clear()
        $script:CurrentBreakStart = $null

        $script:btnPause.Enabled = $true
        $script:btnPause.Text = 'Pause'
        $script:btnBreak.Enabled = $true
        $script:btnBreak.Text = 'Break'

        $now = Get-Date

        if ($now -ge $script:SelectedEndTime) {
            Complete-Run
            return
        }
        elseif ($now -lt $script:SelectedStartTime) {
            $script:lblStatusValue.Text = 'Waiting to start'
        }
        else {
            $script:lblStatusValue.Text = 'Running'
        }

        Update-Display
        $script:timer.Start()
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show(
            "Failed to start timer.`r`n`r`n$($_.Exception.Message)",
            $script:AppName,
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
})

# --------------------------------------------------
# Pause / Resume button
# --------------------------------------------------
$script:btnPause.Add_Click({
    try {
        if (-not $script:RunActive) {
            return
        }

        $now = Get-Date

        if (-not $script:PauseActive) {
            $script:PauseActive = $true
            $script:PauseStartedAt = $now
            $script:lblStatusValue.Text = 'Paused'
            $script:btnPause.Text = 'Resume'

            if ($script:timer) {
                $script:timer.Stop()
            }
        }
        else {
            $pauseDuration = $now - $script:PauseStartedAt

            Shift-RunWindowForward -Offset $pauseDuration

            $script:PauseActive = $false
            $script:PauseStartedAt = $null
            $script:btnPause.Text = 'Pause'

            if ($now -lt $script:SelectedStartTime) {
                $script:lblStatusValue.Text = 'Waiting to start'
            }
            elseif ($script:CounterPaused) {
                $script:lblStatusValue.Text = 'On break'
            }
            else {
                $script:lblStatusValue.Text = 'Running'
            }

            Update-Display
            $script:timer.Start()
        }
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show(
            "Failed to change pause state.`r`n`r`n$($_.Exception.Message)",
            $script:AppName,
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
})

# --------------------------------------------------
# Break / Resume Pay button
# --------------------------------------------------
$script:btnBreak.Add_Click({
    try {
        if (-not $script:RunActive -or $script:PauseActive) {
            return
        }

        $now = Get-Date

        if ($now -lt $script:SelectedStartTime) {
            [System.Windows.Forms.MessageBox]::Show(
                'Thou canst not start a break before the selected work window begins.',
                $script:AppName,
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information
            ) | Out-Null
            return
        }

        if ($now -ge $script:SelectedEndTime) {
            Complete-Run
            return
        }

        if (-not $script:CounterPaused) {
            $script:CounterPaused = $true
            $script:CounterPauseStartedAt = $now
            $script:CurrentBreakStart = $now
            $script:lblStatusValue.Text = 'On break'
            $script:btnBreak.Text = 'Resume Pay'
        }
        else {
            $pausedSeconds = [int][Math]::Floor(
                ($now - $script:CounterPauseStartedAt).TotalSeconds
            )

            if ($pausedSeconds -lt 0) {
                $pausedSeconds = 0
            }

            $script:TotalCounterPausedSeconds += $pausedSeconds

            if ($script:CurrentBreakStart) {
                $script:BreakIntervals.Add([pscustomobject]@{
                    Start = $script:CurrentBreakStart
                    End   = $now
                })
            }

            $script:CounterPaused = $false
            $script:CounterPauseStartedAt = $null
            $script:CurrentBreakStart = $null

            if ($now -lt $script:SelectedStartTime) {
                $script:lblStatusValue.Text = 'Waiting to start'
            }
            else {
                $script:lblStatusValue.Text = 'Running'
            }

            $script:btnBreak.Text = 'Break'
        }

        Update-Display
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show(
            "Failed to change break state.`r`n`r`n$($_.Exception.Message)",
            $script:AppName,
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
})

# --------------------------------------------------
# Reset button
# --------------------------------------------------
$script:btnReset.Add_Click({
    try {
        Reset-RunState

        $now = Get-Date
        $script:dtpStart.Value = $now
        $script:dtpEnd.Value = $now.AddHours(1)

        & $script:updatePlannedDuration
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show(
            "Failed to reset the application.`r`n`r`n$($_.Exception.Message)",
            $script:AppName,
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
})

# --------------------------------------------------
# Form closing
# --------------------------------------------------
$script:form.Add_FormClosing({
    if ($script:timer) {
        $script:timer.Stop()
    }
})
