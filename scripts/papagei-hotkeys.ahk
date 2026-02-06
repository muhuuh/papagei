#Requires AutoHotkey v2.0
#SingleInstance Force
#Warn
#MaxThreadsPerHotkey 1

BACKEND_URL := EnvGet("PAPAGEI_BACKEND_URL")
if (BACKEND_URL = "") {
  BACKEND_URL := "http://127.0.0.1:4380"
}
HOTKEY_TOGGLE := "^+Space"
AUTO_PASTE := true
AUTO_PASTE_DELAY_MS := 80

global requestInFlight := false
global recordingState := false

Hotkey(HOTKEY_TOGGLE, ToggleRecording)

ShowStatus("Papagei hotkeys active")

ToggleRecording(*) {
  global recordingState
  DebounceHotkey()
  if recordingState {
    StopRecording()
  } else {
    StartRecording(true)
  }
}

StartRecording(fromToggle := false, *) {
  global requestInFlight
  global recordingState
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
    if fromToggle {
      StopRecording()
      return
    }
    ShowStatus("Already recording")
    return
  }
  ShowStatus(BuildError("Start failed", result))
}

StopRecording(*) {
  global requestInFlight
  global recordingState
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
      if AUTO_PASTE {
        Sleep(AUTO_PASTE_DELAY_MS)
        Send("^v")
        ShowStatus("Transcript pasted")
      } else {
        ShowStatus("Transcript copied")
      }
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
