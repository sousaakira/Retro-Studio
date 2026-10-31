#include "md_personagem.h"

#include "core/io/file_access.h"
#include "core/io/json.h"
#include "core/object/class_db.h"

namespace {

String U(const char *p_text) {
	return String::utf8(p_text);
}

int to_int(const Variant &p_value, int p_default) {
	return p_value.get_type() == Variant::INT || p_value.get_type() == Variant::FLOAT ? int(Math::round(double(p_value))) : p_default;
}

Rect2i to_rect(const Variant &p_value) {
	const Dictionary d = p_value;
	return Rect2i(to_int(d.get("x", 0), 0), to_int(d.get("y", 0), 0), to_int(d.get("width", 0), 0), to_int(d.get("height", 0), 0));
}

// Caminho da folha como o projeto guarda (relativo, ex.: charsets/x.png) para res://.
String res_path(const String &p_path) {
	if (p_path.begins_with("res://") || p_path.is_absolute_path()) {
		return p_path;
	}
	return "res://" + p_path.trim_prefix("./");
}

} // namespace

String MDPersonagem::parse(const String &p_path) {
	animations.clear();
	auto fail = [&](const String &p_problem) {
		load_error = p_problem;
		return load_error;
	};
	const String text = FileAccess::get_file_as_string(p_path);
	JSON json;
	if (json.parse(text) != OK || json.get_data().get_type() != Variant::DICTIONARY) {
		return fail(U("Não é um projeto de personagem (JSON inválido)."));
	}
	const Dictionary data = json.get_data();
	if (String(data.get("format", "")) != "retro-studio-charset-project") {
		return fail(U("Não é um projeto de personagem do Retro Studio."));
	}
	const int version = to_int(data.get("version", 0), 0);
	if (version > 8) {
		return fail(vformat(U("Versão %d do formato é mais nova que este editor."), version));
	}
	character_name = data.get("characterName", p_path.get_file().get_basename().get_basename());
	if (data.has("bodyBox")) {
		body_box = to_rect(data["bodyBox"]);
	}
	// Folhas: id → caminho. Projetos antigos (versão < 7) têm uma folha só, em "source".
	HashMap<String, String> sources;
	String first_source;
	const Array source_list = data.get("sources", Array());
	for (const Variant &item : source_list) {
		const Dictionary source = item;
		const String id = source.get("id", "");
		const String path = res_path(source.get("path", ""));
		sources[id] = path;
		if (first_source.is_empty()) {
			first_source = path;
		}
	}
	if (sources.is_empty() && data.has("source")) {
		first_source = res_path(Dictionary(data["source"]).get("path", ""));
		sources["sheet-1"] = first_source;
	}
	const Array animation_list = data.get("animations", Array());
	for (const Variant &item : animation_list) {
		const Dictionary a = item;
		Animacao anim;
		anim.name = a.get("name", "");
		anim.loop = !(a.has("loop") && a["loop"].get_type() == Variant::BOOL && !bool(a["loop"]));
		anim.fps = CLAMP(to_int(a.get("fps", 8), 8), 1, 60);
		const int default_ticks = CLAMP(int(Math::round(60.0 / anim.fps)), 1, 255);
		const String anim_source = sources.has(a.get("sourceId", "")) ? sources[a.get("sourceId", "")] : first_source;
		const Vector2i anim_anchor(to_int(a.get("anchorX", 0), 0), to_int(a.get("anchorY", 0), 0));
		if (a.get("frames", Variant()).get_type() == Variant::ARRAY) {
			// Quadros livres: cada um com retângulo, folha, apoio, ajuste fino e tempo próprios.
			for (const Variant &frame_item : Array(a["frames"])) {
				const Dictionary f = frame_item;
				Quadro quadro;
				quadro.source = sources.has(f.get("sourceId", "")) ? sources[f.get("sourceId", "")] : anim_source;
				quadro.rect = Rect2i(to_int(f.get("x", 0), 0), to_int(f.get("y", 0), 0), to_int(f.get("width", 1), 1), to_int(f.get("height", 1), 1));
				quadro.anchor = Vector2i(CLAMP(to_int(f.get("anchorX", quadro.rect.size.x / 2), 0), 0, quadro.rect.size.x), CLAMP(to_int(f.get("anchorY", quadro.rect.size.y), 0), 0, quadro.rect.size.y));
				quadro.offset = Vector2i(CLAMP(to_int(f.get("offsetX", 0), 0), -128, 128), CLAMP(to_int(f.get("offsetY", 0), 0), -128, 128));
				quadro.ticks = CLAMP(to_int(f.get("durationTicks", default_ticks), default_ticks), 1, 255);
				anim.frames.push_back(quadro);
			}
		} else {
			// Faixa em grade: quadros em linhas a partir da região, com passo = quadro + espaço.
			const Rect2i region = to_rect(a.get("region", Dictionary()));
			const Vector2i size(MAX(1, to_int(a.get("frameWidth", 1), 1)), MAX(1, to_int(a.get("frameHeight", 1), 1)));
			const Vector2i gap(MAX(0, to_int(a.get("spacingX", 0), 0)), MAX(0, to_int(a.get("spacingY", 0), 0)));
			const Vector2i step = size + gap;
			const int columns = (region.size.x + gap.x) / step.x, rows = (region.size.y + gap.y) / step.y;
			for (int i = 0; i < MIN(columns * rows, 255); i++) {
				Quadro quadro;
				quadro.source = anim_source;
				quadro.rect = Rect2i(region.position + Vector2i(i % columns * step.x, i / columns * step.y), size);
				quadro.anchor = Vector2i(CLAMP(anim_anchor.x, 0, size.x), CLAMP(anim_anchor.y, 0, size.y));
				quadro.ticks = default_ticks;
				anim.frames.push_back(quadro);
			}
		}
		if (a.has("attack")) {
			const Dictionary attack = a["attack"];
			anim.attack = attack.get("enabled", false);
			anim.attack_box = to_rect(attack);
			anim.attack_first = to_int(attack.get("firstFrame", 0), 0);
			anim.attack_last = to_int(attack.get("lastFrame", 0), 0);
		}
		if (!anim.frames.is_empty()) {
			animations.push_back(anim);
		}
	}
	if (animations.is_empty()) {
		return fail(U("O personagem não tem animações."));
	}
	return fail(String());
}

