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


class BoundedAudioQueue:
    def __init__(self, maxsize=20):
        self.queue = queue.Queue(maxsize=maxsize)
        self.dropped_frames = 0

    def put(self, item):
        try:
            self.queue.put_nowait(item)
        except queue.Full:
            try:
                self.queue.get_nowait()
                self.dropped_frames += 1
            except queue.Empty:
                pass
            try:
                self.queue.put_nowait(item)
            except queue.Full:
                pass

    def get(self, timeout=None):
        return self.queue.get(timeout=timeout)

    def empty(self):
        return self.queue.empty()

    def qsize(self):
        return self.queue.qsize()


class AudioDeviceManager:
    @staticmethod
    def is_bluetooth_hfp(device_name):
        lowered = str(device_name or "").lower()
        return any(k in lowered for k in ["hands-free", "handsfree", "hfp", "hsp", "telephony", "hands-free ag"])

    @staticmethod
    def select_device(preferred_id=None, allow_bluetooth=False):
        devices = sd.query_devices()
        
        if preferred_id is not None and preferred_id >= 0 and preferred_id < len(devices):
            dev = devices[preferred_id]
            if dev.get('max_input_channels', 0) > 0:
                if not allow_bluetooth and AudioDeviceManager.is_bluetooth_hfp(dev.get('name')):
                    pass
                else:
                    return preferred_id

        for idx, dev in enumerate(devices):
            if dev.get('max_input_channels', 0) > 0:
                name = dev.get('name', '')
                if not allow_bluetooth and AudioDeviceManager.is_bluetooth_hfp(name):
                    continue
                if "microphone array" in name.lower() or "realtek" in name.lower():
                    return idx

        for idx, dev in enumerate(devices):
            if dev.get('max_input_channels', 0) > 0:
                name = dev.get('name', '')
                if not allow_bluetooth and AudioDeviceManager.is_bluetooth_hfp(name):
                    continue
                return idx

        try:
            default_in = sd.query_devices(None, 'input')
            return default_in['index']
        except Exception:
            return None


