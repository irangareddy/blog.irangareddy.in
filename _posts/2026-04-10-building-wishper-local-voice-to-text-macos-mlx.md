---
title: "Building Wishper: Local Voice-to-Text for macOS on MLX"
date: 2026-04-10
tokens: "~7k"
description: "I built an open-source Wispr Flow alternative that runs entirely on Apple Silicon via MLX — no cloud, no subscription. Here's what worked, what broke, and what I learned."
tags:
  - MLX
  - macOS
  - Swift
  - Speech-to-Text
  - Open-Source
---

I built [Wishper](https://github.com/irangareddy/wishper-app), a local voice-to-text app for macOS that runs entirely on Apple Silicon. Hold a key, speak, release — cleaned text appears in your active app. No cloud. No subscription. 90MB app bundle.

## The problem with Wispr Flow

Wispr Flow is excellent. It's also $10/month, cloud-dependent, and sends your audio to remote servers. I wanted the same workflow — push-to-talk dictation with LLM cleanup — but local.

The hypothesis: Apple Silicon's unified memory and MLX framework should be fast enough to run both ASR and LLM inference locally, in under 2 seconds total.

## The pipeline

```
Hold key → Record mic → ASR (Qwen3-ASR/MLX) → Voice commands →
LLM cleanup (Qwen3-0.6B/MLX) → Paste into active app
```

Two models run sequentially. The ASR model transcribes raw audio to text. The LLM removes filler words ("um", "like", "you know"), fixes grammar, and adapts tone based on the active app — casual in Slack, professional in Mail, technical in VS Code.

![Wishper Pipeline Architecture](/public/images/Wishper%20Pipeline.png)

Three layers: input (mic capture with sample rate conversion), MLX inference (ASR → voice commands → LLM cleanup with app context), and output (three text injection strategies with cascading fallbacks).

## Phase 1: Python prototype

I started with Python to validate the pipeline before touching Swift. Eight files, ~600 lines:

```
src/wishper/
├── main.py         # CLI + hotkey loop (pynput)
├── recorder.py     # sounddevice, 16kHz float32
├── transcriber.py  # mlx-whisper
├── cleaner.py      # mlx-lm + Qwen3-0.6B-4bit
├── commands.py     # "period" → ".", "new paragraph" → "\n\n"
├── injector.py     # clipboard + Cmd+V via osascript
├── context.py      # active app detection via AppleScript
└── config.py       # TOML config
```

### ASR benchmarks

I tested Whisper variants on a 19-second macOS `say`-generated speech sample:

| Model | Size | Time | Speed | RTF |
|---|---|---|---|---|
| Whisper Tiny | 39M | 0.14s | **106x realtime** | 0.009 |
| Whisper Large v3 Turbo | 809M | 1.25s | **12x realtime** | 0.086 |

Both ran via `mlx-whisper`. Even the largest model transcribes faster than you can speak.

### LLM cleanup: smaller is better

Counter-intuitive finding: Qwen3-0.6B-4bit outperformed Qwen3-1.7B-4bit for filler removal.

| Model | Time | Fillers removed |
|---|---|---|
| Qwen3 0.6B 4-bit | 0.49s | 75% (4→1) |
| Qwen3 1.7B 4-bit | 1.26s | 25% (4→3) |

The 1.7B model is "smarter" — it recognizes fillers might be intentional and preserves them. For dictation cleanup, aggressive removal is what you want. The 0.6B model is faster AND better for this specific task.

### Pipeline order matters

I initially ran: transcribe → LLM cleanup → voice commands. This broke everything. The LLM mangled command words — "new paragraph" became part of a cleaned sentence before the command processor saw it.

Fix: voice commands first, then LLM cleanup.

### The think tag problem

Qwen3 models have a "thinking" mode. Even with `/no_think` in the system prompt, the 0.6B model sometimes outputs `<think>` blocks that overflow the max token limit, producing raw reasoning instead of cleaned text.

Fix: strip everything from `<think>` to `</think>` (closed tags), and from `<think>` to end of string (unclosed tags that overflowed).

**Total pipeline: 1.74 seconds** (Whisper Turbo + Qwen3 0.6B). The prototype validated the concept. Time for Swift.

## Phase 2: Native Swift app

Every shipping macOS dictation app — SuperWhisper, MacWhisper, Wispr Flow — uses native Swift with in-process inference. No Python subprocess. I followed the same pattern but made a deliberate choice: **all-MLX instead of whisper.cpp**.

### Going all-MLX instead of whisper.cpp

Every other open-source dictation app uses whisper.cpp (C++ via a Swift bridge). I used Apple's own MLX ecosystem:

- **ASR**: [speech-swift](https://github.com/soniqo/speech-swift) — Qwen3-ASR on MLX (GPU)
- **LLM**: [mlx-swift-lm](https://github.com/ml-explore/mlx-swift-lm) — Apple's official Swift package

WhisperKit (Core ML) was my first choice, but it conflicts with mlx-swift-lm — both depend on `swift-transformers` at incompatible versions. The dependency conflict validated going all-in on MLX.

### Architecture

20 Swift files, 2,123 lines, 31 commits:

```
Sources/WishperApp/
├── WishperApp.swift              # @main, MenuBarExtra + Window
├── Engine/
│   ├── PipelineCoordinator.swift # Orchestrates everything
│   ├── AudioRecorder.swift       # AVAudioEngine + AVAudioConverter
│   ├── Transcriber.swift         # Qwen3-ASR via speech-swift
│   ├── Cleaner.swift             # MLXLLM via mlx-swift-lm
│   ├── TextInjector.swift        # AX API + CGEvent postToPid
│   ├── HotkeyManager.swift       # CGEventTap + NSEvent monitor
│   └── RecordingOverlay.swift    # Floating NSPanel status pill
├── Models/
│   ├── AppState.swift
│   ├── HotkeyConfiguration.swift
│   └── StatsTracker.swift
└── Views/
    ├── MainWindow.swift           # NavigationSplitView
    ├── HomeView.swift             # Transcript history + stats
    └── ShortcutRecorderView.swift
```

## The hard problems

Getting text from the app into the user's active text field took more iterations than everything else combined.

### Audio format mismatch

AVAudioEngine crashes if you request 16kHz recording on 48kHz hardware. Fix: record at the hardware's native format, convert via `AVAudioConverter`:

```swift
let hardwareFormat = engine.inputNode.outputFormat(forBus: 0)
let converter = AVAudioConverter(from: hardwareFormat, to: targetFormat)

inputNode.installTap(onBus: 0, bufferSize: 4096, format: hardwareFormat) {
    buffer, _ in
    converter.convert(to: outputBuffer, error: &error) { _, outStatus in
        outStatus.pointee = .haveData
        return buffer
    }
}
```

### MLX metallib not found in .app bundle

`swift build` does not compile Metal shaders. The app crashed on launch with "Failed to load the default metallib." Only `xcodebuild` produces the `mlx-swift_Cmlx.bundle` containing `default.metallib`. MLX searches for `mlx.metallib` colocated with the binary first.

Fix: build with `xcodebuild`, copy `default.metallib` as `mlx.metallib` next to the binary.

### AXIsProcessTrusted() always false

macOS Accessibility permission is tied to the **bundle identity**, not the binary path. Running `./WishperApp` directly bypasses LaunchServices, so macOS never associates the process with the `.app` bundle's TCC grant.

Fix: always launch via `open -a Wishper.app`. Ad-hoc signing (`codesign --sign -`) creates a new identity on every build, revoking the permission. Use a developer certificate for stable identity.

### Text injection: the focus-stealing problem

When the user releases the hotkey, the app processes audio for 1-2 seconds. By the time it pastes, the app might have briefly become frontmost — sending Cmd+V to itself.

Three strategies, in order:

1. **Accessibility API** — `AXUIElementSetAttributeValue` with `kAXSelectedTextAttribute`. Works for Notes, TextEdit, Xcode. Silently fails in Electron apps.

2. **CGEvent.postToPid** — delivers Cmd+V directly to the target process's event queue, bypassing focus. Save the target app's PID on key press, use it on paste.

3. **CGEvent session post** — fallback.

```swift
let keyDown = CGEvent(keyboardEventSource: source,
                      virtualKey: CGKeyCode(kVK_ANSI_V), keyDown: true)
keyDown?.flags = .maskCommand
keyDown?.postToPid(pid)  // bypasses window server focus check
```

## What's different

| | Every other app | Wishper |
|---|---|---|
| ASR engine | whisper.cpp (C bridge) | Qwen3-ASR (MLX, GPU) |
| LLM cleanup | None or cloud | Qwen3-0.6B (MLX, in-process) |
| ML framework | Core ML or whisper.cpp | MLX-Swift |
| Prototype | None | Python for rapid model testing |

## Current state

The app works end-to-end. 90MB signed `.app` bundle.

| Component | Implementation |
|---|---|
| ASR | Qwen3-ASR 0.6B via speech-swift (MLX) |
| LLM | Qwen3-0.6B-4bit via mlx-swift-lm (MLX) |
| Audio | AVAudioEngine + AVAudioConverter |
| Hotkeys | CGEventTap + NSEvent, configurable |
| Text injection | AX API → postToPid → session post |
| UI | NavigationSplitView + MenuBarExtra |
| Stats | Weekly streak, WPM, word count (UserDefaults) |

Total latency: ~1.7 seconds on Apple Silicon.

## How the build actually went

This wasn't a linear "design → build → ship" process. Here's the real order:

1. **Day started with research.** Compared ASR models on the Hugging Face Open ASR Leaderboard. Canary Qwen 2.5B tops it at 5.63% WER, but Whisper remains the practical choice. Checked mlx-audio's 12 supported model families. Found that lightning-whisper-mlx (895 stars) is abandoned — last commit May 2024.

2. **Built the Python prototype in ~2 hours.** Deployed Codex agents in parallel — one per module. All 5 modules (recorder, transcriber, cleaner, injector, context) built simultaneously, then wired together. 36 pytest tests, all passing.

3. **Named it.** Checked "whiscribe" (taken on PyPI), "wisp" (48K star repos + trademark conflicts), landed on "wishper" — homophone of "whisper" with "wish" hidden inside. PyPI, GitHub, npm all clear.

4. **Studied the industry.** Every shipping macOS dictation app (SuperWhisper, MacWhisper, Pindrop, Dial8) uses whisper.cpp via C bridge + Core ML. None use MLX-Swift. Decided to break the pattern.

5. **Hit the WhisperKit dependency wall.** WhisperKit and mlx-swift-lm both depend on `swift-transformers` at incompatible versions. This killed the WhisperKit plan and pushed me to speech-swift's Qwen3-ASR (pure MLX, no swift-transformers dependency).

6. **Spent 4+ hours on text injection alone.** Tried CGEvent `.cgSessionEventTap` (wrong), `.cgAnnotatedSessionEventTap` (wrong), `.cghidEventTap` (correct). Then AppleScript (blocked by "not allowed to send keystrokes"). Then Accessibility API (only works in Notes/TextEdit). Finally `postToPid` — delivers directly to the target process.

7. **Discovered the metallib problem.** `swift build` doesn't compile Metal shaders. Only learned this after packaging the `.app` and watching it crash. Switched to `xcodebuild` and manually copied `default.metallib` as `mlx.metallib` next to the binary.

8. **Permission hell.** `AXIsProcessTrusted()` returned false even with Accessibility enabled — because running `./WishperApp` directly bypasses LaunchServices. Must use `open -a`. Ad-hoc signing revokes permission on every rebuild — must use developer certificate.

9. **Added the desktop UI.** NavigationSplitView with sidebar (Home, Dictionary, Snippets, Style, Settings), transcript history with stats (weekly streak, WPM, total words, apps used). Single window for everything — no separate Settings window.

## MLX performance characteristics

Some things I measured that aren't in the docs:

**Metal shader compilation is the biggest cold-start penalty.** First inference after a fresh build takes ~5x longer because MLX JIT-compiles Metal shaders. speech-swift's Parakeet model has a `warmUp()` method that runs a dummy inference to pre-compile — Qwen3-ASR should do the same.

**Unified memory is real.** Both models (~700MB total) fit comfortably alongside the app. No explicit memory management needed. speech-swift calls `mlx_set_wired_limit` to pin GPU memory at 90% of working set after model load — prevents macOS from paging model weights.

**4-bit quantization is the sweet spot for cleanup.** I tested 4-bit vs 8-bit Qwen3. For structured tasks like filler removal, 4-bit is ~30-40% faster with negligible quality loss. The model doesn't need nuanced creative ability — it needs to delete "um" and fix punctuation.

**Concurrent CoreML + MLX is possible.** speech-swift offers Parakeet TDT on CoreML alongside Qwen3-ASR on MLX. Since CoreML uses CPU+GPU and MLX uses Metal, they can run with less contention. I haven't benchmarked this yet, but it's the path to running ASR and LLM cleanup in parallel.

## What I'd do differently

1. **Start with text injection research.** I spent more time on paste than on ML. Reading [Itsuki's article](https://medium.com/@itsuki) on `AXUIElement` + `CGEvent` before writing code would have saved hours.

2. **Use `xcodebuild` from day one.** `swift build` doesn't compile Metal shaders. I discovered this after packaging the `.app` and watching it crash.

3. **Don't fight `AXIsProcessTrusted`.** Launch via `open -a` and sign with a developer certificate. Every workaround fails without the proper bundle context.

## What's next

The core pipeline works. These are the open problems:

**Personal dictionary.** Whisper consistently transcribes "comma" as "Kama", domain-specific terms get mangled. Need a user-editable correction map that runs before LLM cleanup.

**Streaming transcription.** Currently batch — record everything, then transcribe. Showing partial results while recording (like Wispr Flow) would make the latency feel shorter even if total time is the same. The Python prototype has a `StreamingTranscriber` that re-transcribes the full audio every 3 seconds.

**Model warmup.** Pre-compile Metal shaders on app launch with a dummy inference pass. Eliminates the 5x cold-start penalty on first dictation.

**Parakeet TDT for ASR.** CoreML-based, frees the GPU for LLM cleanup. Could enable parallel ASR + cleanup instead of sequential. speech-swift already supports it.

**DMG distribution.** The app is currently built with `xcodebuild` + a shell script. Need proper archiving, notarization with the Apple Developer certificate, and a DMG with drag-to-Applications.

**Screen context.** Wispr Flow reads the active text field's existing content to provide better LLM context. The Accessibility API (`kAXValueAttribute`) can do this — we already use it for text injection. Reading context would let the LLM produce more coherent continuations.

## Links

- [wishper-app](https://github.com/irangareddy/wishper-app) — native macOS app (Swift + MLX)
- [wishper](https://github.com/irangareddy/wishper) — Python prototype (pip installable)
- [speech-swift](https://github.com/soniqo/speech-swift) — Qwen3-ASR for Swift
- [mlx-swift-lm](https://github.com/ml-explore/mlx-swift-lm) — Apple's LLM package
