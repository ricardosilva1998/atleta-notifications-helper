# Speech recognition — OpenAI Whisper API or Windows SAPI fallback
# Usage: powershell -File speechWorker.ps1 "C:\path\to\audio.wav" ["api-key"]
param([string]$wavPath, [string]$apiKey)

$ErrorActionPreference = "Continue"

if (-not $wavPath -or -not (Test-Path $wavPath)) {
    [Console]::Error.WriteLine("ERROR: WAV file not found: $wavPath")
    [Console]::Out.WriteLine("")
    [Console]::Out.Flush()
    exit 1
}

# OpenAI Whisper API
if ($apiKey -and $apiKey.Length -gt 10) {
    [Console]::Error.WriteLine("USING: OpenAI Whisper API")
    try {
        $uri = "https://api.openai.com/v1/audio/transcriptions"
        $boundary = [System.Guid]::NewGuid().ToString()
        $fileBytes = [System.IO.File]::ReadAllBytes($wavPath)
        $fileName = [System.IO.Path]::GetFileName($wavPath)

        $bodyLines = @(
            "--$boundary",
            "Content-Disposition: form-data; name=`"file`"; filename=`"$fileName`"",
            "Content-Type: audio/wav",
            "",
            ""
        )
        $modelLines = @(
            "--$boundary",
            "Content-Disposition: form-data; name=`"model`"",
            "",
            "whisper-1",
            "--$boundary",
            "Content-Disposition: form-data; name=`"language`"",
            "",
            "en",
            "--$boundary--"
        )

        $headerBytes = [System.Text.Encoding]::UTF8.GetBytes(($bodyLines -join "`r`n"))
        $footerBytes = [System.Text.Encoding]::UTF8.GetBytes("`r`n" + ($modelLines -join "`r`n"))

        $bodyStream = New-Object System.IO.MemoryStream
        $bodyStream.Write($headerBytes, 0, $headerBytes.Length)
        $bodyStream.Write($fileBytes, 0, $fileBytes.Length)
        $bodyStream.Write($footerBytes, 0, $footerBytes.Length)
        $bodyData = $bodyStream.ToArray()
        $bodyStream.Dispose()

        $headers = @{
            "Authorization" = "Bearer $apiKey"
        }

        $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers `
            -ContentType "multipart/form-data; boundary=$boundary" `
            -Body $bodyData -TimeoutSec 15

        $text = if ($response.text) { $response.text.Trim() } else { "" }
        [Console]::Error.WriteLine("RESULT: '$text'")
        [Console]::Out.WriteLine($text)
        [Console]::Out.Flush()
    } catch {
        [Console]::Error.WriteLine("API_ERROR: " + $_.Exception.Message)
        [Console]::Out.WriteLine("")
        [Console]::Out.Flush()
    }
    exit 0
}

# Fallback: Windows SAPI
[Console]::Error.WriteLine("USING: Windows SAPI (no API key)")
try {
    Add-Type -AssemblyName System.Speech
    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $recognizer.SetInputToWaveFile($wavPath)
    $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
    $result = $recognizer.Recognize()

    if ($result -and $result.Text) {
        [Console]::Error.WriteLine("RESULT: '" + $result.Text + "' confidence=" + $result.Confidence)
        [Console]::Out.WriteLine($result.Text)
    } else {
        [Console]::Error.WriteLine("RESULT: empty")
        [Console]::Out.WriteLine("")
    }
    [Console]::Out.Flush()
    $recognizer.Dispose()
} catch {
    [Console]::Error.WriteLine("ERROR: " + $_.Exception.Message)
    [Console]::Out.WriteLine("")
    [Console]::Out.Flush()
}
