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
HTTP_RESOLVE_TIMEOUT_MS := EnvInt("PAPAGEI_HTTP_RESOLVE_TIMEOUT_MS", 2000)
HTTP_CONNECT_TIMEOUT_MS := EnvInt("PAPAGEI_HTTP_CONNECT_TIMEOUT_MS", 2000)
HTTP_SEND_TIMEOUT_MS := EnvInt("PAPAGEI_HTTP_SEND_TIMEOUT_MS", 5000)
HTTP_RECEIVE_TIMEOUT_MS := EnvInt("PAPAGEI_HTTP_RECEIVE_TIMEOUT_MS", 10000)
START_HTTP_RECEIVE_TIMEOUT_MS := EnvInt("PAPAGEI_START_HTTP_RECEIVE_TIMEOUT_MS", HTTP_RECEIVE_TIMEOUT_MS)
STOP_HTTP_RECEIVE_TIMEOUT_MS := EnvInt("PAPAGEI_STOP_HTTP_RECEIVE_TIMEOUT_MS", 120000)

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
  global START_HTTP_RECEIVE_TIMEOUT_MS
  if requestInFlight {
    return
  }
  requestInFlight := true
  result := HttpPost(BACKEND_URL "/start", START_HTTP_RECEIVE_TIMEOUT_MS)
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
  global STOP_HTTP_RECEIVE_TIMEOUT_MS
  if requestInFlight {
    return
  }
  requestInFlight := true
  result := HttpPost(BACKEND_URL "/stop?plain=1", STOP_HTTP_RECEIVE_TIMEOUT_MS)
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
  if result.status = 0 {
    SyncRecordingState()
    if recordingState {
      ShowStatus("Stop request timed out while transcribing")
      return
    }
    ShowStatus("Stop response timed out; transcript saved in history")
    return
  }
  ShowStatus(BuildError("Stop failed", result))
}

HttpPost(url, receiveTimeoutMs := 0) {
  global HTTP_RESOLVE_TIMEOUT_MS
  global HTTP_CONNECT_TIMEOUT_MS
  global HTTP_SEND_TIMEOUT_MS
  global HTTP_RECEIVE_TIMEOUT_MS
  if receiveTimeoutMs <= 0 {
    receiveTimeoutMs := HTTP_RECEIVE_TIMEOUT_MS
  }
  whr := ComObject("WinHttp.WinHttpRequest.5.1")
  whr.Open("POST", url, false)
  whr.SetRequestHeader("Content-Type", "application/json")
  whr.SetTimeouts(HTTP_RESOLVE_TIMEOUT_MS, HTTP_CONNECT_TIMEOUT_MS, HTTP_SEND_TIMEOUT_MS, receiveTimeoutMs)
  try {
    whr.Send("")
  } catch as e {
    return { ok: false, status: 0, body: "", error: e.Message }
  }
  return { ok: (whr.Status >= 200 && whr.Status < 300), status: whr.Status, body: whr.ResponseText, error: "" }
}

HttpGet(url, receiveTimeoutMs := 0) {
  global HTTP_RESOLVE_TIMEOUT_MS
  global HTTP_CONNECT_TIMEOUT_MS
  global HTTP_SEND_TIMEOUT_MS
  global HTTP_RECEIVE_TIMEOUT_MS
  if receiveTimeoutMs <= 0 {
    receiveTimeoutMs := HTTP_RECEIVE_TIMEOUT_MS
  }
  whr := ComObject("WinHttp.WinHttpRequest.5.1")
  whr.Open("GET", url, false)
  whr.SetTimeouts(HTTP_RESOLVE_TIMEOUT_MS, HTTP_CONNECT_TIMEOUT_MS, HTTP_SEND_TIMEOUT_MS, receiveTimeoutMs)
  try {
    whr.Send()
  } catch as e {
    return { ok: false, status: 0, body: "", error: e.Message }
  }
  return { ok: (whr.Status >= 200 && whr.Status < 300), status: whr.Status, body: whr.ResponseText, error: "" }
}

SyncRecordingState() {
  global recordingState
  state := QueryBackendRecordingState()
  if state = "true" {
    recordingState := true
    return
  }
  if state = "false" {
    recordingState := false
  }
}

QueryBackendRecordingState() {
  global BACKEND_URL
  result := HttpGet(BACKEND_URL "/health")
  if !result.ok {
    return ""
  }
  if RegExMatch(result.body, '"recording"\s*:\s*true') {
    return "true"
  }
  if RegExMatch(result.body, '"recording"\s*:\s*false') {
    return "false"
  }
  return ""
}

EnvInt(name, fallback) {
  raw := Trim(EnvGet(name))
  if raw = "" {
    return fallback
  }
  try value := Integer(raw)
  catch {
    return fallback
  }
  if value < 1 {
    return fallback
  }
  return value
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