PackedStringArray MDPersonagem::get_animation_names() const {
	PackedStringArray names;
	for (const Animacao &anim : animations) {
		names.push_back(anim.name);
	}
	return names;
}

int MDPersonagem::find_animation(const String &p_name) const {
	for (int i = 0; i < animations.size(); i++) {
		if (animations[i].name == p_name) {
			return i;
		}
	}
	return -1;
}

Vector<int> MDPersonagem::all_animations() const {
	Vector<int> list;
	for (int i = 0; i < animations.size(); i++) {
		list.push_back(i);
	}
	return list;
}

MDPersonagem::Celula MDPersonagem::get_cell(const Vector<int> &p_only) const {
	int left = 0, top = 0, right = 0, bottom = 0;
	for (int a : p_only.is_empty() ? all_animations() : p_only) {
		for (const Quadro &q : animations[a].frames) {
			left = MAX(left, q.anchor.x - q.offset.x);
			top = MAX(top, q.anchor.y - q.offset.y);
			right = MAX(right, q.rect.size.x - q.anchor.x + q.offset.x);
			bottom = MAX(bottom, q.rect.size.y - q.anchor.y + q.offset.y);
		}
	}
	Celula cell;
	cell.size = Vector2i(MAX(8, (left + right + 7) / 8 * 8), MAX(8, (top + bottom + 7) / 8 * 8));
	cell.anchor = Vector2i(left, top);
	return cell;
}

int MDPersonagem::get_max_frames(const Vector<int> &p_only) const {
	int most = 1;
	for (int a : p_only.is_empty() ? all_animations() : p_only) {
		most = MAX(most, animations[a].frames.size());
	}
	return most;
}

Ref<Image> MDPersonagem::build_atlas(String *r_error, const Vector<int> &p_only) const {
	const Vector<int> rows = p_only.is_empty() ? all_animations() : p_only;
	const Celula cell = get_cell(rows);
	const int columns = get_max_frames(rows);
	Ref<Image> atlas = Image::create_empty(columns * cell.size.x, MAX(1, rows.size()) * cell.size.y, false, Image::FORMAT_RGBA8);
	HashMap<String, Ref<Image>> sheets;
	for (int row = 0; row < rows.size(); row++) {
		const int a = rows[row];
		for (int f = 0; f < animations[a].frames.size(); f++) {
			const Quadro &q = animations[a].frames[f];
			if (!sheets.has(q.source)) {
				Ref<Image> sheet;
				sheet.instantiate();
				if (sheet->load(q.source) != OK) {
					if (r_error) {
						*r_error = U("Não foi possível ler a folha ") + q.source + ".";
					}
					return Ref<Image>();
				}
				sheet->convert(Image::FORMAT_RGBA8);
				sheets[q.source] = sheet;
			}
			const Vector2i at(f * cell.size.x + cell.anchor.x - q.anchor.x + q.offset.x, row * cell.size.y + cell.anchor.y - q.anchor.y + q.offset.y);
			atlas->blend_rect(sheets[q.source], q.rect, at);
		}
	}
	return atlas;
}

String MDPersonagem::get_timers(const Vector<int> &p_only) const {
	String timers = "[";
	for (int a : p_only.is_empty() ? all_animations() : p_only) {
		const Animacao &anim = animations[a];
		timers += "[";
		for (int f = 0; f < anim.frames.size(); f++) {
			timers += (f ? "," : "") + itos(anim.frames[f].ticks);
		}
		timers += "]";
	}
	return timers + "]";
}

void MDPersonagem::_bind_methods() {
	ClassDB::bind_method(D_METHOD("get_animation_names"), &MDPersonagem::get_animation_names);
}

// ---- Carregador ----

Ref<Resource> ResourceFormatLoaderMDPersonagem::load(const String &p_path, const String &p_original_path, Error *r_error, bool p_use_sub_threads, float *r_progress, CacheMode p_cache_mode) {
	Ref<MDPersonagem> personagem;
	personagem.instantiate();
	const String problem = personagem->parse(p_path);
	if (r_error) {
		*r_error = problem.is_empty() ? OK : ERR_FILE_CORRUPT;
	}
	ERR_FAIL_COND_V_MSG(!problem.is_empty(), Ref<Resource>(), p_path + ": " + problem);
	return personagem;
}

void ResourceFormatLoaderMDPersonagem::get_recognized_extensions(List<String> *p_extensions) const {
	p_extensions->push_back("json");
}

bool ResourceFormatLoaderMDPersonagem::recognize_path(const String &p_path, const String &p_for_type) const {
	return p_path.to_lower().ends_with(".charset.json");
}

bool ResourceFormatLoaderMDPersonagem::handles_type(const String &p_type) const {
	return p_type == "MDPersonagem" || p_type == "Resource";
}

String ResourceFormatLoaderMDPersonagem::get_resource_type(const String &p_path) const {
	return p_path.to_lower().ends_with(".charset.json") ? "MDPersonagem" : "";
}
