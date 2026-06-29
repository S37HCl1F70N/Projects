# UI\MainForm.ps1
# Build the main WinForms interface and assign shared control references

# --------------------------------------------------
# Form
# --------------------------------------------------
$script:form = New-Object System.Windows.Forms.Form
$script:form.Text = $script:AppName
$script:form.Size = [System.Drawing.Size]::new($script:FormWidth, $script:FormHeight)
$script:form.StartPosition = 'CenterScreen'
$script:form.FormBorderStyle = 'FixedDialog'
$script:form.MaximizeBox = $false
$script:form.BackColor = $script:ColorBackground
$script:form.ForeColor = $script:ColorForeground

# --------------------------------------------------
# Time Pickers
# --------------------------------------------------
$lblStart = New-Object System.Windows.Forms.Label
$lblStart.Text = 'Start Time'
$lblStart.Location = [System.Drawing.Point]::new(25, 25)
$lblStart.Size = [System.Drawing.Size]::new(120, 25)
$lblStart.Font = $script:FontLabel
$lblStart.ForeColor = $script:ColorForeground
$script:form.Controls.Add($lblStart)

$script:dtpStart = New-Object System.Windows.Forms.DateTimePicker
$script:dtpStart.Location = [System.Drawing.Point]::new(155, 22)
$script:dtpStart.Size = [System.Drawing.Size]::new(150, 25)
$script:dtpStart.Format = [System.Windows.Forms.DateTimePickerFormat]::Custom
$script:dtpStart.CustomFormat = 'hh:mm tt'
$script:dtpStart.ShowUpDown = $true
$script:dtpStart.Font = $script:FontLabel
$script:form.Controls.Add($script:dtpStart)

$lblEnd = New-Object System.Windows.Forms.Label
$lblEnd.Text = 'End Time'
$lblEnd.Location = [System.Drawing.Point]::new(25, 60)
$lblEnd.Size = [System.Drawing.Size]::new(120, 25)
$lblEnd.Font = $script:FontLabel
$lblEnd.ForeColor = $script:ColorForeground
$script:form.Controls.Add($lblEnd)

$script:dtpEnd = New-Object System.Windows.Forms.DateTimePicker
$script:dtpEnd.Location = [System.Drawing.Point]::new(155, 57)
$script:dtpEnd.Size = [System.Drawing.Size]::new(150, 25)
$script:dtpEnd.Format = [System.Windows.Forms.DateTimePickerFormat]::Custom
$script:dtpEnd.CustomFormat = 'hh:mm tt'
$script:dtpEnd.ShowUpDown = $true
$script:dtpEnd.Font = $script:FontLabel
$script:form.Controls.Add($script:dtpEnd)

# --------------------------------------------------
# Buttons
# --------------------------------------------------
$script:btnStart = New-Object System.Windows.Forms.Button
$script:btnStart.Text = 'Start'
$script:btnStart.Location = [System.Drawing.Point]::new(330, 20)
$script:btnStart.Size = [System.Drawing.Size]::new(80, 30)
$script:form.Controls.Add($script:btnStart)

$script:btnPause = New-Object System.Windows.Forms.Button
$script:btnPause.Text = 'Pause'
$script:btnPause.Location = [System.Drawing.Point]::new(420, 20)
$script:btnPause.Size = [System.Drawing.Size]::new(100, 30)
$script:btnPause.Enabled = $false
$script:form.Controls.Add($script:btnPause)

$script:btnReset = New-Object System.Windows.Forms.Button
$script:btnReset.Text = 'Reset'
$script:btnReset.Location = [System.Drawing.Point]::new(330, 55)
$script:btnReset.Size = [System.Drawing.Size]::new(190, 30)
$script:form.Controls.Add($script:btnReset)

$script:btnBreak = New-Object System.Windows.Forms.Button
$script:btnBreak.Text = 'Break'
$script:btnBreak.Location = [System.Drawing.Point]::new(330, 90)
$script:btnBreak.Size = [System.Drawing.Size]::new(190, 30)
$script:btnBreak.Enabled = $false
$script:form.Controls.Add($script:btnBreak)

