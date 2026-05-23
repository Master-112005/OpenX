import argparse
import json
import queue
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


def emit(event):
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


def compute_confidence(segments):
    scores = []
    for segment in segments:
        avg_logprob = getattr(segment, "avg_logprob", None)
        if avg_logprob is None:
          continue
        scores.append(max(0.0, min(1.0, float(np.exp(avg_logprob)))))

    if not scores:
        return 0.0

    return float(sum(scores) / len(scores))


class WhisperWorker:
    def __init__(self, args):
        self.args = args
        self.model = WhisperModel(
            args.model_name,
            device=args.device,
            compute_type=args.compute_type,
            download_root=args.model_cache_dir,
        )
        self.cancel_event = threading.Event()
        self.listen_thread = None
        self.listen_lock = threading.Lock()
        self.vad = self._build_vad(args.vad_aggressiveness)

    def capture_audio(
        self,
        sample_rate,
        frame_duration_ms,
        max_duration_ms,
        silence_timeout_ms,
        start_speech_timeout_ms,
        energy_threshold,
        min_utterance_ms,
        speech_start_frames,
    ):
        frames = []
        chunk_queue = queue.Queue()
        blocksize = max(160, int(sample_rate * (frame_duration_ms / 1000.0)))
        speech_detected = False
        stream_started_at = time.monotonic()
        speech_run = 0
        silence_run = 0
        max_rms = 0.0
        noise_floor = max(0.001, energy_threshold * 0.35)
        pre_roll_frames = max(2, int(300 / max(10, frame_duration_ms)))
        min_utterance_frames = max(1, int(min_utterance_ms / max(10, frame_duration_ms)))
        silence_frames = max(1, int(silence_timeout_ms / max(10, frame_duration_ms)))
        preroll = []
        current_frames = []

        def callback(indata, frame_count, time_info, status):
            if status:
                emit({"event": "warning", "message": str(status)})
            chunk_queue.put(indata.copy().reshape(-1))

        with sd.InputStream(
            samplerate=sample_rate,
            channels=1,
            dtype="float32",
            blocksize=blocksize,
            callback=callback,
        ):
            while not self.cancel_event.is_set():
                elapsed_ms = (time.monotonic() - stream_started_at) * 1000.0
                if elapsed_ms >= max_duration_ms:
                    break

                try:
                    chunk = chunk_queue.get(timeout=0.25)
                except queue.Empty:
                    if not speech_detected and elapsed_ms >= start_speech_timeout_ms:
                        break
                    continue

                frames.append(chunk)
                rms = float(np.sqrt(np.mean(np.square(chunk)))) if chunk.size else 0.0
                if rms > max_rms:
                    max_rms = rms
                preroll.append(chunk)
                if len(preroll) > pre_roll_frames:
                    preroll.pop(0)

                speech = self._detect_speech(chunk, rms, sample_rate, energy_threshold, noise_floor)
                if not speech_detected:
                    if speech:
                        speech_run += 1
                    else:
                        speech_run = 0
                        noise_floor = self._update_noise_floor(noise_floor, rms)

                    if speech_run >= speech_start_frames:
                        speech_detected = True
                        current_frames = list(preroll)
                        silence_run = 0
                        speech_run = 0
                    elif elapsed_ms >= start_speech_timeout_ms:
                        break
                    continue

                current_frames.append(chunk)
                if speech:
                    silence_run = 0
                else:
                    silence_run += 1

                utterance_exceeded = len(current_frames) >= max(1, int(max_duration_ms / max(10, frame_duration_ms)))
                if silence_run >= silence_frames or utterance_exceeded:
                    break

        if self.cancel_event.is_set():
            return None, {"speech_detected": False, "cancelled": True}

        if not frames:
            return np.array([], dtype=np.float32), {
                "speech_detected": False,
                "cancelled": False,
                "max_rms": max_rms,
            }

        if speech_detected and current_frames:
            if silence_run > 0:
                trim_frames = max(0, silence_run - max(1, pre_roll_frames // 2))
                if trim_frames > 0:
                    current_frames = current_frames[:-trim_frames] if trim_frames < len(current_frames) else []
            audio_frames = current_frames
        else:
            audio_frames = frames

        audio = np.concatenate(audio_frames).astype(np.float32, copy=False) if audio_frames else np.array([], dtype=np.float32)
        duration_ms = int((len(audio) / float(sample_rate)) * 1000.0) if audio.size else 0
        fallback_candidate = (
            not speech_detected
            and audio.size > 0
            and duration_ms >= min(start_speech_timeout_ms, 1500)
            and max_rms >= max(energy_threshold * 0.35, 0.0015)
        )
        if speech_detected and len(audio_frames) < min_utterance_frames:
            speech_detected = False
            fallback_candidate = False

        return audio, {
            "speech_detected": speech_detected,
            "fallback_candidate": fallback_candidate,
            "cancelled": False,
            "duration_ms": duration_ms,
            "max_rms": max_rms,
            "noise_floor": noise_floor,
        }

    def handle_listen(self, payload):
        with self.listen_lock:
            if self.listen_thread and self.listen_thread.is_alive():
                emit({"event": "error", "message": "Recognizer is already listening"})
                return

            self.cancel_event.clear()

            def run():
                try:
                    sample_rate = int(payload.get("sampleRate", self.args.sample_rate))
                    frame_duration_ms = int(payload.get("frameDurationMs", self.args.frame_duration_ms))
                    max_duration_ms = int(payload.get("maxDurationMs", self.args.max_duration_ms))
                    silence_timeout_ms = int(payload.get("silenceTimeoutMs", self.args.silence_timeout_ms))
                    start_speech_timeout_ms = int(
                        payload.get("startSpeechTimeoutMs", self.args.start_speech_timeout_ms)
                    )
                    energy_threshold = float(
                        payload.get("energyThreshold", self.args.energy_threshold)
                    )
                    min_utterance_ms = int(payload.get("minUtteranceMs", self.args.min_utterance_ms))
                    speech_start_frames = int(payload.get("speechStartFrames", self.args.speech_start_frames))
                    language = payload.get("language") or self.args.language or None

                    emit({"event": "listening_started"})

                    audio, capture_meta = self.capture_audio(
                        sample_rate=sample_rate,
                        frame_duration_ms=frame_duration_ms,
                        max_duration_ms=max_duration_ms,
                        silence_timeout_ms=silence_timeout_ms,
                        start_speech_timeout_ms=start_speech_timeout_ms,
                        energy_threshold=energy_threshold,
                        min_utterance_ms=min_utterance_ms,
                        speech_start_frames=speech_start_frames,
                    )

                    if capture_meta.get("cancelled"):
                        emit({"event": "listening_stopped", "cancelled": True})
                        return

                    should_transcribe = bool(
                        capture_meta.get("speech_detected")
                        or capture_meta.get("fallback_candidate")
                    )

                    if audio is None or audio.size == 0 or not should_transcribe:
                        emit({
                            "event": "result",
                            "text": "",
                            "confidence": 0.0,
                            "isFinal": True,
                            "speechDetected": False,
                            "fallbackCandidate": capture_meta.get("fallback_candidate", False),
                            "durationMs": capture_meta.get("duration_ms", 0),
                            "maxRms": capture_meta.get("max_rms", 0.0),
                            "noiseFloor": capture_meta.get("noise_floor", 0.0),
                        })
                        emit({"event": "listening_stopped", "cancelled": False})
                        return

                    segments_iter, info = self.model.transcribe(
                        audio,
                        language=language,
                        beam_size=1,
                        best_of=1,
                        vad_filter=False,
                        condition_on_previous_text=False,
                    )
                    segments = list(segments_iter)
                    text = " ".join(segment.text.strip() for segment in segments if segment.text).strip()
                    confidence = compute_confidence(segments)

                    emit({
                        "event": "result",
                        "text": text,
                        "confidence": confidence,
                        "isFinal": True,
                        "speechDetected": bool(capture_meta.get("speech_detected")),
                        "fallbackCandidate": bool(capture_meta.get("fallback_candidate")),
                        "durationMs": capture_meta.get("duration_ms", 0),
                        "maxRms": capture_meta.get("max_rms", 0.0),
                        "noiseFloor": capture_meta.get("noise_floor", 0.0),
                        "language": getattr(info, "language", language),
                        "languageProbability": float(getattr(info, "language_probability", 0.0) or 0.0),
                    })
                    emit({"event": "listening_stopped", "cancelled": False})
                except Exception as exc:
                    emit({"event": "error", "message": str(exc)})
                    emit({"event": "listening_stopped", "cancelled": False})

            self.listen_thread = threading.Thread(target=run, daemon=True)
            self.listen_thread.start()

    def cancel(self):
        self.cancel_event.set()

    def shutdown(self):
        self.cancel()
        if self.listen_thread and self.listen_thread.is_alive():
            self.listen_thread.join(timeout=1.0)

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
        threshold = max(energy_threshold * 1.2, noise_floor * 2.4, 0.0035)
        rms_gate = rms >= threshold
        if self.vad is None:
            return rms_gate

        try:
          pcm = (np.clip(frame, -1.0, 1.0) * 32767.0).astype(np.int16).tobytes()
          vad_gate = self.vad.is_speech(pcm, sample_rate)
        except Exception:
          vad_gate = False

        return bool(vad_gate and rms >= max(noise_floor * 1.05, energy_threshold * 0.5)) or rms_gate

    def _update_noise_floor(self, noise_floor, rms):
        bounded = max(0.0005, min(rms, 0.05))
        return (noise_floor * 0.97) + (bounded * 0.03)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-name", default="small.en")
    parser.add_argument("--language", default="en")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--sample-rate", type=int, default=16000)
    parser.add_argument("--frame-duration-ms", type=int, default=20)
    parser.add_argument("--max-duration-ms", type=int, default=12000)
    parser.add_argument("--silence-timeout-ms", type=int, default=2000)
    parser.add_argument("--start-speech-timeout-ms", type=int, default=4000)
    parser.add_argument("--energy-threshold", type=float, default=0.003)
    parser.add_argument("--min-utterance-ms", type=int, default=250)
    parser.add_argument("--speech-start-frames", type=int, default=2)
    parser.add_argument("--vad-aggressiveness", type=int, default=2)
    parser.add_argument("--model-cache-dir", default=None)
    return parser.parse_args()


def main():
    try:
        args = parse_args()
        worker = WhisperWorker(args)
        emit({
            "event": "ready",
            "backend": "whisper-local",
            "model": args.model_name,
            "language": args.language,
        })

        for raw_line in sys.stdin:
            line = raw_line.strip()
            if not line:
                continue

            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                emit({"event": "error", "message": "Invalid worker payload"})
                continue

            command = payload.get("command")
            if command == "listen":
                worker.handle_listen(payload)
            elif command == "cancel":
                worker.cancel()
            elif command == "shutdown":
                worker.shutdown()
                break
            else:
                emit({"event": "error", "message": f"Unknown worker command: {command}"})
    except Exception as exc:
        emit({"event": "error", "message": str(exc)})
        raise


if __name__ == "__main__":
    main()
