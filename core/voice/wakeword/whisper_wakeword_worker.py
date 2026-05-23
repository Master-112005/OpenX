import argparse
import json
import queue
import re
import sys
import threading
import time

import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel

try:
    import webrtcvad
except Exception:
    webrtcvad = None


def emit(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def normalize_text(value):
    return " ".join(str(value or "").strip().lower().split())


def damerau_levenshtein(source, target):
    if source == target:
        return 0
    if not source:
        return len(target)
    if not target:
        return len(source)

    matrix = [[0] * (len(target) + 1) for _ in range(len(source) + 1)]
    for i in range(len(source) + 1):
        matrix[i][0] = i
    for j in range(len(target) + 1):
        matrix[0][j] = j

    for i in range(1, len(source) + 1):
        for j in range(1, len(target) + 1):
            cost = 0 if source[i - 1] == target[j - 1] else 1
            matrix[i][j] = min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost,
            )
            if (
                i > 1
                and j > 1
                and source[i - 1] == target[j - 2]
                and source[i - 2] == target[j - 1]
            ):
                matrix[i][j] = min(matrix[i][j], matrix[i - 2][j - 2] + cost)

    return matrix[len(source)][len(target)]


def build_wake_aliases(wake_word, aliases=None):
    base = normalize_text(wake_word)
    combined = {base, base.replace(" ", "")}
    for alias in aliases or []:
        normalized = normalize_text(alias)
        if normalized:
            combined.add(normalized)
            combined.add(normalized.replace(" ", ""))
    return sorted(item for item in combined if item)


COMMAND_HINTS = {
    "open", "close", "launch", "start", "run", "search", "find", "play", "pause",
    "resume", "mute", "unmute", "increase", "decrease", "set", "turn", "switch",
    "go", "show", "open chrome", "open edge", "open downloads", "chrome", "status",
    "volume", "brightness", "youtube", "spotify", "folder", "file", "browser",
}


def fuzzy_match(candidate, aliases):
    normalized = normalize_text(candidate)
    compact = normalized.replace(" ", "")
    if not compact:
        return False

    for alias in aliases:
        normalized_alias = normalize_text(alias)
        compact_alias = normalized_alias.replace(" ", "")
        if not compact_alias:
            continue
        if normalized == normalized_alias or compact == compact_alias:
            return True

        distance = damerau_levenshtein(compact, compact_alias)
        max_distance = 1 if len(compact_alias) <= 5 else 2
        similarity = 1 - (distance / max(len(compact), len(compact_alias)))
        if distance <= max_distance and similarity >= 0.72:
            return True

    return False


def looks_like_command(text):
    normalized = normalize_text(text)
    if not normalized:
        return False

    tokens = normalized.split()
    if not tokens:
        return False

    if len(tokens) == 1 and tokens[0] in {"yes", "yeah", "yep", "okay", "ok"}:
        return False

    joined = " ".join(tokens[:2])
    if joined in COMMAND_HINTS or tokens[0] in COMMAND_HINTS:
        return True

    return any(token in COMMAND_HINTS for token in tokens)


def split_greeting_prefix(tokens):
    start_index = 0
    while start_index < len(tokens) and tokens[start_index] in {"hey", "hi", "hello"}:
        start_index += 1
    return tokens[start_index:]


def extract_wake_command(wake_word, transcript, aliases=None):
    normalized = normalize_text(transcript)
    if not normalized:
        return None

    wake_aliases = build_wake_aliases(wake_word, aliases)
    canonical = normalize_text(wake_word)
    tokens = split_greeting_prefix(normalized.split())
    if not tokens:
        return None

    exact_variants = []
    for alias in wake_aliases:
        exact_variants.append(alias)
        exact_variants.append(f"hey {alias}")
        exact_variants.append(f"hi {alias}")
        exact_variants.append(f"hello {alias}")

    for variant in exact_variants:
        if normalized == variant:
            return canonical
        if normalized.startswith(f"{variant} "):
            remainder = normalize_text(normalized[len(variant):])
            if remainder and looks_like_command(remainder):
                return f"{canonical} {remainder}".strip()
            return canonical

    max_window = min(2, len(tokens))
    for width in range(1, max_window + 1):
        candidate = " ".join(tokens[:width])
        remainder = " ".join(tokens[width:]).strip()
        if remainder and looks_like_command(remainder) and is_strong_wakeword_candidate(wake_word, candidate, aliases):
            return f"{canonical} {normalize_text(remainder)}".strip()

    return None


