# Docker Desktop セットアップ

このリポジトリでは、Docker はプロジェクト専用に閉じず、Windows にグローバル導入した Docker Desktop を前提に使う。

## 現在の確認結果

- OS は `Windows 11 Home`。
- `docker --version` は未導入。
- `wsl --status` は未セットアップ状態。

## 公式前提

- Docker Desktop の Windows 利用は、Docker 公式の Windows インストール要件を満たす必要がある。
- Home エディションでは WSL 2 バックエンド前提で考える。
- Docker 公式は、WSL を少なくとも `2.1.5`、できれば最新へ更新することを推奨している。
- 仮想化支援機能が必要なので、BIOS/UEFI で virtualization が無効なら先に有効化する。

## グローバル導入手順

1. 管理者権限の PowerShell で WSL を入れる。

```powershell
wsl --install
```

2. 再起動後、WSL を更新する。

```powershell
wsl --update
wsl --version
```

3. Docker Desktop を公式インストーラーで入れる。

- GUI で入れる場合は Docker 公式の Windows install ページから Docker Desktop Installer を取得する。
- すでにインストーラーを持っているなら、公式手順どおり CLI でも入れられる。

```powershell
"Docker Desktop Installer.exe" install --always-run-service
```

4. Docker Desktop 初回起動後、WSL 2 backend を有効にした状態で起動完了を待つ。

## 導入確認

```powershell
docker version
docker info
wsl --status
```

`docker version` と `docker info` が通れば、以後はこのマシン全体で Docker を使える。

## このプロジェクトでの使い方

この bot は、secret を repo 内 `.env` ではなく Docker 外部の env file から受け取る想定。

### env file 例

`C:\secure\vrc-ai-bot.env` のような repo 外パスに置く。

```dotenv
DISCORD_BOT_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_OWNER_USER_IDS=
BOT_DB_PATH=./bot.sqlite
BOT_LOG_LEVEL=info
CODEX_APP_SERVER_CMD=codex app-server
BOT_WATCH_LOCATIONS_PATH=./config/watch-locations.json
```

### 初回ログイン

`codex login` は env file なしでも実行できるようにしてある。必要なら `-EnvFilePath` を付けてもよい。

```powershell
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\docker\codex-login.ps1 -BuildImage
```

### bot 起動

```powershell
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\docker\run-bot.ps1 -EnvFilePath C:\secure\vrc-ai-bot.env -BuildImage
```

依存を入れ直したいときは `-ForceInstall` を付ける。

```powershell
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\docker\run-bot.ps1 -EnvFilePath C:\secure\vrc-ai-bot.env -ForceInstall
```

### Codex 状態の初期化

```powershell
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\docker\reset-codex-home.ps1
```

### 常用の簡易起動

普段の起動は repo 直下の `start-vrc-ai-bot.bat` を実行すればよい。既定では
`%LOCALAPPDATA%\VRC-AI-Bot\vrc-ai-bot.env` を使い、Docker Desktop が起動途中なら
少し待ってから `vrc-ai-bot` コンテナをバックグラウンドで起動する。

```bat
start-vrc-ai-bot.bat
```

この経路は以下の動作にしてある。

- コンテナが未作成なら `docker run -d` で新規作成する。
- 停止済みなら `docker start` で同じ設定のまま再開する。
- すでに起動済みなら何もしない。

ログ確認は次で行える。

```powershell
docker logs -f vrc-ai-bot
```

## 補足

- `CODEX_HOME` は Docker volume に切り出される。
- `node_modules` と `pnpm store` も named volume なので、再起動のたびに全部入れ直す構成ではない。
- `config/watch-locations.json` は repo 内に残し、secret だけを repo 外へ出す。

## 参考

- Docker Desktop on Windows: https://docs.docker.com/desktop/setup/install/windows-install/
- Docker Desktop WSL 2 backend: https://docs.docker.com/desktop/features/wsl/
- Install WSL: https://learn.microsoft.com/windows/wsl/install
