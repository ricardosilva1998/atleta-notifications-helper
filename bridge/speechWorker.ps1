# Speech recognition from WAV file for Atleta Bridge
# Usage: powershell -File speechWorker.ps1 "C:\path\to\audio.wav"
param([string]$wavPath)

$ErrorActionPreference = "Continue"

if (-not $wavPath -or -not (Test-Path $wavPath)) {
    [Console]::Error.WriteLine("ERROR: WAV file not found: $wavPath")
    [Console]::Out.WriteLine("")
    [Console]::Out.Flush()
    exit 1
}

try {
    Add-Type -AssemblyName System.Speech
    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    [Console]::Error.WriteLine("ENGINE: " + $recognizer.RecognizerInfo.Description)

    $recognizer.SetInputToWaveFile($wavPath)
    $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))

    [Console]::Error.WriteLine("TRANSCRIBING: $wavPath")
    $result = $recognizer.Recognize()

    if ($result -and $result.Text) {
        [Console]::Error.WriteLine("RESULT: '" + $result.Text + "' confidence=" + $result.Confidence)
        [Console]::Out.WriteLine($result.Text)
    } else {
        [Console]::Error.WriteLine("RESULT: empty (no speech detected)")
        [Console]::Out.WriteLine("")
    }
    [Console]::Out.Flush()
    $recognizer.Dispose()
} catch {
    [Console]::Error.WriteLine("ERROR: " + $_.Exception.Message)
    [Console]::Out.WriteLine("")
    [Console]::Out.Flush()
}
