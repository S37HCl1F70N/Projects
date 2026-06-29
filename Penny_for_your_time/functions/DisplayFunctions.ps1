# Functions\DisplayFunctions.ps1
# UI display update logic

function Update-Display {
    [CmdletBinding()]
    param()

    if (-not $script:RunActive -or -not $script:SelectedStartTime -or -not $script:SelectedEndTime) {
        return
    }

    $now = Get-Date

    $totalSeconds = [int][Math]::Floor(
        ($script:SelectedEndTime - $script:SelectedStartTime).TotalSeconds
    )

    if ($totalSeconds -lt 1) {
        $totalSeconds = 1
    }

    $rawElapsedSeconds = [int][Math]::Floor(
        ($now - $script:SelectedStartTime).TotalSeconds
    )

    if ($rawElapsedSeconds -lt 0) {
        $elapsedSeconds = 0
    }
    elseif ($rawElapsedSeconds -gt $totalSeconds) {
        $elapsedSeconds = $totalSeconds
    }
    else {
        $elapsedSeconds = $rawElapsedSeconds
    }

    $remainingSeconds = $totalSeconds - $elapsedSeconds
    if ($remainingSeconds -lt 0) {
        $remainingSeconds = 0
    }

    $breakSeconds = Get-EffectiveCounterPauseSeconds
    if ($breakSeconds -gt $elapsedSeconds) {
        $breakSeconds = $elapsedSeconds
    }

    $paidSeconds = $elapsedSeconds - $breakSeconds
    if ($paidSeconds -lt 0) {
        $paidSeconds = 0
    }

    $currentValue = $paidSeconds * $script:PerSecondRate

    if ($script:lblElapsedValue) {
        $script:lblElapsedValue.Text = Format-Seconds -TotalSeconds $elapsedSeconds
    }

    if ($script:lblRemainingValue) {
        $script:lblRemainingValue.Text = Format-Seconds -TotalSeconds $remainingSeconds
    }

    if ($script:lblBreakValue) {
        $script:lblBreakValue.Text = Format-Seconds -TotalSeconds $breakSeconds
    }

    if ($script:lblPaidValue) {
        $script:lblPaidValue.Text = Format-Seconds -TotalSeconds $paidSeconds
    }

    if ($script:lblCounterValue) {
        $script:lblCounterValue.Text = ('${0:N2}' -f $currentValue)
    }

    Update-CustomProgressBar -Now $now
}
