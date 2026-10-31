#include "retro_image_convert.h"

#include "../scene/md_personagem.h"

#include "retro_sgdk_export.h"

#include "core/config/project_settings.h"
#include "core/io/file_access.h"
#include "core/io/image.h"
#include "core/object/callable_mp.h"
#include "core/templates/hash_map.h"
#include "core/templates/sort_array.h"
#include "editor/file_system/editor_file_system.h"
#include "editor/gui/editor_toaster.h"

namespace {

String U(const char *p_text) {
	return String::utf8(p_text);
}

const int MAX_COLORS = 15; // A cor 0 é a transparência.

// Cor na grade do console: nível de 0 a 7 por canal.
struct Level {
	int r = 0, g = 0, b = 0;
};

int to_level(float p_channel) {
	return CLAMP(int(Math::round(p_channel * 7.0f)), 0, 7);
}

struct Entry {
	Level color;
	int count = 0;
};

int channel(const Level &p_level, int p_axis) {
	return p_axis == 0 ? p_level.r : p_axis == 1 ? p_level.g : p_level.b;
}

struct ByChannel {
	int axis = 0;
	bool operator()(const Entry &p_a, const Entry &p_b) const { return channel(p_a.color, axis) < channel(p_b.color, axis); }
};

// Corte na mediana: divide as cores na maior faixa até sobrarem no máximo MAX_COLORS caixas, e cada
// caixa vira a média das suas cores (pesada pelo número de pixels), de volta à grade do console.
Vector<Level> median_cut(Vector<Entry> p_entries) {
	struct Box {
		int begin = 0, end = 0; // Faixa em p_entries.
	};
	Vector<Box> boxes;
	boxes.push_back({ 0, (int)p_entries.size() });
	while (boxes.size() < MAX_COLORS) {
		int best = -1, best_axis = 0, best_score = 0;
		for (int i = 0; i < boxes.size(); i++) {
			if (boxes[i].end - boxes[i].begin < 2) {
				continue;
			}
			for (int axis = 0; axis < 3; axis++) {
				int lo = 7, hi = 0, pixels = 0;
				for (int e = boxes[i].begin; e < boxes[i].end; e++) {
					lo = MIN(lo, channel(p_entries[e].color, axis));
					hi = MAX(hi, channel(p_entries[e].color, axis));
					pixels += p_entries[e].count;
				}
				const int score = (hi - lo + 1) * (hi - lo + 1) * pixels;
				if (hi > lo && score > best_score) {
					best = i;
					best_axis = axis;
					best_score = score;
				}
			}
		}
		if (best < 0) {
			break; // Nenhuma caixa dá para dividir.
		}
		Box box = boxes[best];
		Entry *data = p_entries.ptrw();
		SortArray<Entry, ByChannel> sorter;
		sorter.compare.axis = best_axis;
		sorter.sort(data + box.begin, box.end - box.begin);
		int total = 0;
		for (int e = box.begin; e < box.end; e++) {
			total += p_entries[e].count;
		}
		int split = box.begin + 1, acc = 0;
		for (int e = box.begin; e < box.end - 1; e++) {
			acc += p_entries[e].count;
			split = e + 1;
			if (acc * 2 >= total) {
				break;
			}
		}
		boxes.write[best] = { box.begin, split };
		boxes.push_back({ split, box.end });
	}
	Vector<Level> palette;
	for (const Box &box : boxes) {
		double r = 0, g = 0, b = 0, n = 0;
		for (int e = box.begin; e < box.end; e++) {
			r += p_entries[e].color.r * p_entries[e].count;
			g += p_entries[e].color.g * p_entries[e].count;
			b += p_entries[e].color.b * p_entries[e].count;
			n += p_entries[e].count;
		}
		palette.push_back({ int(Math::round(r / n)), int(Math::round(g / n)), int(Math::round(b / n)) });
	}
	return palette;
}

} // namespace

