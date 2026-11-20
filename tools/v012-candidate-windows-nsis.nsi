; Commander V2 v0.12 candidate, self-contained current-user NSIS QA package.
Unicode true
Name "Commander V2"
!ifndef V012_STAGE
  !error "V012_STAGE required"
!endif
!ifndef V012_OUTPUT
  !error "V012_OUTPUT required"
!endif
OutFile "${V012_OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Commander V2"
RequestExecutionLevel user
ShowInstDetails show
ShowUninstDetails show
SetCompressor /SOLID lzma
Function .onInit
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\Commander V2"
  IfFileExists "$INSTDIR\*.*" 0 +2
    Abort "Existing Commander V2 installation must not be overwritten by fresh-install QA"
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Commander V2" "DisplayName"
  StrCmp "$0" "" +2 0
    Abort "Existing Commander V2 registration must not be overwritten"
FunctionEnd
Section "Commander V2 QA payload" SecMain
  SetOutPath "$INSTDIR"
  File /r "${V012_STAGE}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Commander V2" "DisplayName" "Commander V2"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Commander V2" "DisplayVersion" "0.12.0-rc.1"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Commander V2" "Publisher" "Commander V2 QA"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Commander V2" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Commander V2" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Commander V2" "NoRepair" 1
SectionEnd
Function un.onInit
  StrCpy $0 "$LOCALAPPDATA\Programs\Commander V2"
  StrCmp "$INSTDIR" "$0" +2 0
    Abort "Unrecognized install location; refuse recursive cleanup"
  ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Commander V2" "DisplayVersion"
  StrCmp "$1" "0.12.0-rc.1" +2 0
    Abort "Another release owns this install registration"
FunctionEnd
Section "Uninstall"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Commander V2"
  RMDir /r "$INSTDIR"
SectionEnd
