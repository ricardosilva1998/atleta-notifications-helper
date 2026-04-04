# Speech recognition session for Atleta Bridge
# Spawned per PTT session. Starts listening immediately.
# Writes recognized text to stdout when stdin receives a line (STOP signal).
$ErrorActionPreference = "Stop"

try {
    Add-Type -AssemblyName System.Speech

    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine

    # Log engine info
    [Console]::Error.WriteLine("ENGINE: " + $recognizer.RecognizerInfo.Description)
    [Console]::Error.WriteLine("CULTURE: " + $recognizer.RecognizerInfo.Culture.Name)

    $recognizer.SetInputToDefaultAudioDevice()
    $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))

    # Collect recognized text in a synchronized list
    $global:results = [System.Collections.ArrayList]::Synchronized((New-Object System.Collections.ArrayList))

    $recognizer.Add_SpeechRecognized({
        param($sender, $e)
        if ($e.Result -and $e.Result.Text) {
            [void]$global:results.Add($e.Result.Text)
            [Console]::Error.WriteLine("HEARD: " + $e.Result.Text)
        }
    })

    $recognizer.Add_SpeechDetected({
        param($sender, $e)
        [Console]::Error.WriteLine("SPEECH_DETECTED at " + $e.AudioPosition.TotalSeconds.ToString("F1") + "s")
    })

    # Start listening
    $recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
    [Console]::Out.WriteLine("LISTENING")
    [Console]::Out.Flush()
    [Console]::Error.WriteLine("RECOGNITION_STARTED")

    # Wait for STOP signal on stdin
    $null = [Console]::In.ReadLine()

    # Stop and collect results
    [Console]::Error.WriteLine("STOPPING")
    try { $recognizer.RecognizeAsyncCancel() } catch {}
    Start-Sleep -Milliseconds 300

    $text = ($global:results -join " ").Trim()
    [Console]::Error.WriteLine("FINAL_TEXT: '" + $text + "' (parts=" + $global:results.Count + ")")
    [Console]::Out.WriteLine($text)
    [Console]::Out.Flush()

    $recognizer.Dispose()
} catch {
    [Console]::Error.WriteLine("ERROR: " + $_.Exception.Message)
    [Console]::Out.WriteLine("")
    [Console]::Out.Flush()
}
