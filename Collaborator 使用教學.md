# Collaborator 使用教學

Collaborator 是一個在**無限畫布**上組織終端機、檔案與程式碼的桌面應用，專為 AI Agent 開發工作流設計。

---

## 安裝與啟動（Windows）

### 前置需求

- **Node.js** 20+（LTS）
- **npm**
- **Visual Studio Build Tools**（含 C++ 桌面開發工作負載，用於編譯 `node-pty`）

### 開發模式啟動

```powershell
cd D:\AI\collab-public\collab-electron
npm install
npm run dev
```

> **注意**：`npm run dev` 會自動處理 `ELECTRON_RUN_AS_NODE` 環境變數（VS Code / Claude Code 環境必須清除此變數，否則 Electron 不會正確初始化）。

### 打包安裝程式

```powershell
npm run package:win           # NSIS 安裝程式 + Portable
npm run package:win-portable  # 僅 Portable .exe
```

產出位於 `dist/` 資料夾。

---

## 介面概覽

```
┌──────────────┬─────────────────────────────────────────┐
│              │                                         │
│   Navigator  │           無 限 畫 布                    │
│   (左側邊欄)  │                                         │
│              │   ┌─────────┐  ┌─────────┐              │
│  ◆ 檔案樹    │   │ Terminal │  │  Note   │              │
│  ◆ Workspace │   │  Tile   │  │  Tile   │              │
│    切換      │   └─────────┘  └─────────┘              │
│              │                                         │
│              │        ┌─────────┐                      │
│              │        │  Code   │                      │
│              │        │  Tile   │                      │
│              │        └─────────┘                      │
│              │                                         │
└──────────────┴─────────────────────────────────────────┘
```

---

## 畫布操作

| 操作 | 方式 |
|------|------|
| 平移畫布 | 滾輪滾動 / `Space` + 滑鼠拖曳 / 滑鼠中鍵拖曳 |
| 放大 | `Ctrl` + `=` |
| 縮小 | `Ctrl` + `-` |
| 重置縮放 | `Ctrl` + `0` |
| 全螢幕 | `F11` |
| 建立終端機 | **雙擊**畫布空白處 |
| 建立檔案 Tile | 從左側檔案樹**拖曳**檔案到畫布 |

> 畫布支援 33% ~ 100% 縮放，Tile 會自動對齊格線。

---

## Tile 類型

### Terminal Tile（終端機）

- **建立方式**：雙擊畫布空白處
- **功能**：完整的互動式終端，可執行 `node`、`git`、`npm`、`python` 等所有 CLI 工具
- **Windows 後端**：使用 ConPTY（不需要 tmux）
- **預設 Shell**：PowerShell 7（`pwsh.exe`）→ PowerShell 5（`powershell.exe`）→ `cmd.exe`（依可用性自動選擇）
- **歷史記錄**：最多 200,000 行 scrollback
- **調整大小**：拖曳 Tile 邊緣

### Note Tile（筆記）

- **建立方式**：從檔案樹拖入 `.md` 檔
- **功能**：Markdown 所見即所得編輯器
- **支援**：
  - 標題、粗體、斜體、清單、表格
  - 程式碼區塊（語法高亮）
  - 數學公式（KaTeX，`$...$` 行內 / `$$...$$` 區塊）
  - Wikilink（`[[檔案名]]` 雙向連結）
- **儲存**：自動同步到磁碟檔案

### Code Tile（程式碼）

- **建立方式**：從檔案樹拖入程式碼檔案（`.ts`、`.js`、`.py`、`.json` 等）
- **功能**：Monaco Editor（與 VS Code 相同的編輯器核心）
- **支援**：語法高亮、行號、搜尋取代
- **儲存**：自動同步到磁碟檔案

### Image Tile（圖片）

- **建立方式**：從檔案樹拖入圖片（`.png`、`.jpg`、`.gif`、`.svg` 等）
- **功能**：唯讀圖片預覽
- **縮圖**：自動產生，快取在 `~/.collaborator/` 下

---

## 左側導覽列（Navigator）

### 檔案樹

- 顯示當前 Workspace 的所有檔案與資料夾
- 支援**搜尋**：在頂部搜尋框輸入關鍵字快速定位
- 支援**排序**：按名稱、修改時間排序
- **拖放**：拖曳檔案到畫布自動建立對應 Tile
- 自動忽略 `.gitignore` 中的檔案