# --------------------------------------------------
# Status / Time Summary Labels
# --------------------------------------------------
$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text = 'Status:'
$lblStatus.Location = [System.Drawing.Point]::new(25, 145)
$lblStatus.Size = [System.Drawing.Size]::new(130, 25)
$lblStatus.Font = $script:FontLabel
$lblStatus.ForeColor = $script:ColorForeground
$script:form.Controls.Add($lblStatus)

$script:lblStatusValue = New-Object System.Windows.Forms.Label
$script:lblStatusValue.Text = 'Idle'
$script:lblStatusValue.Location = [System.Drawing.Point]::new(160, 145)
$script:lblStatusValue.Size = [System.Drawing.Size]::new(240, 25)
$script:lblStatusValue.Font = $script:FontValue
$script:lblStatusValue.ForeColor = $script:ColorForeground
$script:form.Controls.Add($script:lblStatusValue)

$lblPlannedDuration = New-Object System.Windows.Forms.Label
$lblPlannedDuration.Text = 'Planned Duration:'
$lblPlannedDuration.Location = [System.Drawing.Point]::new(25, 175)
$lblPlannedDuration.Size = [System.Drawing.Size]::new(130, 25)
$lblPlannedDuration.Font = $script:FontLabel
$lblPlannedDuration.ForeColor = $script:ColorForeground
$script:form.Controls.Add($lblPlannedDuration)

$script:lblPlannedDurationValue = New-Object System.Windows.Forms.Label
$script:lblPlannedDurationValue.Text = '00:00:00'
$script:lblPlannedDurationValue.Location = [System.Drawing.Point]::new(160, 175)
$script:lblPlannedDurationValue.Size = [System.Drawing.Size]::new(240, 25)
$script:lblPlannedDurationValue.Font = $script:FontValue
$script:lblPlannedDurationValue.ForeColor = $script:ColorForeground
$script:form.Controls.Add($script:lblPlannedDurationValue)

$lblElapsed = New-Object System.Windows.Forms.Label
$lblElapsed.Text = 'Elapsed:'
$lblElapsed.Location = [System.Drawing.Point]::new(25, 205)
$lblElapsed.Size = [System.Drawing.Size]::new(130, 25)
$lblElapsed.Font = $script:FontLabel
$lblElapsed.ForeColor = $script:ColorForeground
$script:form.Controls.Add($lblElapsed)

$script:lblElapsedValue = New-Object System.Windows.Forms.Label
$script:lblElapsedValue.Text = '00:00:00'
$script:lblElapsedValue.Location = [System.Drawing.Point]::new(160, 205)
$script:lblElapsedValue.Size = [System.Drawing.Size]::new(240, 25)
$script:lblElapsedValue.Font = $script:FontValue
$script:lblElapsedValue.ForeColor = $script:ColorForeground
$script:form.Controls.Add($script:lblElapsedValue)

$lblRemaining = New-Object System.Windows.Forms.Label
$lblRemaining.Text = 'Remaining:'
$lblRemaining.Location = [System.Drawing.Point]::new(25, 235)
$lblRemaining.Size = [System.Drawing.Size]::new(130, 25)
$lblRemaining.Font = $script:FontLabel
$lblRemaining.ForeColor = $script:ColorForeground
$script:form.Controls.Add($lblRemaining)

$script:lblRemainingValue = New-Object System.Windows.Forms.Label
$script:lblRemainingValue.Text = '00:00:00'
$script:lblRemainingValue.Location = [System.Drawing.Point]::new(160, 235)
$script:lblRemainingValue.Size = [System.Drawing.Size]::new(240, 25)
$script:lblRemainingValue.Font = $script:FontValue
$script:lblRemainingValue.ForeColor = $script:ColorForeground
$script:form.Controls.Add($script:lblRemainingValue)

$lblPaid = New-Object System.Windows.Forms.Label
$lblPaid.Text = 'Paid Time:'
$lblPaid.Location = [System.Drawing.Point]::new(25, 265)
$lblPaid.Size = [System.Drawing.Size]::new(130, 25)
$lblPaid.Font = $script:FontLabel
$lblPaid.ForeColor = $script:ColorForeground
$script:form.Controls.Add($lblPaid)

