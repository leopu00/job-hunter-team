extends Node
## Autoload `Sfx`: suoni UI procedurali (nessun file audio binario in repo).
## Toni sintetizzati a runtime come AudioStreamWAV 16-bit mono.

const MIX_RATE := 44100

var _tick: AudioStreamWAV
var _blip: AudioStreamWAV
var _confirm: AudioStreamWAV
var _back: AudioStreamWAV
var _deny: AudioStreamWAV
var _shutter: AudioStreamWAV
var _ding: AudioStreamWAV

var _pool: Array[AudioStreamPlayer] = []
var _next := 0

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	if not await Game.windows_health_boot_allowed():
		return
	Game.mark_windows_health_normal_work("sfx")
	_tick = _tone([[1500.0, 0.014]], -18.0)
	_blip = _tone([[880.0, 0.05]], -12.0)
	_confirm = _tone([[660.0, 0.05], [990.0, 0.07]], -10.0)
	_back = _tone([[440.0, 0.05], [330.0, 0.06]], -12.0)
	_deny = _tone([[220.0, 0.11]], -10.0)
	_shutter = _noise_burst(0.05, -8.0)
	_ding = _tone([[1318.5, 0.09], [1760.0, 0.22]], -12.0)
	for i in 6:
		var p := AudioStreamPlayer.new()
		p.bus = "Master"
		add_child(p)
		_pool.append(p)

func play_tick() -> void:
	_play(_tick)

func play_blip() -> void:
	_play(_blip)

func play_confirm() -> void:
	_play(_confirm)

func play_back() -> void:
	_play(_back)

func play_deny() -> void:
	_play(_deny)

func play_shutter() -> void:
	_play(_shutter)

func play_ding() -> void:
	_play(_ding)

func _play(stream: AudioStreamWAV) -> void:
	var p := _pool[_next]
	_next = (_next + 1) % _pool.size()
	p.stream = stream
	p.play()

## Hum ambientale della box: bordone basso + soffio, loop senza giunture.
## Chiamato dall'ufficio; ritorna il player così la scena lo gestisce.
func make_ambient_hum() -> AudioStreamPlayer:
	var dur := 4.0
	var n := int(dur * MIX_RATE)
	var data := PackedByteArray()
	var rng := RandomNumberGenerator.new()
	rng.seed = 42
	var brown := 0.0
	for i in n:
		var t := float(i) / MIX_RATE
		# bordone elettrico (55Hz + quinta lieve) + rumore browniano soffiato
		var v := sin(TAU * 55.0 * t) * 0.5 + sin(TAU * 82.5 * t) * 0.18
		brown = clampf(brown + rng.randf_range(-1.0, 1.0) * 0.02, -0.35, 0.35)
		v = (v + brown) * 0.32
		var s := int(clamp(v, -1.0, 1.0) * 32767.0)
		data.append(s & 0xff)
		data.append((s >> 8) & 0xff)
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = MIX_RATE
	wav.stereo = false
	wav.data = data
	wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
	wav.loop_begin = 0
	wav.loop_end = n
	var p := AudioStreamPlayer.new()
	p.stream = wav
	p.volume_db = -30.0
	p.autoplay = true
	return p

## Scatto meccanico: burst di rumore bianco con decadimento rapidissimo.
func _noise_burst(dur: float, vol_db: float) -> AudioStreamWAV:
	var amp := db_to_linear(vol_db)
	var data := PackedByteArray()
	var n := int(dur * MIX_RATE)
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	for i in n:
		var t := float(i) / MIX_RATE
		var env := exp(-t * 90.0)
		var v := rng.randf_range(-1.0, 1.0) * amp * env
		var s := int(clamp(v, -1.0, 1.0) * 32767.0)
		data.append(s & 0xff)
		data.append((s >> 8) & 0xff)
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = MIX_RATE
	wav.stereo = false
	wav.data = data
	return wav

## segments = [[freq_hz, durata_s], …] suonati in sequenza, inviluppo a decadimento.
func _tone(segments: Array, vol_db: float) -> AudioStreamWAV:
	var amp := db_to_linear(vol_db)
	var data := PackedByteArray()
	for seg in segments:
		var freq: float = seg[0]
		var dur: float = seg[1]
		var n := int(dur * MIX_RATE)
		for i in n:
			var t := float(i) / MIX_RATE
			var env := exp(-t * 22.0) * (1.0 - float(i) / n)
			var v := sin(TAU * freq * t) * amp * env
			var s := int(clamp(v, -1.0, 1.0) * 32767.0)
			data.append(s & 0xff)
			data.append((s >> 8) & 0xff)
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = MIX_RATE
	wav.stereo = false
	wav.data = data
	return wav
