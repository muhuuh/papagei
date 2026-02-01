#Requires AutoHotkey v2.0
#SingleInstance Force
#Warn
#MaxThreadsPerHotkey 1

BACKEND_URL := "http://127.0.0.1:8000"
HOTKEY_START := "^#Space"
HOTKEY_STOP := "^#S"

global requestInFlight := false
global recordingState := false

Hotkey(HOTKEY_START, StartRecording)
Hotkey(HOTKEY_STOP, StopRecording)

ShowStatus("Papagei hotkeys active")

StartRecording(*) {
  global requestInFlight
  global recordingState
  DebounceHotkey()
  if requestInFlight {
    return
  }
  requestInFlight := true
  result := HttpPost(BACKEND_URL "/start")
  requestInFlight := false
  if result.ok {
    recordingState := true
    ShowStatus("Recording started")
    return
  }
  if result.status = 409 {
    recordingState := true
    ShowStatus("Already recording")
    return
  }
  ShowStatus(BuildError("Start failed", result))
}

StopRecording(*) {
  global requestInFlight
  global recordingState
  DebounceHotkey()
  if requestInFlight {
    return
  }
  requestInFlight := true
  result := HttpPost(BACKEND_URL "/stop?plain=1")
  requestInFlight := false
  if result.ok {
    text := Trim(result.body, " `t`r`n")
    recordingState := false
    if text != "" {
      A_Clipboard := text
      ClipWait(0.5)
      ShowStatus("Transcript copied")
    } else {
      ShowStatus("No transcript captured")
    }
    return
  }
  if result.status = 409 {
    recordingState := false
    ShowStatus("Not recording")
    return
  }
  ShowStatus(BuildError("Stop failed", result))
}

HttpPost(url) {
  whr := ComObject("WinHttp.WinHttpRequest.5.1")
  whr.Open("POST", url, false)
  whr.SetRequestHeader("Content-Type", "application/json")
  whr.SetTimeouts(2000, 2000, 5000, 5000)
  try {
    whr.Send("")
  } catch as e {
    return { ok: false, status: 0, body: "", error: e.Message }
  }
  return { ok: (whr.Status >= 200 && whr.Status < 300), status: whr.Status, body: whr.ResponseText, error: "" }
}

BuildError(prefix, result) {
  msg := prefix " (" result.status ")"
  if result.HasProp("error") && result.error {
    msg := msg ": " result.error
  } else if result.body {
    msg := msg ": " CleanBody(result.body)
  }
  return msg
}

CleanBody(text) {
  cleaned := RegExReplace(text, "\s+", " ")
  if StrLen(cleaned) > 120 {
    return SubStr(cleaned, 1, 120) "..."
  }
  return cleaned
}

DebounceHotkey() {
  trigger := GetTriggerKey()
  if trigger != "" {
    KeyWait(trigger)
  }
}

GetTriggerKey() {
  local hotkeyName := A_ThisHotkey
  if hotkeyName = "" {
    return ""
  }
  cleaned := RegExReplace(hotkeyName, "[\^\!\+\#\*\~\$]")
  cleaned := RegExReplace(cleaned, "Up$")
  return cleaned
}

ShowStatus(message, timeoutMs := 1400) {
  ToolTip(message, 20, 20)
  SetTimer(() => ToolTip(), -timeoutMs)
}
