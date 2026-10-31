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
	const String text = FileAccess::get_file_as_string(p_path);
	JSON json;
	if (json.parse(text) != OK || json.get_data().get_type() != Variant::DICTIONARY) {
		animations.clear();
		load_error = U("Não é um projeto de personagem (JSON inválido).");
		return load_error;
	}
	if (character_name.is_empty()) {
		character_name = p_path.get_file().get_basename().get_basename();
	}
	data = json.get_data();
	return _parse_data();
}

String MDPersonagem::set_data(const Dictionary &p_data) {
	data = p_data;
	const String problem = _parse_data();
	emit_changed();
	return problem;
}

HashMap<String, String> MDPersonagem::get_sources() const {
	HashMap<String, String> sources;
	for (const Variant &item : Array(data.get("sources", Array()))) {
		const Dictionary source = item;
		sources[source.get("id", "")] = res_path(source.get("path", ""));
	}
	if (sources.is_empty() && data.has("source")) {
		sources["sheet-1"] = res_path(Dictionary(data["source"]).get("path", ""));
	}
	return sources;
}

namespace {
// O JSON do Godot lê todo número como real; os inteiros voltam a ser inteiros ao gravar.
Variant integral(const Variant &p_value) {
	if (p_value.get_type() == Variant::FLOAT && double(p_value) == Math::floor(double(p_value)) && Math::abs(double(p_value)) < 1e15) {
		return int64_t(double(p_value));
	}
	if (p_value.get_type() == Variant::DICTIONARY) {
		Dictionary out;
		const Dictionary in = p_value;
		for (const Variant &key : in.keys()) {
			out[key] = integral(in[key]);
		}
		return out;
	}
	if (p_value.get_type() == Variant::ARRAY) {
		Array out;
		for (const Variant &item : Array(p_value)) {
			out.push_back(integral(item));
		}
		return out;
	}
	return p_value;
}
} // namespace

Error MDPersonagem::save_to_file(const String &p_path) {
	const String path = p_path.is_empty() ? get_path() : p_path;
	bool offsets = false;
	for (const Animacao &anim : animations) {
		for (const Quadro &q : anim.frames) {
			offsets = offsets || q.offset != Vector2i();
		}
	}
	if (offsets && to_int(data.get("version", 0), 0) < 8) {
		data["version"] = 8;
	}
	const Ref<FileAccess> file = FileAccess::open(path, FileAccess::WRITE);
	ERR_FAIL_COND_V(file.is_null(), ERR_CANT_OPEN);
	file->store_string(JSON::stringify(integral(data), "  ", false) + "\n");
	return OK;
}

String MDPersonagem::_parse_data() {
	animations.clear();
	auto fail = [&](const String &p_problem) {
		load_error = p_problem;
		return load_error;
	};
	if (String(data.get("format", "")) != "retro-studio-charset-project") {
		return fail(U("Não é um projeto de personagem do Retro Studio."));
	}
	const int version = to_int(data.get("version", 0), 0);
	if (version > 8) {
		return fail(vformat(U("Versão %d do formato é mais nova que este editor."), version));
	}
	character_name = data.get("characterName", character_name);
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
	for (int index = 0; index < animation_list.size(); index++) {
		const Dictionary a = animation_list[index];
		Animacao anim;
		anim.index = index;
		anim.name = a.get("name", "");
		anim.loop = !(a.has("loop") && a["loop"].get_type() == Variant::BOOL && !bool(a["loop"]));
		anim.fps = CLAMP(to_int(a.get("fps", 8), 8), 1, 60);
		const int default_ticks = CLAMP(int(Math::round(60.0 / anim.fps)), 1, 255);
		const String anim_source = sources.has(a.get("sourceId", "")) ? sources[a.get("sourceId", "")] : first_source;
		String anim_source_id = a.get("sourceId", "");
		if (!sources.has(anim_source_id)) {
			anim_source_id = source_list.is_empty() ? String("sheet-1") : String(Dictionary(source_list[0]).get("id", ""));
		}
		const Vector2i anim_anchor(to_int(a.get("anchorX", 0), 0), to_int(a.get("anchorY", 0), 0));
		if (a.get("frames", Variant()).get_type() == Variant::ARRAY) {
			// Quadros livres: cada um com retângulo, folha, apoio, ajuste fino e tempo próprios.
			for (const Variant &frame_item : Array(a["frames"])) {
				const Dictionary f = frame_item;
				Quadro quadro;
				quadro.source = sources.has(f.get("sourceId", "")) ? sources[f.get("sourceId", "")] : anim_source;
				quadro.source_id = sources.has(f.get("sourceId", "")) ? String(f.get("sourceId", "")) : anim_source_id;
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
			const int columns = MAX(1, to_int(a.get("columns", 0), 0) > 0 ? to_int(a["columns"], 1) : (region.size.x + gap.x) / step.x);
			const int rows = MAX(1, to_int(a.get("rows", 0), 0) > 0 ? to_int(a["rows"], 1) : (region.size.y + gap.y) / step.y);
			const int count = to_int(a.get("frameCount", 0), 0) > 0 ? MIN(to_int(a["frameCount"], 1), columns * rows) : columns * rows;
			for (int i = 0; i < MIN(count, 255); i++) {
				Quadro quadro;
				quadro.source = anim_source;
				quadro.source_id = anim_source_id;
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
	// Sem animações não é erro: um personagem novo começa vazio no gestor de animações.
	return fail(String());
}

Ref<Image> MDPersonagem::load_sheet(const String &p_path) {
	Ref<Image> image;
	image.instantiate();
	const Vector<uint8_t> bytes = FileAccess::get_file_as_bytes(p_path);
	const String ext = p_path.get_extension().to_lower();
	const Error err = bytes.is_empty() ? ERR_FILE_NOT_FOUND : ext == "png" ? image->load_png_from_buffer(bytes) : ext == "webp" ? image->load_webp_from_buffer(bytes) : image->load(p_path);
	return err == OK && !image->is_empty() ? image : Ref<Image>();
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
				Ref<Image> sheet = load_sheet(q.source);
				if (sheet.is_null()) {
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
