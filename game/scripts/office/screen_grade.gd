class_name ScreenGrade
extends CanvasLayer
## Grading da quadro sull'intero frame (ricetta DE, ANALISI-GIOCHI §6):
## vignette forte, grana pittorica animata, leggera desaturazione fredda.
## Sta sotto l'HUD e i dialoghi: l'interfaccia resta nitida.

const SHADER := """
shader_type canvas_item;

uniform float vignette_strength : hint_range(0.0, 2.0) = 0.95;
uniform float grain_amount : hint_range(0.0, 0.2) = 0.045;
uniform float desaturate : hint_range(0.0, 1.0) = 0.0;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void fragment() {
	vec2 uv = UV;
	// vignette: scura e morbida verso i bordi, come un quadro illuminato al centro
	float d = distance(uv, vec2(0.5, 0.46));
	float vig = smoothstep(0.38, 0.92, d) * vignette_strength;
	// grana animata a blocchi piccoli (pennello sporco, non rumore digitale)
	float g = hash(floor(uv * vec2(680.0, 400.0)) + floor(TIME * 9.0));
	float alpha = clamp(vig + grain_amount, 0.0, 0.88);
	vec3 base = vec3(0.02, 0.02, 0.035);
	vec3 grain_col = vec3(g * 0.30);
	vec3 col = (base * vig + grain_col * grain_amount) / max(alpha, 0.001);
	COLOR = vec4(col, alpha);
}
"""

func _init() -> void:
	layer = 8  # sopra il mondo, sotto HUD (10) e dialoghi (60)

func _ready() -> void:
	var rect := ColorRect.new()
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var mat := ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = SHADER
	mat.shader = sh
	rect.material = mat
	add_child(rect)
