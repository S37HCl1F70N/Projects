# Functions\ProgressBarFunctions.ps1
# Chronological stacked progress bar rendering

function Get-RenderBreakIntervals {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [datetime]$Now
    )

    $intervals = @()

    if ($script:BreakIntervals.Count -gt 0) {
        $intervals += $script:BreakIntervals
    }

    if ($script:CounterPaused -and $script:CurrentBreakStart) {
        $intervals += [pscustomobject]@{
            Start = $script:CurrentBreakStart
            End   = $Now
        }
    }

    return $intervals | Sort-Object Start
}

function Add-ProgressSegmentPanel {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [int]$X,

        [Parameter(Mandatory)]
        [int]$Width,

        [Parameter(Mandatory)]
        [System.Drawing.Color]$Color
    )

    if ($Width -le 0) {
        return
    }

    $segmentPanel = New-Object System.Windows.Forms.Panel
    $segmentPanel.Location = [System.Drawing.Point]::new($X, 0)
    $segmentPanel.Size = [System.Drawing.Size]::new($Width, $script:pnlProgressTrack.ClientSize.Height)
    $segmentPanel.BackColor = $Color

    $script:pnlProgressTrack.Controls.Add($segmentPanel)
}

function Update-CustomProgressBar {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [datetime]$Now
    )

    if (-not $script:pnlProgressTrack) {
        throw 'Progress track control has not been initialized.'
    }

    if (-not $script:SelectedStartTime -or -not $script:SelectedEndTime) {
        $script:pnlProgressTrack.Controls.Clear()
        return
    }

    $windowStart = $script:SelectedStartTime
    $windowEnd = $script:SelectedEndTime

    if ($windowEnd -le $windowStart) {
        $script:pnlProgressTrack.Controls.Clear()
        return
    }

    $renderEnd = $Now
    if ($renderEnd -lt $windowStart) {
        $renderEnd = $windowStart
    }
    elseif ($renderEnd -gt $windowEnd) {
        $renderEnd = $windowEnd
    }

    $totalSeconds = [double]($windowEnd - $windowStart).TotalSeconds
    if ($totalSeconds -le 0) {
        $totalSeconds = 1
    }

    $trackWidth = $script:pnlProgressTrack.ClientSize.Width
    $script:pnlProgressTrack.Controls.Clear()

    $breakIntervals = Get-RenderBreakIntervals -Now $Now
    $cursor = $windowStart

    foreach ($interval in $breakIntervals) {
        $breakStart = $interval.Start
        $breakEnd = $interval.End

        if ($breakEnd -le $windowStart -or $breakStart -ge $renderEnd) {
            continue
        }

        if ($breakStart -lt $windowStart) {
            $breakStart = $windowStart
        }

        if ($breakEnd -gt $renderEnd) {
            $breakEnd = $renderEnd
        }

        if ($breakEnd -le $breakStart) {
            continue
        }

        if ($breakStart -gt $cursor) {
            $paidStartX = [int][Math]::Round((($cursor - $windowStart).TotalSeconds / $totalSeconds) * $trackWidth)
            $paidEndX = [int][Math]::Round((($breakStart - $windowStart).TotalSeconds / $totalSeconds) * $trackWidth)
            $paidWidth = $paidEndX - $paidStartX

            Add-ProgressSegmentPanel -X $paidStartX -Width $paidWidth -Color $script:ColorPaid
        }

        $breakStartX = [int][Math]::Round((($breakStart - $windowStart).TotalSeconds / $totalSeconds) * $trackWidth)
        $breakEndX = [int][Math]::Round((($breakEnd - $windowStart).TotalSeconds / $totalSeconds) * $trackWidth)
        $breakWidth = $breakEndX - $breakStartX

        Add-ProgressSegmentPanel -X $breakStartX -Width $breakWidth -Color $script:ColorBreak

        if ($breakEnd -gt $cursor) {
            $cursor = $breakEnd
        }
    }

    if ($renderEnd -gt $cursor) {
        $paidStartX = [int][Math]::Round((($cursor - $windowStart).TotalSeconds / $totalSeconds) * $trackWidth)
        $paidEndX = [int][Math]::Round((($renderEnd - $windowStart).TotalSeconds / $totalSeconds) * $trackWidth)
        $paidWidth = $paidEndX - $paidStartX

        Add-ProgressSegmentPanel -X $paidStartX -Width $paidWidth -Color $script:ColorPaid
    }
}