class AudioEngine:
    def __init__(self, args):
        self.args = args
        self.activation_mode = args.activation_mode
        self.wake_word = normalize_text(args.wake_word)
        self.wake_aliases = build_wake_aliases(args.wake_word, args.wake_alias) if self.wake_word else []
        
        self.model = WhisperModel(
            args.model_name,
            device=args.device,
            compute_type=args.compute_type,
            download_root=args.model_cache_dir,
        )
        
        self.running = threading.Event()
        self.capture_active = threading.Event()
        self.audio_queue = BoundedAudioQueue(maxsize=20)
        self.listener_thread = None
        self.last_activation_at = 0.0
        self.pending_activation = None
        self.pending_timeout_seconds = 0.65
        self.vad = self._build_vad(args.vad_aggressiveness)
        
        self.state = "STREAM_INITIALIZING"
        self._transition("STREAM_INITIALIZING")
        
        # Buffer properties for speech detection
        self.frame_duration_ms = args.frame_duration_ms
        self.sample_rate = args.sample_rate
        self.frame_size = int(self.sample_rate * (self.frame_duration_ms / 1000.0))
        self.chunk_duration_ms = args.chunk_duration_ms
        self.chunk_size = int(self.sample_rate * (self.chunk_duration_ms / 1000.0))
        self.chunk_overlap_ms = max(200, int(self.chunk_duration_ms * 0.35))
        self.overlap_size = int(self.sample_rate * (self.chunk_overlap_ms / 1000.0))
        self.energy_threshold = args.energy_threshold
        
        # Audio capturing streams ownership
        self.selected_device_id = AudioDeviceManager.select_device(
            preferred_id=args.device_id,
            allow_bluetooth=args.allow_bluetooth_hfp
        )
        
        # Continuous stream resource
        self.stream = None
        
        # STT session variables
        self.session_active = False
        self.session_mode = "command"
        self.session_started_at = 0.0
        self.start_speech_timeout_ms = max(0, int(getattr(args, "start_speech_timeout_ms", 0)))
        self.speech_detected = False
        self.speech_frames = []
        self.pre_roll_frames = []
        self.pre_roll_limit = max(1, int(400 / self.frame_duration_ms))
        self.silence_frames_threshold = max(1, int(args.silence_timeout_ms / self.frame_duration_ms))
        self.default_silence_frames_threshold = self.silence_frames_threshold
        self.max_speech_frames = max(1, int(args.max_duration_ms / self.frame_duration_ms))
        self.default_max_speech_frames = self.max_speech_frames
        self.silence_run = 0
        self.speech_run = 0
        self.min_utterance_ms = max(0, int(getattr(args, "min_utterance_ms", 250)))
        self.speaker_lock_enabled = bool(getattr(args, "speaker_lock_enabled", False))
        self.speaker_similarity_threshold = float(getattr(args, "speaker_similarity_threshold", 0.68))
        self.speaker_profile = None
        
    def _transition(self, next_state):
        if self.state != next_state:
            old_state = self.state
            self.state = next_state
            emit({
                "event": "state_changed",
                "previousState": old_state,
                "currentState": next_state,
                "timestamp": time.time()
            })

    def _audio_callback(self, indata, frames, time_info, status):
        if not self.capture_active.is_set():
            return
        if status:
            emit({"event": "warning", "message": str(status)})
        self.audio_queue.put(indata.copy().reshape(-1))

    def _build_vad(self, aggressiveness):
        if webrtcvad is None:
            return None
        try:
            vad = webrtcvad.Vad()
            vad.set_mode(max(0, min(3, int(aggressiveness))))
            return vad
        except Exception:
            return None

    def _detect_speech(self, frame, rms, noise_floor):
        threshold = max(self.energy_threshold * 1.2, noise_floor * 2.2, 0.003)
        rms_gate = rms >= threshold
        if self.vad is None:
            return rms_gate

        try:
            pcm = (np.clip(frame, -1.0, 1.0) * 32767.0).astype(np.int16).tobytes()
            vad_gate = self.vad.is_speech(pcm, self.sample_rate)
        except Exception:
            vad_gate = False

        return bool(vad_gate and rms >= max(noise_floor * 1.05, self.energy_threshold * 0.45)) or rms_gate

    def _update_noise_floor(self, noise_floor, rms):
        bounded = max(0.0005, min(rms, 0.05))
        updated = (noise_floor * 0.97) + (bounded * 0.03)
        return min(updated, 0.0045)

    def _build_speaker_signature(self, audio):
        if audio is None or len(audio) < int(self.sample_rate * 0.25):
            return None

        samples = np.asarray(audio, dtype=np.float32)
        samples = samples - float(np.mean(samples))
        peak = float(np.max(np.abs(samples))) if samples.size else 0.0
        if peak < max(self.energy_threshold * 0.35, 0.0008):
            return None

        max_samples = int(self.sample_rate * 4.0)
        if samples.size > max_samples:
            center = samples.size // 2
            half = max_samples // 2
            samples = samples[max(0, center - half):center + half]

        window = np.hanning(samples.size).astype(np.float32)
        spectrum = np.abs(np.fft.rfft(samples * window))
        freqs = np.fft.rfftfreq(samples.size, d=1.0 / float(self.sample_rate))
        mask = (freqs >= 85.0) & (freqs <= 3800.0)
        spectrum = spectrum[mask]

        if spectrum.size < 16 or float(np.sum(spectrum)) <= 0.0:
            return None

        bands = np.array_split(spectrum, 24)
        features = np.array([float(np.log1p(np.mean(band))) for band in bands], dtype=np.float32)
        norm = float(np.linalg.norm(features))
        if norm <= 0.0:
            return None

        return features / norm

    def _speaker_similarity(self, left, right):
        if left is None or right is None:
            return 0.0
        return float(np.dot(left, right) / max(float(np.linalg.norm(left) * np.linalg.norm(right)), 1e-8))

    def _evaluate_speaker_lock(self, audio):
        if not self.speaker_lock_enabled or self.session_mode not in {"conversation", "confirmation"}:
            return True, 1.0, False

        signature = self._build_speaker_signature(audio)
        if signature is None:
            return False, 0.0, False

        if self.speaker_profile is None:
            self.speaker_profile = signature
            return True, 1.0, True

        similarity = self._speaker_similarity(signature, self.speaker_profile)
        return similarity >= self.speaker_similarity_threshold, similarity, False

    def _emit_ignored_speech(self, reason, mode=None, **extra):
        payload = {
            "event": "ignored_speech",
            "mode": mode or self.session_mode,
            "reason": reason,
        }
        payload.update(extra)
        emit(payload)


    def _emit_activation(self, transcript, inline_command):
        now = time.monotonic()
        if (now - self.last_activation_at) * 1000.0 < self.args.cooldown_ms:
            return

        self.last_activation_at = now
        emit({
            "event": "activated",
            "wakeWord": self.wake_word,
            "transcript": normalize_text(transcript),
            "confidence": 1.0,
            "manual": False,
            "inlineCommand": bool(inline_command),
        })

    def _run_engine_loop(self):
        buffer = np.zeros(0, dtype=np.float32)
        chunk_samples_since_last_transcribe = 0
        speech_run = 0
        max_rms = 0.0
        noise_floor = max(0.001, self.energy_threshold * 0.35)
        speech_detected_in_window = False

        # Clear queue
        while not self.audio_queue.empty():
            self.audio_queue.get()

        self._transition("STREAM_ACTIVE")

        while self.running.is_set():
            if not self.capture_active.is_set():
                time.sleep(0.05)
                continue

            try:
                chunk = self.audio_queue.get(timeout=0.2)
            except queue.Empty:
                if self.activation_mode == "wakeword" and self.pending_activation and (time.monotonic() - self.pending_activation["timestamp"]) >= self.pending_timeout_seconds:
                    self._emit_activation(self.wake_word, inline_command=False)
                    self.pending_activation = None
                continue

            buffer = np.concatenate((buffer, chunk))
            rms = float(np.sqrt(np.mean(np.square(chunk)))) if chunk.size else 0.0
            max_rms = max(max_rms, rms)
            speech = self._detect_speech(chunk, rms, noise_floor)

            if speech:
                speech_run += 1
            else:
                speech_run = 0
                noise_floor = self._update_noise_floor(noise_floor, rms)

            if speech_run >= int(self.args.speech_start_frames):
                speech_detected_in_window = True

            # Track pre-roll frames for STT segmentation
            self.pre_roll_frames.append(chunk)
            if len(self.pre_roll_frames) > self.pre_roll_limit:
                self.pre_roll_frames.pop(0)

            # --- STT Dynamic Session Buffering & Endpoint Segmentation ---
            if self.session_active:
                if not self.speech_detected:
                    if self.start_speech_timeout_ms > 0 and self.session_started_at > 0:
                        age_ms = (time.monotonic() - self.session_started_at) * 1000.0
                        if age_ms >= self.start_speech_timeout_ms:
                            self.session_active = False
                            self.speech_frames = []
                            self.speech_detected = False
                            emit({
                                "event": "session_timeout",
                                "mode": self.session_mode,
                                "reason": "no-speech-detected",
                                "timeoutMs": self.start_speech_timeout_ms
                            })
                            continue
                    if speech_run >= int(self.args.speech_start_frames):
                        self.speech_detected = True
                        self.speech_frames = list(self.pre_roll_frames)
                        self.silence_run = 0
                        emit({"event": "speech_started"})
                else:
                    self.speech_frames.append(chunk)
                    if speech:
                        self.silence_run = 0
                    else:
                        self.silence_run += 1

                    utterance_exceeded = len(self.speech_frames) >= self.max_speech_frames
                    if self.silence_run >= self.silence_frames_threshold or utterance_exceeded:
                        # Finalize speech capture and run transcription
                        self.session_active = False
                        self._transcribe_captured_speech()
                        self.speech_frames = []
                        self.speech_detected = False

            # --- Activation phrase monitoring loop ---
            chunk_samples_since_last_transcribe += chunk.size
            if buffer.size < self.chunk_size or chunk_samples_since_last_transcribe < max(1, self.chunk_size - self.overlap_size):
                continue

            frame = buffer[-self.chunk_size:]
            buffer = buffer[-self.overlap_size:]
            chunk_samples_since_last_transcribe = 0

            if self.session_active:
                # If we are in the middle of a command/STT session, suspend phrase matching to avoid double triggering
                continue

            if self.activation_mode != "wakeword":
                speech_detected_in_window = False
                max_rms = 0.0
                continue

            if not speech_detected_in_window and max_rms < max(self.energy_threshold * 0.6, noise_floor * 1.25, 0.0018):
                continue

            # Run activation phrase transcription (only if not active in speech capture session)
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
            
            speech_detected_in_window = False
            max_rms = 0.0
            
            if not transcript:
                if self.pending_activation and (time.monotonic() - self.pending_activation["timestamp"]) >= self.pending_timeout_seconds:
                    self._emit_activation(self.wake_word, inline_command=False)
                    self.pending_activation = None
                continue

            command_text = extract_wake_command(self.wake_word, transcript, self.wake_aliases)
            if command_text is not None:
                self.pending_activation = None
                self._emit_activation(command_text, inline_command=(command_text != self.wake_word))
                continue

            if self.pending_activation:
                age_seconds = time.monotonic() - self.pending_activation["timestamp"]
                if age_seconds <= self.pending_timeout_seconds and looks_like_command(transcript):
                    self.pending_activation = None
                    self._emit_activation(f"{self.wake_word} {transcript}".strip(), inline_command=True)
                    continue
                self.pending_activation = None

            if is_strong_wakeword_candidate(self.wake_word, transcript, self.wake_aliases):
                self.pending_activation = {
                    "timestamp": time.monotonic(),
                    "transcript": transcript,
                }
                continue

            if is_wakeword_candidate(self.wake_word, transcript, self.wake_aliases):
                self._emit_activation(self.wake_word, inline_command=False)
                continue

    def _transcribe_captured_speech(self):
        if not self.speech_frames:
            emit({"event": "result", "text": "", "confidence": 0.0})
            return

        audio = np.concatenate(self.speech_frames).astype(np.float32, copy=False)
        duration_ms = int((len(audio) / float(self.sample_rate)) * 1000.0)
        mode = self.session_mode

        if duration_ms < self.min_utterance_ms:
            self._emit_ignored_speech("utterance-too-short", mode=mode, durationMs=duration_ms)
            return

        # Execute transcription sharing the pre-loaded Whisper model cleanly
        self._transition("STREAM_PAUSING") # Lock model processing state
        try:
            segments_iter, info = self.model.transcribe(
                audio,
                language=self.args.language or None,
                beam_size=1,
                best_of=1,
                vad_filter=False,
                condition_on_previous_text=False,
            )
            segments = list(segments_iter)
            text = " ".join(segment.text.strip() for segment in segments if segment.text).strip()
            
            # Compute confidence
            scores = []
            for segment in segments:
                avg_logprob = getattr(segment, "avg_logprob", None)
                if avg_logprob is not None:
                    scores.append(max(0.0, min(1.0, float(np.exp(avg_logprob)))))
            confidence = float(sum(scores) / len(scores)) if scores else 0.8

            if not text:
                self._emit_ignored_speech("empty-transcript", mode=mode, durationMs=duration_ms)
                return

            speaker_allowed, speaker_similarity, speaker_locked = self._evaluate_speaker_lock(audio)
            if not speaker_allowed:
                self._emit_ignored_speech(
                    "speaker-mismatch",
                    mode=mode,
                    durationMs=duration_ms,
                    speakerSimilarity=speaker_similarity,
                    speakerThreshold=self.speaker_similarity_threshold
                )
                return

            emit({
                "event": "result",
                "text": text,
                "confidence": confidence,
                "isFinal": True,
                "speechDetected": True,
                "mode": mode,
                "durationMs": duration_ms,
                "language": getattr(info, "language", self.args.language),
                "speakerLocked": speaker_locked,
                "speakerSimilarity": speaker_similarity,
            })
        except Exception as e:
            emit({"event": "error", "message": f"Transcription failed: {str(e)}"})
        finally:
            self._transition("STREAM_ACTIVE")

    def start(self):
        if self.running.is_set():
            return
        
        self.running.set()
        self.capture_active.set()
        
        # 1. Open persistent hardware InputStream
        try:
            self.stream = sd.InputStream(
                device=self.selected_device_id,
                samplerate=self.sample_rate,
                channels=1,
                dtype="float32",
                blocksize=self.frame_size,
                callback=self._audio_callback
            )
            self.stream.start()
            
            device_info = sd.query_devices(self.selected_device_id)
            emit({
                "event": "listening",
                "device": device_info.get("name", "unknown"),
                "sampleRate": self.sample_rate
            })
        except Exception as err:
            self._transition("STREAM_FAILED")
            emit({"event": "error", "message": f"Hardware stream initialization failed: {str(err)}"})
            self.running.clear()
            return
            
        self.listener_thread = threading.Thread(target=self._run_engine_loop, daemon=True)
        self.listener_thread.start()

    def stop(self):
        self.running.clear()
        self.capture_active.clear()
        if self.listener_thread and self.listener_thread.is_alive():
            self.listener_thread.join(timeout=1.0)
        
        if self.stream:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception:
                pass
            self.stream = None
            
        self._transition("STREAM_RELEASED")

    def pause_capture(self):
        """Suspends VAD, wake-word VAD, and closes hardware stream (Law 5 & Law 6)"""
        self._transition("STREAM_PAUSING")
        self.capture_active.clear()
        if self.stream:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception:
                pass
            self.stream = None
            
        # Empty queue
        while not self.audio_queue.empty():
            self.audio_queue.get()
            
        self._transition("STREAM_RELEASED")
        emit({"event": "paused"})

    def resume_capture(self):
        """Restores hardware streams and starts VAD analysis"""
        if self.stream:
            return
        
        self._transition("STREAM_INITIALIZING")
        try:
            self.stream = sd.InputStream(
                device=self.selected_device_id,
                samplerate=self.sample_rate,
                channels=1,
                dtype="float32",
                blocksize=self.frame_size,
                callback=self._audio_callback
            )
            self.stream.start()
            self.capture_active.set()
            self._transition("STREAM_ACTIVE")
            emit({"event": "resumed"})
        except Exception as err:
            self._transition("STREAM_FAILED")
            emit({"event": "error", "message": f"Failed to restore hardware stream on resume: {str(err)}"})

    def activate_stt_session(self, options=None):
        """Forces the audio engine to start collecting speech for STT command matching"""
        options = options or {}
        self.session_active = True
        self.session_mode = str(options.get("mode") or "command")
        self.session_started_at = time.monotonic()
        self.start_speech_timeout_ms = max(
            0,
            int(options.get("startSpeechTimeoutMs", self.args.start_speech_timeout_ms))
        )
        requested_max_duration_ms = int(options.get("maxDurationMs", self.args.max_duration_ms))
        self.max_speech_frames = max(1, int(requested_max_duration_ms / self.frame_duration_ms))
        self.silence_frames_threshold = self.default_silence_frames_threshold
        self.speech_detected = False
        self.speech_frames = []
        self.pre_roll_frames = []
        self.silence_run = 0
        self.speech_run = 0
        if options.get("resetSpeakerLock") is True:
            self.speaker_profile = None
        emit({
            "event": "stt_session_activated",
            "mode": self.session_mode,
            "startSpeechTimeoutMs": self.start_speech_timeout_ms
        })


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--activation-mode", choices=["wakeword", "hotkey"], default="hotkey")
    parser.add_argument("--wake-word", default="")
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
    
    # Device configs (Law 3)
    parser.add_argument("--device-id", type=int, default=-1)
    parser.add_argument("--allow-bluetooth-hfp", action="store_true", default=False)
    
    # Session timeouts
    parser.add_argument("--silence-timeout-ms", type=int, default=1200)
    parser.add_argument("--max-duration-ms", type=int, default=12000)
    parser.add_argument("--start-speech-timeout-ms", type=int, default=3500)
    parser.add_argument("--min-utterance-ms", type=int, default=250)
    parser.add_argument("--speaker-lock-enabled", action="store_true", default=False)
    parser.add_argument("--speaker-similarity-threshold", type=float, default=0.68)
    
    # Selftest arguments
    parser.add_argument("--selftest-transcript", action="append", default=[])
    
    return parser.parse_args()


