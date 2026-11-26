; Skyport uninstall cleanup. Skipped during in-place updates so nothing is lost on upgrade.
!include "FileFunc.nsh"

!macro NSIS_HOOK_POSTUNINSTALL
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/UPDATE" $R1
  IfErrors 0 skyport_done

  ; encrypted database, its DPAPI-wrapped key, logs, webview data
  RMDir /r "$LOCALAPPDATA\app.skyport.desktop"
  RMDir /r "$APPDATA\app.skyport.desktop"
  ; "Start with Windows" entry
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Skyport"

  ; the cache can hold edits not yet uploaded, so ask (default: keep)
  ReadRegStr $R2 HKCU "Software\Skyport" "CacheDir"
  StrCmp $R2 "" skyport_reg
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete Skyport's local cache?$\r$\n$\r$\n$R2$\r$\n$\r$\nAny changes that haven't finished uploading to OneDrive will be lost." /SD IDNO IDNO skyport_reg
  RMDir /r "$R2"
  skyport_reg:
  DeleteRegKey HKCU "Software\Skyport"
  skyport_done:
!macroend
