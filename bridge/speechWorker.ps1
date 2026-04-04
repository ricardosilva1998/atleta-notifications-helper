# Speech recognition session for Atleta Bridge
# Spawned per PTT session. Starts listening immediately.
# Writes recognized text to stdout when stdin receives a line (STOP signal).
$ErrorActionPreference = "Continue"

try {
    Add-Type -AssemblyName System.Speech

    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine

    # Log engine info
    [Console]::Error.WriteLine("ENGINE: " + $recognizer.RecognizerInfo.Description)
    [Console]::Error.WriteLine("CULTURE: " + $recognizer.RecognizerInfo.Culture.Name)

    # Log audio input info
    try {
        $recognizer.SetInputToDefaultAudioDevice()
        [Console]::Error.WriteLine("AUDIO: Default device set OK")
    } catch {
        [Console]::Error.WriteLine("AUDIO_ERROR: " + $_.Exception.Message)
        [Console]::Out.WriteLine("")
        [Console]::Out.Flush()
        exit 1
    }

    $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))

    # Collect recognized text
    $global:results = [System.Collections.ArrayList]::Synchronized((New-Object System.Collections.ArrayList))

    $recognizer.Add_SpeechRecognized({
        param($sender, $e)
        try {
            if ($e.Result -and $e.Result.Text) {
                [void]$global:results.Add($e.Result.Text)
                [Console]::Error.WriteLine("HEARD: " + $e.Result.Text + " (confidence=" + $e.Result.Confidence + ")")
            }
        } catch {}
    })

    $recognizer.Add_SpeechDetected({
        param($sender, $e)
        try {
            [Console]::Error.WriteLine("SPEECH_DETECTED")
        } catch {}
    })

    $recognizer.Add_SpeechHypothesized({
        param($sender, $e)
        try {
            [Console]::Error.WriteLine("HYPOTHESIS: " + $e.Result.Text)
        } catch {}
    })

    $recognizer.Add_AudioStateChanged({
        param($sender, $e)
        try {
            [Console]::Error.WriteLine("AUDIO_STATE: " + $e.AudioState.ToString())
        } catch {}
    })

    # Start listening
    $recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
    [Console]::Out.WriteLine("LISTENING")
    [Console]::Out.Flush()
    [Console]::Error.WriteLine("RECOGNITION_STARTED")

    # Wait for STOP signal on stdin (blocks until line received)
    try {
        $null = [Console]::In.ReadLine()
    } catch {
        [Console]::Error.WriteLine("STDIN_ERROR: " + $_.Exception.Message)
    }

    # Stop and collect results
    [Console]::Error.WriteLine("STOPPING")
    try { $recognizer.RecognizeAsyncCancel() } catch {}
    Start-Sleep -Milliseconds 300

    $text = ($global:results -join " ").Trim()
    [Console]::Error.WriteLine("FINAL_TEXT: '" + $text + "' (parts=" + $global:results.Count + ")")
    [Console]::Out.WriteLine($text)
    [Console]::Out.Flush()

    try { $recognizer.Dispose() } catch {}
} catch {
    [Console]::Error.WriteLine("FATAL: " + $_.Exception.ToString())
    [Console]::Out.WriteLine("")
    [Console]::Out.Flush()
    exit 1
}