def is_wakeword_candidate(wake_word, transcript, aliases=None):
    normalized = normalize_text(transcript)
    if not normalized:
        return False

    wake_aliases = build_wake_aliases(wake_word, aliases)
    tokens = split_greeting_prefix(normalized.split())
    if not tokens or len(tokens) > 2:
        return False

    candidate = " ".join(tokens)
    if fuzzy_match(candidate, wake_aliases):
        return True

    compact = candidate.replace(" ", "")
    if len(compact) < 3:
        return False

    for alias in wake_aliases:
        compact_alias = normalize_text(alias).replace(" ", "")
        if len(compact_alias) < 3:
            continue
        if compact[:2] != compact_alias[:2]:
            continue

        distance = damerau_levenshtein(compact, compact_alias)
        if distance <= 2 and abs(len(compact) - len(compact_alias)) <= 1:
            return True

    return False


def is_strong_wakeword_candidate(wake_word, transcript, aliases=None):
    normalized = normalize_text(transcript)
    if not normalized:
        return False

    tokens = split_greeting_prefix(normalized.split())
    if not tokens or len(tokens) > 2:
        return False

    candidate = " ".join(tokens)
    compact = candidate.replace(" ", "")
    if len(compact) < 4:
        return False

    return fuzzy_match(candidate, build_wake_aliases(wake_word, aliases))


def detect_from_transcripts(wake_word, transcripts, aliases=None):
    canonical = normalize_text(wake_word)
    pending_activation = None

    for transcript in transcripts:
        normalized = normalize_text(transcript)
        if not normalized:
            if pending_activation:
                return canonical
            continue

        command = extract_wake_command(wake_word, normalized, aliases)
        if command:
            return command

        if pending_activation and looks_like_command(normalized):
            return f"{canonical} {normalized}".strip()

        if is_strong_wakeword_candidate(wake_word, normalized, aliases):
            pending_activation = normalized
            continue

        if is_wakeword_candidate(wake_word, normalized, aliases):
            return canonical

    return None