### Workspace 切換

- 點擊導覽列頂部的 Workspace 名稱可切換不同專案
- 點擊 `+` 新增 Workspace（選擇本機資料夾）
- 每個 Workspace 有獨立的畫布狀態

---

## 快捷鍵一覽

| 快捷鍵 | 功能 |
|--------|------|
| `Ctrl` + `=` | 放大畫布 |
| `Ctrl` + `-` | 縮小畫布 |
| `Ctrl` + `0` | 重置縮放至 100% |
| `Space` + 拖曳 | 平移畫布 |
| `F11` | 全螢幕切換 |
| 雙擊畫布 | 新建終端機 Tile |
| 雙擊 Tile 標題 | 重新命名 |
| `Ctrl` + `N` | 新建視窗 |

---

## 資料儲存

所有資料存在本機，**無需帳號**，**無雲端上傳**。

| 路徑 | 說明 |
|------|------|
| `~/.collaborator/` | 應用程式資料根目錄 |
| `~/.collaborator/dev/` | 開發模式資料（`npm run dev` 時使用） |
| `canvas-state.json` | 畫布上所有 Tile 的位置、大小、狀態 |
| `config.json` | Workspace 列表、視窗位置、主題設定 |

> `~` 在 Windows 上為 `C:\Users\<使用者名稱>`

---

## JSON-RPC 整合（外部工具 / AI Agent）

Collaborator 提供 JSON-RPC 2.0 介面，讓外部工具可以操控畫布：

- **Windows**：Named Pipe `\\.\pipe\collaborator-ipc`
- **macOS/Linux**：Unix Socket `~/.collaborator/ipc.sock`

可用操作包含：建立/關閉 Tile、寫入終端、讀取檔案等。

---

## Windows 特有注意事項

### ELECTRON_RUN_AS_NODE

在 VS Code 終端或 Claude Code 環境中，`ELECTRON_RUN_AS_NODE=1` 會導致 Electron 以純 Node.js 模式運行（不初始化 GUI）。`npm run dev` 已自動處理此問題。

若手動啟動遇到錯誤，請先清除：
```powershell
$env:ELECTRON_RUN_AS_NODE = ""
```

### ESM / CJS 相容性

Electron 28 內建 Node.js v18，ESM loader 無法從 CJS 模組提取 named exports。Build 系統已包含自動修補（`fixElectronImportsPlugin`），將：
```javascript
import { app, BrowserWindow } from "electron";
```
轉換為：
```javascript
import _electron from "electron";
const { app, BrowserWindow } = _electron;
```

### 終端機限制

- **無 session 持久化**：關閉 app 後終端 session 消失（macOS 透過 tmux 可保留）
- **無 scrollback 恢復**：重連 session 時緩衝區為空
- **PowerShell 5 啟動慢**：建議安裝 [PowerShell 7](https://github.com/PowerShell/PowerShell/releases)（`pwsh.exe`）

### node-pty 編譯

若 `npm install` 時 `electron-rebuild` 失敗：
1. 確認已安裝 **Visual Studio Build Tools**（含 C++ 桌面開發）
2. 若出現 Spectre 錯誤，在 VS Installer 中安裝 Spectre-mitigated libraries

---

## 常用操作範例

### 建立 AI Agent 開發環境

1. 啟動 Collaborator（`npm run dev`）
2. 點擊 `+` 新增 Workspace，選擇你的專案資料夾
3. 雙擊畫布建立 **Terminal Tile**，執行 AI Agent
4. 從檔案樹拖入 **config.json** 和 **README.md** 到畫布
5. 同時觀察 Agent 輸出、設定檔和文件

### 多終端機工作流

1. 雙擊建立第一個 Terminal → 執行 `npm run dev`（開發伺服器）
2. 雙擊建立第二個 Terminal → 執行 `npm test -- --watch`（測試）
3. 雙擊建立第三個 Terminal → 執行 `git` 操作
4. 拖曳排列，一目了然

### 知識庫整理

1. 新增 Workspace 指向筆記資料夾
2. 拖入多個 `.md` 檔到畫布
3. 利用 `[[wikilink]]` 建立雙向連結
4. 畫布上空間排列，視覺化知識結構

---

## 關閉方式

- 直接關閉視窗
- 或終止進程：
  ```powershell
  taskkill /F /IM electron.exe
  ```
