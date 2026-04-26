# Building VERT as a Desktop App

VERT can run as a fully **native desktop application** on Windows, macOS, and Linux thanks to [Tauri 2](https://tauri.app). The result is a self-contained executable that:

- runs **entirely offline** (no browser, no server needed for images / audio / documents)
- remembers its **window size and position** between sessions
- allows **drag-and-drop from the OS file explorer**
- saves converted files to a **custom folder** you choose in settings
- prevents opening **two instances** at the same time
- installs and feels like any other native app (Start Menu shortcut, `.app` bundle, `.deb` package…)

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
   - [All platforms](#all-platforms)
   - [Windows](#windows-specific)
   - [macOS](#macos-specific)
   - [Linux](#linux-specific)
2. [Clone & install dependencies](#2-clone--install-dependencies)
3. [Build the executable](#3-build-the-executable)
4. [Output files](#4-output-files)
5. [Running in development mode](#5-running-in-development-mode)
6. [Cross-compilation](#6-cross-compilation)
7. [What makes it feel native](#7-what-makes-it-feel-native)

---

## 1. Prerequisites

### All platforms

| Tool | Version | Install |
|------|---------|---------|
| **Node.js** | 18 or newer | https://nodejs.org |
| **npm** | bundled with Node.js | — |
| **Rust** | latest stable | https://rustup.rs |
| **Tauri CLI** | auto-installed via npm | — |

After installing Rust, make sure it is up to date:

```bash
rustup update stable
```

---

### Windows-specific

| Requirement | Notes |
|-------------|-------|
| **Microsoft C++ Build Tools** | Required by the Rust toolchain. Install via [Visual Studio Installer](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — select the "Desktop development with C++" workload. |
| **WebView2 Runtime** | Pre-installed on Windows 10 (version 1803+) and Windows 11. If missing, download from [Microsoft](https://developer.microsoft.com/en-us/microsoft-edge/webview2/). |

> **Tip:** If you already have Visual Studio 2019 or 2022 installed with C++ support, you already have everything you need.

---

### macOS-specific

Install the Xcode Command Line Tools (this provides `clang`, `make`, and related tools):

```bash
xcode-select --install
```

You also need the correct Rust target for Apple Silicon or Intel:

```bash
# Apple Silicon (M1/M2/M3/M4)
rustup target add aarch64-apple-darwin

# Intel Mac
rustup target add x86_64-apple-darwin

# Universal binary (both, optional)
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

---

### Linux-specific

Install the required system libraries. Commands depend on your distribution:

**Ubuntu / Debian / Linux Mint:**
```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf \
  libssl-dev \
  pkg-config \
  build-essential \
  curl \
  wget \
  file
```

**Fedora / RHEL / CentOS:**
```bash
sudo dnf install -y \
  webkit2gtk4.1-devel \
  openssl-devel \
  curl \
  wget \
  file \
  libappindicator-gtk3-devel \
  librsvg2-devel
```

**Arch Linux / Manjaro:**
```bash
sudo pacman -S --needed \
  webkit2gtk-4.1 \
  base-devel \
  curl \
  wget \
  file \
  openssl \
  appmenu-gtk-module \
  gtk3 \
  libappindicator-gtk3 \
  librsvg
```

---

## 2. Clone & install dependencies

```bash
# Clone your fork (replace with your own URL if needed)
git clone https://github.com/Ploope-Sama/VERT.git
cd VERT

# Switch to the desktop branch
git checkout tauri-integration

# Install Node.js dependencies
npm install
```

---

## 3. Build the executable

A single command compiles the frontend, bundles everything with Tauri, and produces a platform-native installer:

```bash
npm run tauri build
```

This command:
1. Runs `npm run build` → compiles the SvelteKit frontend and WebAssembly workers
2. Compiles the Rust backend with `--release` (optimised for size: `opt-level="z"`, LTO, stripped symbols)
3. Bundles everything into a self-contained installer

The full build typically takes **3–8 minutes** on the first run (Rust dependencies must be compiled). Subsequent builds are much faster.

---

## 4. Output files

After the build, look inside `src-tauri/target/release/bundle/`:

### Windows

| File | Description |
|------|-------------|
| `nsis/VERT_1.0.0_x64-setup.exe` | Standard installer (recommended) — installs VERT for the current user, creates a Start Menu shortcut, supports silent install. |
| `msi/VERT_1.0.0_x64_en-US.msi` | MSI package — useful for enterprise deployment via Group Policy or SCCM. |

**To install:** double-click the `.exe` and follow the wizard. The app will be available in your Start Menu.

---

### macOS

| File | Description |
|------|-------------|
| `dmg/VERT_1.0.0_aarch64.dmg` | Disk image (Apple Silicon) |
| `dmg/VERT_1.0.0_x64.dmg` | Disk image (Intel Mac) |
| `macos/VERT.app` | Raw application bundle (not signed) |

**To install:** open the `.dmg`, drag `VERT.app` into your `/Applications` folder.

> **Note about Gatekeeper:** Since the app is not code-signed with an Apple Developer certificate, macOS will block it on first launch. Right-click `VERT.app` → **Open** → **Open** to bypass the warning once.

To build a **universal binary** (runs natively on both Intel and Apple Silicon):

```bash
npm run tauri build -- --target universal-apple-darwin
```

---

### Linux

| File | Description |
|------|-------------|
| `deb/vert_1.0.0_amd64.deb` | Debian/Ubuntu package — installs to `/usr/bin`, creates an app menu entry. |
| `rpm/vert-1.0.0-1.x86_64.rpm` | Fedora/RHEL package. |
| `appimage/vert_1.0.0_amd64.AppImage` | Portable single-file executable — no installation required, works on any distro. |

**To install the `.deb`:**
```bash
sudo dpkg -i src-tauri/target/release/bundle/deb/vert_1.0.0_amd64.deb
```

**To use the AppImage (no install):**
```bash
chmod +x vert_1.0.0_amd64.AppImage
./vert_1.0.0_amd64.AppImage
```

> To choose which bundle formats to generate, edit the `targets` array in `src-tauri/tauri.conf.json`.

---

## 5. Running in development mode

To launch VERT with hot-reload (changes to the frontend are reflected instantly):

```bash
npm run tauri dev
```

This starts both the Vite dev server and the Tauri window. The Rust dev build is not optimised, so the first launch is slower. The browser DevTools open automatically in this mode.

---

## 6. Cross-compilation

Tauri **does not support cross-compilation** out of the box — you must build on the same platform you are targeting:

| To build for… | Build on… |
|---------------|-----------|
| Windows (`.exe`, `.msi`) | Windows |
| macOS (`.dmg`, `.app`) | macOS |
| Linux (`.deb`, `.AppImage`) | Linux |

**Options if you don't have access to the target OS:**

- **Virtual machine** — run a Linux VM on Windows/macOS, or use Boot Camp / Parallels.
- **GitHub Actions / CI** — add a workflow with three build jobs (one per OS). GitHub provides free runners for all three platforms.
- **Docker** — Linux builds can run in a Docker container (see [`docs/DOCKER.md`](./DOCKER.md) for the web version; adapt for Tauri by adding the Linux system libraries above).

---

## 7. What makes it feel native

Compared to running VERT in a browser tab, the desktop build adds:

| Feature | Details |
|---------|---------|
| **No browser chrome** | VERT opens in its own dedicated window — no address bar, no tabs, no extensions interfering. |
| **Drag & drop from Explorer / Finder / Nautilus** | Drop files from the OS file manager directly onto the VERT window. |
| **Custom download folder** | Choose exactly where converted files land (Settings → Conversion → Download folder). No more hunting through your browser's default download location. |
| **Window state memory** | The window size and position are saved and restored every time you open the app. |
| **Single instance** | Launching VERT a second time focuses the already-open window instead of opening a duplicate. |
| **Start Menu / Dock / App launcher** | After installation, VERT appears in your OS app launcher like any other program. |
| **Works fully offline** | Once installed, VERT needs no internet connection for image, audio, and document conversions (WebAssembly engines are bundled inside the executable). |
| **Dark title bar** | The window theme matches the app's dark UI on Windows. |

---

## Troubleshooting

**Build fails with "linker not found" (Windows)**
→ Install the Microsoft C++ Build Tools and restart your terminal.

**`webkit2gtk` not found (Linux)**
→ Run the `apt` / `dnf` / `pacman` command from the [Linux prerequisites](#linux-specific) section.

**App is blocked by macOS Gatekeeper**
→ Right-click the app → Open → Open. This only needs to be done once.

**Conversion fails / blank page after build**
→ Make sure you're running `npm run tauri build` (not just `npm run build`). The WebAssembly files must be bundled by the Tauri build step.

**`cargo check` fails after pulling new changes**
→ Run `cargo update` inside `src-tauri/` to refresh Rust dependencies.