class WakeWordWorker:
    def __init__(self, args):
        self.args = args
        self.wake_word = normalize_text(args.wake_word)
        self.wake_aliases = build_wake_aliases(args.wake_word, args.wake_alias)
        self.model = WhisperModel(
            args.model_name,
            device=args.device,
            compute_type=args.compute_type,
            download_root=args.model_cache_dir,
        )
        self.running = threading.Event()
        self.stop_requested = threading.Event()
        self.audio_queue = queue.Queue()
        self.listener_thread = None
        self.last_activation_at = 0.0
        self.pending_activation = None
        self.pending_timeout_seconds = 0.65
        self.vad = self._build_vad(args.vad_aggressiveness)
        self.chunk_overlap_ms = max(200, int(args.chunk_duration_ms * 0.35))

    def _audio_callback(self, indata, frames, time_info, status):
        if status:
            emit({"event": "warning", "message": str(status)})
        self.audio_queue.put(indata.copy().reshape(-1))

    def _capture_and_detect(self):
        sample_rate = int(self.args.sample_rate)
        frame_duration_ms = int(self.args.frame_duration_ms)
        chunk_duration_ms = int(self.args.chunk_duration_ms)
        chunk_size = max(1, int(sample_rate * (chunk_duration_ms / 1000.0)))
        frame_size = max(160, int(sample_rate * (frame_duration_ms / 1000.0)))
        overlap_size = max(1, int(sample_rate * (self.chunk_overlap_ms / 1000.0)))
        energy_threshold = float(self.args.energy_threshold)
        buffer = np.zeros(0, dtype=np.float32)
        chunk_samples_since_last_transcribe = 0
        speech_run = 0
        max_rms = 0.0
        noise_floor = max(0.001, energy_threshold * 0.35)
        speech_detected_in_window = False

        with sd.InputStream(
            samplerate=sample_rate,
            channels=1,
            dtype="float32",
            blocksize=frame_size,
            callback=self._audio_callback,
        ):
            try:
                device_name = sd.query_devices(None, "input")["name"]
            except Exception:
                device_name = "default"
            emit({"event": "listening", "device": device_name, "sampleRate": sample_rate})
            while self.running.is_set() and not self.stop_requested.is_set():
                try:
                    chunk = self.audio_queue.get(timeout=0.25)
                except queue.Empty:
                    if self.pending_activation and (time.monotonic() - self.pending_activation["timestamp"]) >= self.pending_timeout_seconds:
                        self._emit_wakeword(self.wake_word, inline_command=False)
                        self.pending_activation = None
                    continue

                buffer = np.concatenate((buffer, chunk))
                rms = float(np.sqrt(np.mean(np.square(chunk)))) if chunk.size else 0.0
                max_rms = max(max_rms, rms)
                speech = self._detect_speech(chunk, rms, sample_rate, energy_threshold, noise_floor)

                if speech:
                    speech_run += 1
                else:
                    speech_run = 0
                    noise_floor = self._update_noise_floor(noise_floor, rms)

                if speech_run >= int(self.args.speech_start_frames):
                    speech_detected_in_window = True

                chunk_samples_since_last_transcribe += chunk.size
                if buffer.size < chunk_size or chunk_samples_since_last_transcribe < max(1, chunk_size - overlap_size):
                    continue

                frame = buffer[-chunk_size:]
                buffer = buffer[-overlap_size:]
                chunk_samples_since_last_transcribe = 0

                if not speech_detected_in_window and max_rms < max(energy_threshold * 0.6, noise_floor * 1.25, 0.0018):
                    continue

                segments_iter, _info = self.model.transcribe(
                    frame,
                    language=self.args.language or None,
                    beam_size=1,
                    best_of=1,
                    vad_filter=False,
                    condition_on_previous_text=False,
                )
                transcript = normalize_text(
                    " ".join(segment.text.strip() for segment in segments_iter if segment.text)
                )
                emit({
                    "event": "monitoring",
                    "speechDetected": speech_detected_in_window,
                    "chunkDurationMs": chunk_duration_ms,
                    "maxRms": max_rms,
                    "noiseFloor": noise_floor,
                    "transcript": transcript,
                })
                speech_detected_in_window = False
                max_rms = 0.0
                if not transcript:
                    if self.pending_activation and (time.monotonic() - self.pending_activation["timestamp"]) >= self.pending_timeout_seconds:
                        self._emit_wakeword(self.wake_word, inline_command=False)
                        self.pending_activation = None
                    continue

                command_text = extract_wake_command(self.wake_word, transcript, self.wake_aliases)
                if command_text is not None:
                    self.pending_activation = None
                    self._emit_wakeword(command_text, inline_command=(command_text != self.wake_word))
                    continue

                if self.pending_activation:
                    age_seconds = time.monotonic() - self.pending_activation["timestamp"]
                    if age_seconds <= self.pending_timeout_seconds and looks_like_command(transcript):
                        self.pending_activation = None
                        self._emit_wakeword(f"{self.wake_word} {transcript}".strip(), inline_command=True)
                        continue
                    self.pending_activation = None

                if is_strong_wakeword_candidate(self.wake_word, transcript, self.wake_aliases):
                    self.pending_activation = {
                        "timestamp": time.monotonic(),
                        "transcript": transcript,
                    }
                    continue

                if is_wakeword_candidate(self.wake_word, transcript, self.wake_aliases):
                    self._emit_wakeword(self.wake_word, inline_command=False)
                    continue

    def start(self):
        if self.running.is_set():
            return
        self.running.set()
        self.stop_requested.clear()
        self.listener_thread = threading.Thread(target=self._run_loop, daemon=True)
        self.listener_thread.start()

    def stop(self):
        self.stop_requested.set()
        self.running.clear()
        if self.listener_thread and self.listener_thread.is_alive():
            self.listener_thread.join(timeout=1.0)

    def _run_loop(self):
        try:
            self._capture_and_detect()
        except Exception as exc:
            emit({"event": "error", "message": str(exc)})
            self.running.clear()

    def _build_vad(self, aggressiveness):
        if webrtcvad is None:
            return None
        try:
            vad = webrtcvad.Vad()
            vad.set_mode(max(0, min(3, int(aggressiveness))))
            return vad
        except Exception:
            return None

    def _detect_speech(self, frame, rms, sample_rate, energy_threshold, noise_floor):
        threshold = max(energy_threshold * 1.2, noise_floor * 2.2, 0.003)
        rms_gate = rms >= threshold
        if self.vad is None:
            return rms_gate

        try:
            pcm = (np.clip(frame, -1.0, 1.0) * 32767.0).astype(np.int16).tobytes()
            vad_gate = self.vad.is_speech(pcm, sample_rate)
        except Exception:
            vad_gate = False

        return bool(vad_gate and rms >= max(noise_floor * 1.05, energy_threshold * 0.45)) or rms_gate

    def _update_noise_floor(self, noise_floor, rms):
        bounded = max(0.0005, min(rms, 0.05))
        return (noise_floor * 0.97) + (bounded * 0.03)

    def _emit_wakeword(self, transcript, inline_command):
        now = time.monotonic()
        if (now - self.last_activation_at) * 1000.0 < self.args.cooldown_ms:
            return

        self.last_activation_at = now
        emit({
            "event": "wakeword",
            "wakeWord": self.wake_word,
            "transcript": normalize_text(transcript),
            "confidence": 1.0,
            "manual": False,
            "inlineCommand": bool(inline_command),
        })

