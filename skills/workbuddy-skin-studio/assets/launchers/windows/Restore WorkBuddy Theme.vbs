Option Explicit

Dim fso, shell, root, scriptPath, command, exitCode
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
scriptPath = fso.BuildPath(root, "targets\windows\restore.ps1")
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Quote(scriptPath)
exitCode = shell.Run(command, 0, True)
If exitCode <> 0 Then
  MsgBox "WorkBuddy theme restore failed. Confirm WorkBuddy is installed, then try again.", 16, "WorkBuddy Theme"
End If

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
