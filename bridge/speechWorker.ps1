# Speech recognition worker for Atleta Bridge
# Communicates via stdin (START/STOP/EXIT) and stdout (READY/LISTENING/RESULT:text)
Add-Type -AssemblyName System.Speech

$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.SetInputToDefaultAudioDevice()
$recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))

$script:parts = @()

$recognizer.Add_SpeechRecognized({
    param($sender, $e)
    $script:parts += $e.Result.Text
})

[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()

while ($true) {
    $cmd = [Console]::In.ReadLine()
    if ($cmd -eq $null -or $cmd -eq "EXIT") { break }

    if ($cmd -eq "START") {
        $script:parts = @()
        try {
            $recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
            [Console]::Out.WriteLine("LISTENING")
            [Console]::Out.Flush()
        } catch {
            [Console]::Out.WriteLine("ERROR:" + $_.Exception.Message)
            [Console]::Out.Flush()
        }
    }
    elseif ($cmd -eq "STOP") {
        try { $recognizer.RecognizeAsyncCancel() } catch {}
        Start-Sleep -Milliseconds 100
        $text = ($script:parts -join " ").Trim()
        [Console]::Out.WriteLine("RESULT:" + $text)
        [Console]::Out.Flush()
    }
}

try { $recognizer.Dispose() } catch {}