namespace RetroImageConvert {

int quantize(const Ref<Image> &p_image, Vector<uint8_t> &r_indices, Vector<Color> &r_palette) {
	const int width = p_image->get_width(), height = p_image->get_height();
	// Cores na grade do console e quantos pixels usam cada uma.
	HashMap<int, int> histogram;
	for (int y = 0; y < height; y++) {
		for (int x = 0; x < width; x++) {
			const Color color = p_image->get_pixel(x, y);
			if (color.a >= 0.5) {
				histogram[to_level(color.r) << 6 | to_level(color.g) << 3 | to_level(color.b)]++;
			}
		}
	}
	Vector<Entry> entries;
	for (const KeyValue<int, int> &E : histogram) {
		entries.push_back({ { E.key >> 6, (E.key >> 3) & 7, E.key & 7 }, E.value });
	}
	Vector<Level> palette;
	if (entries.size() <= MAX_COLORS) {
		for (const Entry &entry : entries) {
			palette.push_back(entry.color);
		}
	} else {
		palette = median_cut(entries);
	}
	// Cada pixel vai para a cor mais próxima da paleta (índices 1 a 15; o 0 é a transparência).
	HashMap<int, uint8_t> nearest;
	r_indices.resize(int64_t(width) * height);
	memset(r_indices.ptrw(), 0, r_indices.size());
	for (int y = 0; y < height; y++) {
		for (int x = 0; x < width; x++) {
			const Color color = p_image->get_pixel(x, y);
			if (color.a < 0.5) {
				continue;
			}
			const int key = to_level(color.r) << 6 | to_level(color.g) << 3 | to_level(color.b);
			if (!nearest.has(key)) {
				int best = 0, best_distance = INT_MAX;
				for (int i = 0; i < palette.size(); i++) {
					const int dr = palette[i].r - (key >> 6), dg = palette[i].g - ((key >> 3) & 7), db = palette[i].b - (key & 7);
					const int distance = dr * dr * 3 + dg * dg * 4 + db * db * 2; // O olho vê mais o verde.
					if (distance < best_distance) {
						best = i;
						best_distance = distance;
					}
				}
				nearest[key] = best + 1;
			}
			r_indices.write[int64_t(y) * width + x] = nearest[key];
		}
	}
	r_palette.clear();
	r_palette.push_back(Color(0, 0, 0));
	for (const Level &level : palette) {
		r_palette.push_back(Color::from_rgba8(level.r * 36, level.g * 36, level.b * 36));
	}
	return entries.size();
}

String convert(const String &p_path, String &r_message) {
	Ref<Image> image = MDPersonagem::load_sheet(p_path);
	if (image.is_null()) {
		r_message = U("Não foi possível ler ") + p_path.get_file() + ".";
		return String();
	}
	image->convert(Image::FORMAT_RGBA8);
	const int width = (image->get_width() + 7) / 8 * 8, height = (image->get_height() + 7) / 8 * 8;
	Vector<uint8_t> pixels;
	Vector<Color> colors;
	const int original_colors = quantize(image, pixels, colors);
	if (original_colors == 0) {
		r_message = p_path.get_file() + U(" é toda transparente.");
		return String();
	}
	// Completa até múltiplos de 8 com transparente.
	Vector<uint8_t> indices;
	indices.resize(int64_t(width) * height);
	memset(indices.ptrw(), 0, indices.size());
	for (int y = 0; y < image->get_height(); y++) {
		memcpy(indices.ptrw() + int64_t(y) * width, pixels.ptr() + int64_t(y) * image->get_width(), image->get_width());
	}
	const int palette_size = colors.size() - 1;

	const String out_path = p_path.get_basename() + "_md.png";
	const Vector<uint8_t> png = RetroSgdkExport::indexed_png(width, height, indices, colors);
	const Ref<FileAccess> file = FileAccess::open(out_path, FileAccess::WRITE);
	if (file.is_null()) {
		r_message = U("Não foi possível gravar ") + out_path.get_file() + ".";
		return String();
	}
	file->store_buffer(png.ptr(), png.size());
	r_message = vformat(U("%s gravado: %d×%d, %d cores"), out_path.get_file(), width, height, palette_size);
	if (original_colors > palette_size) {
		r_message += vformat(U(" (de %d)"), original_colors);
	}
	if (width != image->get_width() || height != image->get_height()) {
		r_message += vformat(U("; o tamanho era %d×%d e foi completado com transparente até múltiplos de 8"), image->get_width(), image->get_height());
	}
	r_message += ".";
	return out_path;
}

} // namespace RetroImageConvert

void RetroImageMenu::get_options(const Vector<String> &p_paths) {
	for (const String &path : p_paths) {
		if (path.get_extension().to_lower() != "png") {
			return;
		}
	}
	add_context_menu_item(U("Converter para o Mega Drive"), callable_mp(this, &RetroImageMenu::_convert), Ref<Texture2D>());
}

void RetroImageMenu::_convert(const Vector<String> &p_paths) {
	for (const String &path : p_paths) {
		String message;
		const bool ok = !RetroImageConvert::convert(path, message).is_empty();
		EditorToaster::get_singleton()->popup_str(message, ok ? EditorToaster::SEVERITY_INFO : EditorToaster::SEVERITY_ERROR);
	}
	EditorFileSystem::get_singleton()->scan_changes();
}
