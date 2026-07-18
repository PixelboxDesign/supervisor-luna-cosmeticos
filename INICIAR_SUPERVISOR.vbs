Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c cd /d ""F:\luna_cosmeticos\supervisor-luna\electron"" && npx electron . > ""F:\luna_cosmeticos\supervisor-luna\backend\logs\electron.log"" 2>&1", 0, False