def main():
    args = parse_args()

    if args.selftest_transcript:
        command = None
        if args.activation_mode == "wakeword" and args.wake_word:
            command = detect_from_transcripts(args.wake_word, args.selftest_transcript, args.wake_alias)
        emit({
            "event": "selftest",
            "matched": bool(command),
            "command": command or "",
        })
        return

    if args.activation_mode == "wakeword" and not args.wake_word:
        raise ValueError("A wake word is required when activation mode is wakeword")

    engine = AudioEngine(args)

    emit({
        "event": "ready",
        "backend": "whisper-local",
        "activationMode": args.activation_mode,
        "wakeWord": args.wake_word,
        "model": args.model_name,
    })

    engine.start()

    try:
        for raw_line in sys.stdin:
            line = raw_line.strip()
            if not line:
                continue

            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                emit({"event": "error", "message": "Invalid audio engine stdin payload"})
                continue

            command = payload.get("command")
            if command == "shutdown":
                break
            elif command == "pause":
                engine.pause_capture()
            elif command == "resume":
                engine.resume_capture()
            elif command == "listen":
                engine.activate_stt_session(payload)
            else:
                emit({"event": "error", "message": f"Unknown engine command: {command}"})
    finally:
        engine.stop()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        emit({"event": "error", "message": f"Fatal audio engine error: {str(exc)}"})
        raise