def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--wake-word", required=True)
    parser.add_argument("--wake-alias", action="append", default=[])
    parser.add_argument("--model-name", default="tiny.en")
    parser.add_argument("--language", default="en")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--sample-rate", type=int, default=16000)
    parser.add_argument("--frame-duration-ms", type=int, default=20)
    parser.add_argument("--chunk-duration-ms", type=int, default=1200)
    parser.add_argument("--cooldown-ms", type=int, default=2500)
    parser.add_argument("--energy-threshold", type=float, default=0.003)
    parser.add_argument("--speech-start-frames", type=int, default=2)
    parser.add_argument("--vad-aggressiveness", type=int, default=2)
    parser.add_argument("--model-cache-dir", default=None)
    parser.add_argument("--selftest-transcript", action="append", default=[])
    return parser.parse_args()


def main():
    args = parse_args()

    if args.selftest_transcript:
        command = detect_from_transcripts(args.wake_word, args.selftest_transcript, args.wake_alias)
        emit({
            "event": "selftest",
            "matched": bool(command),
            "command": command or "",
        })
        return

    worker = WakeWordWorker(args)

    emit({
      "event": "ready",
      "backend": "whisper-local",
      "wakeWord": args.wake_word,
      "model": args.model_name,
    })

    worker.start()

    try:
        for raw_line in sys.stdin:
            line = raw_line.strip()
            if not line:
                continue

            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                emit({"event": "warning", "message": "Invalid wake-word worker payload"})
                continue

            command = payload.get("command")
            if command == "shutdown":
                break
            if command == "pause":
                worker.stop()
                emit({"event": "paused"})
                continue
            if command == "resume":
                worker.start()
                emit({"event": "resumed"})
                continue
    finally:
        worker.stop()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        emit({"event": "error", "message": str(exc)})
        raise
