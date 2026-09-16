import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export async function GET() {
  try {
    const isWindows = os.platform() === "win32";
    const username = os.userInfo().username || process.env.USERNAME || "Administrator";
    
    let detectedPath = "";
    let exists = false;

    if (isWindows) {
      const drives = ["C", "D", "E", "F", "G", "H", "I"];
      const commonDirs = [
        "剪映/JianyingPro Drafts",
        "JianyingPro Drafts",
        "剪映",
        "JianyingProDrafts",
        "Jianying/Drafts",
        "com.lanying.editor.draft",
        "com.lveditor.draft"
      ];

      let foundCustom = false;
      for (const drive of drives) {
        for (const dir of commonDirs) {
          const checkPath = `${drive}:/${dir}`;
          try {
            if (fs.existsSync(checkPath)) {
              detectedPath = checkPath.replace(/\\/g, "/");
              exists = true;
              foundCustom = true;
              break;
            }
          } catch {}
        }
        if (foundCustom) break;
      }

      if (!foundCustom) {
        // Check default AppData path
        const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
        const defaultPath = path.join(localAppData, "JianyingPro", "User Data", "Projects", "com.lanying.editor.draft");
        try {
          if (fs.existsSync(defaultPath)) {
            detectedPath = defaultPath.replace(/\\/g, "/");
            exists = true;
          } else {
            // Fallback standard path format
            detectedPath = `C:/Users/${username}/AppData/Local/JianyingPro/User Data/Projects/com.lanying.editor.draft`;
          }
        } catch {
          detectedPath = `C:/Users/${username}/AppData/Local/JianyingPro/User Data/Projects/com.lanying.editor.draft`;
        }
      }
    } else {
      // macOS Jianying path
      const defaultMacPath = path.join(os.homedir(), "Library", "Containers", "com.lemon.lv", "Data", "Library", "Application Support", "com.lemon.lv", "Projects", "g_drafts");
      if (fs.existsSync(defaultMacPath)) {
        detectedPath = defaultMacPath.replace(/\\/g, "/");
        exists = true;
      } else {
        detectedPath = `/Users/${username}/Library/Containers/com.lemon.lv/Data/Library/Application Support/com.lemon.lv/Projects/g_drafts`;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        isWindows,
        username,
        detectedPath,
        exists,
        os: os.platform()
      }
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message
    });
  }
}
