' Inventory Pro — no black console window. Double-click this icon.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
bat = root & "\Start-InventoryPro.bat"
If Not fso.FileExists(bat) Then
  MsgBox "Could not find Start-InventoryPro.bat in:" & vbCrLf & root, vbCritical, "Inventory Pro"
  WScript.Quit 1
End If
sh.Run """" & bat & """", 0, False