$script:lblPaidValue = New-Object System.Windows.Forms.Label
$script:lblPaidValue.Text = '00:00:00'
$script:lblPaidValue.Location = [System.Drawing.Point]::new(160, 265)
$script:lblPaidValue.Size = [System.Drawing.Size]::new(240, 25)
$script:lblPaidValue.Font = $script:FontValue
$script:lblPaidValue.ForeColor = $script:ColorForeground
$script:form.Controls.Add($script:lblPaidValue)

$lblBreak = New-Object System.Windows.Forms.Label
$lblBreak.Text = 'Break Time:'
$lblBreak.Location = [System.Drawing.Point]::new(25, 295)
$lblBreak.Size = [System.Drawing.Size]::new(130, 25)
$lblBreak.Font = $script:FontLabel
$lblBreak.ForeColor = $script:ColorForeground
$script:form.Controls.Add($lblBreak)

$script:lblBreakValue = New-Object System.Windows.Forms.Label
$script:lblBreakValue.Text = '00:00:00'
$script:lblBreakValue.Location = [System.Drawing.Point]::new(160, 295)
$script:lblBreakValue.Size = [System.Drawing.Size]::new(240, 25)
$script:lblBreakValue.Font = $script:FontValue
$script:lblBreakValue.ForeColor = $script:ColorForeground
$script:form.Controls.Add($script:lblBreakValue)

# --------------------------------------------------
# Rate / Counter
# --------------------------------------------------
$lblRate = New-Object System.Windows.Forms.Label
$lblRate.Text = ('Rate: ${0:N4}/hr  |  ${1:N8}/sec' -f $script:HourlyRate, $script:PerSecondRate)
$lblRate.Location = [System.Drawing.Point]::new(25, 330)
$lblRate.Size = [System.Drawing.Size]::new(450, 20)
$lblRate.Font = $script:FontSmall
$lblRate.ForeColor = $script:ColorMutedText
$script:form.Controls.Add($lblRate)

$lblCounter = New-Object System.Windows.Forms.Label
$lblCounter.Text = 'Counter'
$lblCounter.Location = [System.Drawing.Point]::new(25, 360)
$lblCounter.Size = [System.Drawing.Size]::new(100, 25)
$lblCounter.Font = $script:FontLabel
$lblCounter.ForeColor = $script:ColorForeground
$script:form.Controls.Add($lblCounter)

$script:lblCounterValue = New-Object System.Windows.Forms.Label
$script:lblCounterValue.Text = '$0.00'
$script:lblCounterValue.Location = [System.Drawing.Point]::new(25, 390)
$script:lblCounterValue.Size = [System.Drawing.Size]::new(280, 40)
$script:lblCounterValue.Font = $script:FontMoney
$script:lblCounterValue.ForeColor = $script:ColorCounter
$script:form.Controls.Add($script:lblCounterValue)

# --------------------------------------------------
# Progress Track
# --------------------------------------------------
$script:pnlProgressTrack = New-Object System.Windows.Forms.Panel
$script:pnlProgressTrack.Location = [System.Drawing.Point]::new(25, 445)
$script:pnlProgressTrack.Size = [System.Drawing.Size]::new(
    $script:ProgressTrackWidth,
    $script:ProgressTrackHeight
)
$script:pnlProgressTrack.BackColor = $script:ColorTrack
$script:pnlProgressTrack.BorderStyle = 'FixedSingle'
$script:form.Controls.Add($script:pnlProgressTrack)

$lblLegend = New-Object System.Windows.Forms.Label
$lblLegend.Text = 'Green = paid time   |   Red = break time   |   Dark = remaining'
$lblLegend.Location = [System.Drawing.Point]::new(25, 475)
$lblLegend.Size = [System.Drawing.Size]::new(430, 20)
$lblLegend.Font = $script:FontSmall
$lblLegend.ForeColor = $script:ColorMutedText
$script:form.Controls.Add($lblLegend)

# --------------------------------------------------
# Timer
# --------------------------------------------------
$script:timer = New-Object System.Windows.Forms.Timer
$script:timer.Interval = 1000
