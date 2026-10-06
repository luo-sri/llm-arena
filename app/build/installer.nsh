; ============================================================
; 自定义 NSIS 安装 / 卸载脚本
;
; 编码说明（改这个文件前请先读）：
;   - 本文件由 makensis 以 UTF-8 读取，electron-builder 会传入 -INPUTCHARSET UTF8，
;     因此这里的简体中文保持 UTF-8 即可，不需要转码。
;   - 许可协议 build/license.txt 是在安装运行期被读取的，必须是 UTF-16LE，
;     由 scripts/prepare-license.mjs 在打包前自动生成 build/license.utf16le.txt。
;     直接把它改成 UTF-8 会导致许可协议页出现乱码。
; ============================================================

; ---------- 安装：许可协议页必须勾选同意才能继续 ----------
!define MUI_LICENSEPAGE_CHECKBOX
!define MUI_LICENSEPAGE_CHECKBOX_TEXT "我已阅读并同意上述《用户许可、隐私与免责协议》的全部条款"
!define MUI_LICENSEPAGE_TEXT_TOP "请完整阅读以下协议。勾选下方选项表示您已理解并同意全部条款，之后才能继续安装。"

; ---------- 卸载：展示清理清单并要求用户确认同意 ----------
;
; 变量必须声明在宏内部：本文件会被 electron-builder 同时包含进「安装器」和
; 「卸载器」两趟编译，而卸载页函数只在卸载器那趟里被插入。若在宏外声明，
; 安装器那趟就会因为「变量声明了却没人用」触发 NSIS warning 6001，
; 而 electron-builder 默认 warningsAsErrors=true，会直接把打包打断。
!macro customUnWelcomePage
  ; 卸载页「同意清理」勾选框状态
  Var unCleanupAgree

  UninstPage custom un.cleanupPageCreate un.cleanupPageLeave

  Function un.cleanupPageCreate
    !insertmacro MUI_HEADER_TEXT "卸载确认" "请确认将要清理的内容，勾选同意后才能继续卸载"

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0u 0u 100% 10u "卸载「${PRODUCT_NAME}」将清理以下由本软件创建的内容："
    Pop $1

    ${NSD_CreateLabel} 0u 12u 100% 56u "• 安装目录及全部程序文件：$INSTDIR$\r$\n• 开始菜单与桌面快捷方式$\r$\n• 本软件的本地数据目录：$APPDATA\${APP_FILENAME}$\r$\n　（含评测数据库、题库、模型配置、桌面端设置等）$\r$\n• 本软件的 Electron 缓存与安装器残留缓存$\r$\n• 本软件在注册表中的安装 / 卸载登记项"
    Pop $1

    ${NSD_CreateLabel} 0u 70u 100% 28u "以下内容不会被清理：$\r$\n• 安装本软件之前就已存在于系统中的其他软件与配置$\r$\n• 您手动导出的配置备份文件（例如下载目录中的 JSON 备份）"
    Pop $1

    ${NSD_CreateCheckbox} 0u 102u 100% 12u "我已知悉并同意清理上述内容（不勾选将无法卸载）"
    Pop $unCleanupAgree
    ${NSD_SetState} $unCleanupAgree ${BST_UNCHECKED}
    ${NSD_OnClick} $unCleanupAgree un.cleanupAgreeToggle

    ; 未勾选前禁用继续按钮，避免未确认就进入卸载流程
    GetDlgItem $0 $HWNDPARENT 1
    EnableWindow $0 0

    nsDialogs::Show
  FunctionEnd

  Function un.cleanupAgreeToggle
    Pop $1
    ${NSD_GetState} $unCleanupAgree $0
    GetDlgItem $1 $HWNDPARENT 1
    ${If} $0 == ${BST_CHECKED}
      EnableWindow $1 1
    ${Else}
      EnableWindow $1 0
    ${EndIf}
  FunctionEnd

  Function un.cleanupPageLeave
    ; 点击「上一步」时不校验，允许用户返回
    ${If} ${Abort}
      Return
    ${EndIf}
    ${NSD_GetState} $unCleanupAgree $0
    ${If} $0 != ${BST_CHECKED}
      MessageBox MB_ICONEXCLAMATION|MB_OK "请先勾选「我已知悉并同意清理上述内容」，再点击继续按钮开始卸载。"
      Abort
    ${EndIf}
  FunctionEnd
!macroend

; ---------- 卸载兜底清理：标准卸载之外的残留 ----------
!macro customUnInstall
  ; NSIS 提权降级机制留下的安装器自复制缓存
  RMDir /r "$LOCALAPPDATA\llm-arena-updater"
  ; 本软件的卸载登记项（标准流程已删，此处防止异常残留）
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
!macroend