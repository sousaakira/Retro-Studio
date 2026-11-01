#include "retro_rom_releases.h"

#include "core/io/dir_access.h"
#include "core/io/file_access.h"
#include "core/io/json.h"
#include "core/object/callable_mp.h"
#include "core/os/os.h"
#include "core/os/time.h"
#include "core/config/project_settings.h"
#include "editor/themes/editor_scale.h"
#include "retro_sgdk_plugin.h"
#include "scene/gui/box_container.h"
#include "scene/gui/button.h"
#include "scene/gui/item_list.h"
#include "scene/gui/label.h"
#include "scene/gui/line_edit.h"
#include "scene/gui/rich_text_label.h"
#include "scene/gui/split_container.h"
#include "scene/gui/text_edit.h"
#include "servers/display/display_server.h"

namespace {

const char *FORMAT = "retro-studio.releases";
const int FORMAT_VERSION = 1;
const int MAX_CHANGES = 100;
const int MAX_CHANGE_TEXT = 300;
const int MAX_NOTES = 4000;
const int MAX_TITLE = 48;

String U(const char *p_text) {
	return String::utf8(p_text);
}

// Partes de "1.2.3" ou "1.2.3-beta": major, minor, patch e a prévia (vazia na final).
bool split_version(const String &p_version, int r_numbers[3], String &r_label) {
	const String text = p_version.strip_edges();
	const int dash = text.find_char('-');
	const String numbers = dash < 0 ? text : text.substr(0, dash);
	r_label = dash < 0 ? String() : text.substr(dash + 1);
	const Vector<String> parts = numbers.split(".");
	if (parts.size() != 3) {
		return false;
	}
	for (int i = 0; i < 3; i++) {
		if (parts[i].is_empty() || parts[i].length() > 4 || !parts[i].is_valid_int()) {
			return false;
		}
		for (int j = 0; j < parts[i].length(); j++) {
			if (!is_digit(parts[i][j])) {
				return false;
			}
		}
		r_numbers[i] = parts[i].to_int();
	}
	if (dash >= 0) {
		if (r_label.is_empty() || r_label.length() > 20 || !is_ascii_alphanumeric_char(r_label[0])) {
			return false;
		}
		for (int j = 0; j < r_label.length(); j++) {
			const char32_t c = r_label[j];
			if (!is_ascii_alphanumeric_char(c) && c != '.' && c != '-') {
				return false;
			}
		}
	}
	return true;
}

// Sem acentos: o cabeçalho da ROM e os nomes de arquivo só aceitam ASCII.
String strip_accents(const String &p_text) {
	static const char *from = "áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ";
	static const char *to = "aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN";
	const String accents = String::utf8(from);
	String out;
	for (int i = 0; i < p_text.length(); i++) {
		const int at = accents.find_char(p_text[i]);
		out += at >= 0 ? String::chr(to[at]) : String::chr(p_text[i]);
	}
	return out;
}

String header_title(const String &p_text) {
	const String plain = strip_accents(p_text);
	String out;
	for (int i = 0; i < plain.length(); i++) {
		if (plain[i] >= 0x20 && plain[i] <= 0x7e) {
			out += String::chr(plain[i]);
		}
	}
	return out.strip_edges().left(MAX_TITLE);
}

String slug(const String &p_name) {
	const String plain = strip_accents(p_name).to_lower();
	String out;
	for (int i = 0; i < plain.length(); i++) {
		const char32_t c = plain[i];
		if (is_ascii_alphanumeric_char(c)) {
			out += String::chr(c);
		} else if (!out.is_empty() && !out.ends_with("-")) {
			out += "-";
		}
	}
	while (out.ends_with("-")) {
		out = out.left(-1);
	}
	out = out.left(40);
	return out.is_empty() ? String("jogo") : out;
}

// Uma mudança por linha, sem marcadores ("- ", "* ", "1. ").
PackedStringArray parse_changes(const Variant &p_changes) {
	PackedStringArray lines;
	if (p_changes.get_type() == Variant::ARRAY || p_changes.get_type() == Variant::PACKED_STRING_ARRAY) {
		const Array list = p_changes;
		for (const Variant &line : list) {
			lines.push_back(String(line));
		}
	} else {
		lines = String(p_changes).replace("\r", "").split("\n");
	}
	PackedStringArray out;
	for (String line : lines) {
		line = line.strip_edges();
		if (line.begins_with("- ") || line.begins_with("* ") || line.begins_with("+ ") || line.begins_with(U("• "))) {
			line = line.substr(2).strip_edges();
		} else {
			int digits = 0;
			while (digits < line.length() && is_digit(line[digits])) {
				digits++;
			}
			if (digits > 0 && digits < line.length() && (line[digits] == '.' || line[digits] == ')')) {
				line = line.substr(digits + 1).strip_edges();
			}
		}
		while (line.contains("  ")) {
			line = line.replace("  ", " ");
		}
		if (!line.is_empty() && out.size() < MAX_CHANGES) {
			out.push_back(line.left(MAX_CHANGE_TEXT));
		}
	}
	return out;
}

String game_name(const String &p_project_dir) {
	const String name = ProjectSettings::get_singleton()->get("application/config/name");
	return name.is_empty() ? p_project_dir.get_file() : name;
}

bool write_text(const String &p_path, const String &p_text) {
	DirAccess::make_dir_recursive_absolute(p_path.get_base_dir());
	const String temporary = p_path + ".tmp";
	{
		const Ref<FileAccess> file = FileAccess::open(temporary, FileAccess::WRITE);
		if (file.is_null()) {
			return false;
		}
		file->store_string(p_text);
	}
	const Ref<DirAccess> dir = DirAccess::create(DirAccess::ACCESS_FILESYSTEM);
	return dir->rename(temporary, p_path) == OK;
}

String git(const String &p_dir, const Vector<String> &p_args, bool &r_ok) {
	List<String> args;
	args.push_back("-C");
	args.push_back(p_dir);
	for (const String &arg : p_args) {
		args.push_back(arg);
	}
	String output;
	int code = -1;
	r_ok = OS::get_singleton()->execute("git", args, &output, &code) == OK && code == 0;
	return r_ok ? output.strip_edges() : String();
}

bool is_commit(const String &p_text) {
	if (p_text.length() < 7 || p_text.length() > 40) {
		return false;
	}
	for (int i = 0; i < p_text.length(); i++) {
		if (!is_hex_digit(p_text[i]) || is_ascii_upper_case(p_text[i])) {
			return false;
		}
	}
	return true;
}

// Commit atual, ramo, alterações pendentes e commits desde a versão anterior (fora do git, vazio).
Dictionary git_info(const String &p_dir, const String &p_previous) {
	bool ok = false;
	const String commit = git(p_dir, { "rev-parse", "HEAD" }, ok);
	if (!ok || commit.is_empty()) {
		return Dictionary();
	}
	Dictionary info;
	info["commit"] = commit;
	const String branch = git(p_dir, { "rev-parse", "--abbrev-ref", "HEAD" }, ok);
	info["branch"] = branch == "HEAD" ? String() : branch;
	info["dirty"] = !git(p_dir, { "status", "--porcelain", "--untracked-files=no" }, ok).is_empty();
	Array commits;
	if (p_previous != commit) {
		const bool known = is_commit(p_previous);
		Vector<String> args = { "log", "--format=%h%x09%aI%x09%s" };
		if (known) {
			args.append_array({ "-n", "200", p_previous + "..HEAD" });
		} else {
			args.append_array({ "-n", "30" });
		}
		for (const String &line : git(p_dir, args, ok).split("\n", false)) {
			const Vector<String> parts = line.split("\t", true, 2);
			if (parts.size() == 3) {
				Dictionary item;
				item["hash"] = parts[0];
				item["date"] = parts[1];
				item["subject"] = parts[2];
				commits.push_back(item);
			}
		}
	}
	info["commits"] = commits;
	return info;
}

// Arquivos de entrada do jogo com o hash, para comparar com a próxima versão. Ficam de fora o que
// o build gera ou guarda (src/gerado, res/gerado, out, releases) e as pastas do editor.
void collect_inputs(const String &p_root, const String &p_relative, Array &r_files) {
	const Ref<DirAccess> dir = DirAccess::open(p_root.path_join(p_relative));
	if (dir.is_null()) {
		return;
	}
	for (const String &name : dir->get_directories()) {
		const String relative = p_relative.is_empty() ? name : p_relative.path_join(name);
		if (name.begins_with(".") || relative == "out" || relative == "releases" || relative == "src/gerado" || relative == "res/gerado" || relative == "tools") {
			continue;
		}
		collect_inputs(p_root, relative, r_files);
	}
	for (const String &name : dir->get_files()) {
		if (name.ends_with(".import") || name.ends_with(".uid") || name.ends_with(".tmp")) {
			continue;
		}
		const String relative = p_relative.is_empty() ? name : p_relative.path_join(name);
		Dictionary item;
		item["path"] = relative;
		item["hash"] = FileAccess::get_sha256(p_root.path_join(relative));
		r_files.push_back(item);
	}
}

String area_of(const String &p_path) {
	if (p_path.ends_with(".tscn")) {
		return U("cenas");
	}
	if (p_path.begins_with("src/") || p_path.begins_with("inc/")) {
		return U("código");
	}
	if (p_path.ends_with(".charset.json")) {
		return U("personagens");
	}
	const String ext = p_path.get_extension().to_lower();
	if (ext == "wav" || ext == "vgm" || ext == "vgz" || ext == "xgm" || p_path.begins_with("som/")) {
		return U("sons");
	}
	if (ext == "png" || ext == "bmp") {
		return U("imagens");
	}
	if (p_path.begins_with("res/") || ext == "tres") {
		return U("recursos");
	}
	if (ProjectSettings::is_project_file_name(p_path) || p_path == "Makefile") {
		return U("configuração do jogo");
	}
	return U("outros");
}

String kib(int64_t p_bytes) {
	return p_bytes >= 1048576 ? vformat("%.2f MiB", p_bytes / 1048576.0) : itos((p_bytes + 1023) / 1024) + " KiB";
}

// O JSON lê todo número como float: os inteiros voltam a ser int, para não regravar "1.0".
Variant whole_numbers(const Variant &p_value) {
	switch (p_value.get_type()) {
		case Variant::FLOAT: {
			const double value = p_value;
			return value == Math::floor(value) && Math::abs(value) < 9007199254740992.0 ? Variant(int64_t(value)) : p_value;
		}
		case Variant::ARRAY: {
			Array out;
			for (const Variant &item : Array(p_value)) {
				out.push_back(whole_numbers(item));
			}
			return out;
		}
		case Variant::DICTIONARY: {
			Dictionary out;
			for (const KeyValue<Variant, Variant> &item : Dictionary(p_value)) {
				out[item.key] = whole_numbers(item.value);
			}
			return out;
		}
		default:
			return p_value;
	}
}

Array sorted_releases(const Array &p_releases) {
	Vector<Dictionary> list;
	for (const Variant &item : p_releases) {
		if (item.get_type() == Variant::DICTIONARY && RetroRomReleases::valid_version(Dictionary(item).get("version", ""))) {
			list.push_back(item);
		}
	}
	// Ordenação por inserção: poucas versões, e compare_versions não é um operador.
	for (int i = 1; i < list.size(); i++) {
		for (int j = i; j > 0 && RetroRomReleases::compare_versions(list[j - 1]["version"], list[j]["version"]) > 0; j--) {
			const Dictionary swap = list[j];
			list.write[j] = list[j - 1];
			list.write[j - 1] = swap;
		}
	}
	Array out;
	for (const Dictionary &item : list) {
		out.push_back(item);
	}
	return out;
}

String manifest_path(const String &p_dir) {
	return p_dir.path_join("releases/releases.json");
}

String changelog(const Array &p_releases, const String &p_game) {
	String text = U("# Versões de ") + p_game + "\n\n" + U("Gerado pelo Retro Studio (Versões para teste). Os dados completos de cada versão, como os commits e os arquivos alterados, estão em `releases/releases.json`.\n\n");
	for (int i = p_releases.size() - 1; i >= 0; i--) {
		text += RetroRomReleases::release_markdown(p_releases[i], false);
	}
	return text;
}

} // namespace

namespace RetroRomReleases {

bool valid_version(const String &p_version) {
	int numbers[3];
	String label;
	return split_version(p_version, numbers, label);
}

int compare_versions(const String &p_a, const String &p_b) {
	int x[3], y[3];
	String lx, ly;
	if (!split_version(p_a, x, lx) || !split_version(p_b, y, ly)) {
		return p_a.casecmp_to(p_b);
	}
	for (int i = 0; i < 3; i++) {
		if (x[i] != y[i]) {
			return x[i] - y[i];
		}
	}
	// No mesmo número, a prévia (-beta) vem antes da final.
	if (lx.is_empty() != ly.is_empty()) {
		return lx.is_empty() ? 1 : -1;
	}
	return lx.naturalnocasecmp_to(ly);
}

Dictionary read_manifest(const String &p_project_dir, String &r_problem) {
	Dictionary manifest;
	manifest["title"] = String();
	manifest["releases"] = Array();
	const String path = manifest_path(p_project_dir);
	if (!FileAccess::exists(path)) {
		return manifest;
	}
	const String raw = FileAccess::get_file_as_string(path);
	if (raw.strip_edges().is_empty()) {
		return manifest;
	}
	const Variant data = JSON::parse_string(raw);
	if (data.get_type() != Variant::DICTIONARY) {
		r_problem = U("releases/releases.json não é um JSON válido.");
		return manifest;
	}
	const Dictionary dict = data;
	if (String(dict.get("format", "")) != FORMAT || Variant(dict.get("releases", Variant())).get_type() != Variant::ARRAY) {
		r_problem = U("releases/releases.json não está no formato do Retro Studio.");
		return manifest;
	}
	if (int(dict.get("version", 0)) > FORMAT_VERSION) {
		r_problem = U("releases/releases.json foi gravado por uma versão mais nova do Retro Studio.");
		return manifest;
	}
	manifest["title"] = header_title(dict.get("title", ""));
	manifest["releases"] = sorted_releases(whole_numbers(dict["releases"]));
	return manifest;
}

String next_version(const Array &p_releases) {
	if (p_releases.is_empty()) {
		return "0.1.0";
	}
	int numbers[3];
	String label;
	split_version(Dictionary(p_releases[p_releases.size() - 1]).get("version", "0.0.0"), numbers, label);
	return vformat("%d.%d.%d", numbers[0], numbers[1], label.is_empty() ? numbers[2] + 1 : numbers[2]);
}

PackedStringArray pending_commits(const String &p_project_dir) {
	String problem;
	const Array releases = read_manifest(p_project_dir, problem)["releases"];
	if (releases.is_empty()) {
		return PackedStringArray();
	}
	const String previous = Dictionary(Dictionary(releases[releases.size() - 1]).get("git", Dictionary())).get("commit", "");
	if (!is_commit(previous)) {
		return PackedStringArray();
	}
	bool ok = false;
	PackedStringArray out;
	for (const String &line : git(p_project_dir, { "log", "--no-merges", "--format=%s", "-n", "20", previous + "..HEAD" }, ok).split("\n", false)) {
		if (!line.strip_edges().is_empty()) {
			out.push_back(line.strip_edges());
		}
	}
	return out;
}

Dictionary prepare(const String &p_project_dir, const Dictionary &p_request, String &r_error) {
	const String version = String(p_request.get("version", "")).strip_edges();
	if (!valid_version(version)) {
		r_error = U("Versão inválida. Use três números, como 0.3.0 (ou 0.3.0-beta).");
		return Dictionary();
	}
	const PackedStringArray changes = parse_changes(p_request.get("changes", ""));
	const String notes = String(p_request.get("notes", "")).replace("\r", "").strip_edges().left(MAX_NOTES);
	if (changes.is_empty() && notes.is_empty()) {
		r_error = U("Escreva o que mudou nesta versão: é o que quem testa e a IA vão ler.");
		return Dictionary();
	}
	String problem;
	const Dictionary manifest = read_manifest(p_project_dir, problem);
	if (!problem.is_empty()) {
		r_error = problem + U(" Corrija ou mova o arquivo antes de gerar outra versão.");
		return Dictionary();
	}
	const Array releases = manifest["releases"];
	for (const Variant &item : releases) {
		if (String(Dictionary(item).get("version", "")) == version) {
			r_error = vformat(U("A versão %s já existe. Use outro número."), version);
			return Dictionary();
		}
	}
	const Dictionary previous = releases.is_empty() ? Dictionary() : Dictionary(releases[releases.size() - 1]);
	Dictionary draft;
	draft["version"] = version;
	draft["number"] = int(previous.get("number", 0)) + 1;
	draft["createdAt"] = Time::get_singleton()->get_datetime_string_from_system(true) + "Z";
	draft["changes"] = changes;
	if (!notes.is_empty()) {
		draft["notes"] = notes;
	}
	draft["title"] = p_request.has("title") ? header_title(p_request["title"]) : String(manifest["title"]);
	draft["previous"] = previous.get("version", "");
	const Dictionary git_data = git_info(p_project_dir, Dictionary(previous.get("git", Dictionary())).get("commit", ""));
	if (!git_data.is_empty()) {
		draft["git"] = git_data;
	}

	// O jogo pode mostrar a versão: o header entra antes do build. Não começa com a marca dos
	// arquivos gerados das cenas, então o build das cenas não o apaga.
	int numbers[3];
	String label;
	split_version(version, numbers, label);
	const String commit = git_data.get("commit", "");
	const String header = vformat(U("/* Versão do jogo: gravado pelo Retro Studio a cada versão para teste. Não edite. */\n"
									"#ifndef RETROSTUDIO_VERSAO_H\n#define RETROSTUDIO_VERSAO_H\n"
									"#define GAME_VERSION \"%s\"\n#define GAME_VERSION_MAJOR %d\n#define GAME_VERSION_MINOR %d\n#define GAME_VERSION_PATCH %d\n"
									"#define GAME_RELEASE_NUMBER %d\n#define GAME_BUILD_DATE \"%s\"\n#define GAME_COMMIT \"%s\"\n#endif\n"),
			version, numbers[0], numbers[1], numbers[2], int(draft["number"]), String(draft["createdAt"]).left(10), commit.left(7));
	if (DirAccess::dir_exists_absolute(p_project_dir.path_join("src")) && !write_text(p_project_dir.path_join(VERSION_HEADER), header)) {
		r_error = U("Não foi possível gravar ") + String(VERSION_HEADER) + ".";
		return Dictionary();
	}
	return draft;
}

Dictionary finish(const String &p_project_dir, const Dictionary &p_draft, const String &p_rom_path, String &r_error) {
	Vector<uint8_t> rom = FileAccess::get_file_as_bytes(p_rom_path);
	if (rom.size() < 0x200 || String::ascii(Span<char>((const char *)rom.ptr() + 0x100, 4)) != "SEGA") {
		r_error = U("A ROM não tem o cabeçalho do Mega Drive (\"SEGA\" em 0x100).");
		return Dictionary();
	}
	uint8_t *bytes = rom.ptrw();
	auto write = [&](int p_offset, int p_length, const String &p_value) {
		for (int i = 0; i < p_length; i++) {
			bytes[p_offset + i] = i < p_value.length() ? uint8_t(p_value[i]) : 0x20;
		}
	};
	const int number = p_draft["number"];
	const String title = p_draft.get("title", "");
	if (!title.is_empty()) {
		write(0x120, 48, title.to_upper());
		write(0x150, 48, title.to_upper());
	}
	// Serial "GM XXXXXXXX-RR": só a revisão muda; um serial fora do padrão fica como está.
	String serial = String::ascii(Span<char>((const char *)bytes + 0x180, 14));
	if (serial[2] == ' ' && serial[11] == '-' && is_digit(serial[12]) && is_digit(serial[13])) {
		serial = serial.left(12) + vformat("%02d", number % 100);
		write(0x180, 14, serial);
	}
	uint32_t sum = 0;
	for (int i = 0x200; i + 1 < rom.size(); i += 2) {
		sum = (sum + ((bytes[i] << 8) | bytes[i + 1])) & 0xFFFF;
	}
	if ((rom.size() & 1) && rom.size() > 0x200) {
		sum = (sum + (bytes[rom.size() - 1] << 8)) & 0xFFFF;
	}
	bytes[0x18E] = sum >> 8;
	bytes[0x18F] = sum & 0xFF;

	const String version = p_draft["version"];
	const String game = game_name(p_project_dir);
	const String folder = "releases/" + version;
	const String rom_relative = folder + "/" + slug(game) + "-" + version + ".bin";
	const String rom_absolute = p_project_dir.path_join(rom_relative);
	DirAccess::make_dir_recursive_absolute(rom_absolute.get_base_dir());
	{
		const Ref<FileAccess> file = FileAccess::open(rom_absolute, FileAccess::WRITE);
		if (file.is_null()) {
			r_error = U("Não foi possível gravar ") + rom_relative + ".";
			return Dictionary();
		}
		file->store_buffer(rom);
	}

	Array inputs;
	collect_inputs(p_project_dir, String(), inputs);
	Dictionary files;
	const String previous = p_draft.get("previous", "");
	const Variant previous_inputs = previous.is_empty() ? Variant() : JSON::parse_string(FileAccess::get_file_as_string(p_project_dir.path_join("releases/" + previous + "/inputs.json")));
	if (previous_inputs.get_type() == Variant::DICTIONARY) {
		HashMap<String, String> before, now;
		for (const Variant &item : Array(Dictionary(previous_inputs).get("files", Array()))) {
			before[Dictionary(item).get("path", "")] = Dictionary(item).get("hash", "");
		}
		Array added, changed, removed;
		Dictionary summary;
		for (const Variant &item : inputs) {
			const String path = Dictionary(item)["path"];
			now[path] = Dictionary(item)["hash"];
			if (!before.has(path)) {
				added.push_back(path);
			} else if (before[path] != now[path]) {
				changed.push_back(path);
			}
		}
		for (const KeyValue<String, String> &item : before) {
			if (!now.has(item.key)) {
				removed.push_back(item.key);
			}
		}
		for (const Array &group : { added, changed, removed }) {
			for (const Variant &path : group) {
				const String area = area_of(path);
				summary[area] = int(summary.get(area, 0)) + 1;
			}
		}
		added.sort();
		changed.sort();
		removed.sort();
		files["added"] = added;
		files["changed"] = changed;
		files["removed"] = removed;
		files["summary"] = summary;
	} else {
		files["first"] = true;
		files["count"] = inputs.size();
	}

	Dictionary release;
	release["version"] = version;
	release["number"] = number;
	release["createdAt"] = p_draft["createdAt"];
	release["changes"] = p_draft["changes"];
	if (p_draft.has("notes")) {
		release["notes"] = p_draft["notes"];
	}
	Dictionary rom_info;
	rom_info["file"] = rom_relative;
	rom_info["size"] = rom.size();
	rom_info["sha256"] = FileAccess::get_sha256(rom_absolute);
	rom_info["checksum"] = vformat("0x%04x", sum);
	rom_info["serial"] = serial;
	release["rom"] = rom_info;
	Dictionary build;
	build["flavor"] = "release";
	release["build"] = build;
	if (p_draft.has("git")) {
		release["git"] = p_draft["git"];
	}
	release["files"] = files;

	Dictionary inputs_file;
	inputs_file["version"] = version;
	inputs_file["files"] = inputs;
	write_text(p_project_dir.path_join(folder + "/inputs.json"), JSON::stringify(inputs_file) + "\n");
	write_text(p_project_dir.path_join(folder + U("/LEIA-ME.txt")), vformat(U("%s — versão %s para teste\n\nArquivo: %s\nRode num emulador de Mega Drive (Genesis Plus GX, BlastEm, Kega Fusion) ou num flashcart.\n\n"), game, version, rom_relative.get_file()) + release_markdown(release, true));

	String problem;
	Dictionary manifest = read_manifest(p_project_dir, problem);
	Array releases = manifest["releases"];
	releases.push_back(release);
	Dictionary out;
	out["format"] = FORMAT;
	out["version"] = FORMAT_VERSION;
	out["title"] = p_draft.get("title", "");
	out["releases"] = releases;
	if (!write_text(manifest_path(p_project_dir), JSON::stringify(out, "  ", false) + "\n")) {
		r_error = U("Não foi possível gravar releases/releases.json.");
		return Dictionary();
	}
	write_text(p_project_dir.path_join("releases/CHANGELOG.md"), changelog(releases, game));
	// ROMs ficam fora do git por padrão; o registro e o changelog são versionados.
	const String ignore = p_project_dir.path_join("releases/.gitignore");
	if (!FileAccess::exists(ignore)) {
		write_text(ignore, U("# ROMs das versões para teste (Retro Studio): o registro e o changelog vão para o git.\n*.bin\n"));
	}
	return release;
}

String release_markdown(const Dictionary &p_release, bool p_for_testers) {
	String text = (p_for_testers ? String() : String("## ")) + String(p_release.get("version", "")) + U(" — ") + String(p_release.get("createdAt", "")).left(10) + "\n\n";
	const Array changes = p_release.get("changes", Array());
	if (changes.is_empty()) {
		text += U("Sem lista de mudanças informada.\n\n");
	} else {
		text += U("O que mudou:\n");
		for (const Variant &change : changes) {
			text += "- " + String(change) + "\n";
		}
		text += "\n";
	}
	const String notes = p_release.get("notes", "");
	if (!notes.is_empty()) {
		text += notes + "\n\n";
	}
	if (p_for_testers) {
		return text;
	}
	const Dictionary rom = p_release.get("rom", Dictionary());
	text += vformat(U("- ROM: `%s` (%s), revisão %02d no cabeçalho, SHA-256 `%s`\n"), rom.get("file", ""), kib(rom.get("size", 0)), int(p_release.get("number", 0)) % 100, rom.get("sha256", ""));
	const Dictionary git_data = p_release.get("git", Dictionary());
	if (!git_data.is_empty()) {
		const String branch = git_data.get("branch", "");
		text += vformat(U("- Commit: `%s`%s%s\n"), String(git_data.get("commit", "")).left(10), bool(git_data.get("dirty", false)) ? U(" (com alterações não commitadas)") : String(), branch.is_empty() ? String() : U(" em `") + branch + "`");
	}
	const Dictionary summary = Dictionary(p_release.get("files", Dictionary())).get("summary", Dictionary());
	if (!summary.is_empty()) {
		PackedStringArray areas;
		for (const KeyValue<Variant, Variant> &item : summary) {
			areas.push_back(String(item.key) + ": " + String(item.value));
		}
		text += U("- Arquivos alterados desde a versão anterior — ") + String(", ").join(areas) + "\n";
	}
	const Array commits = git_data.get("commits", Array());
	for (int i = 0; i < MIN(commits.size(), 30); i++) {
		text += "  - " + String(Dictionary(commits[i]).get("hash", "")) + " " + String(Dictionary(commits[i]).get("subject", "")) + "\n";
	}
	return text + "\n";
}

} // namespace RetroRomReleases

// Janela.

void RetroReleaseDialog::refresh() {
	const String dir = ProjectSettings::get_singleton()->get_resource_path();
	String problem;
	const Dictionary manifest = RetroRomReleases::read_manifest(dir, problem);
	const Array ordered = manifest["releases"];
	releases.clear();
	list->clear();
	for (int i = ordered.size() - 1; i >= 0; i--) {
		const Dictionary item = ordered[i];
		releases.push_back(item);
		list->add_item(String(item.get("version", "")) + U("  ·  ") + String(item.get("createdAt", "")).left(10));
	}
	if (releases.is_empty()) {
		details->set_text(U("Nenhuma versão ainda. A primeira fica em releases/<versão>/ com a ROM, o LEIA-ME para quem testa e o registro."));
	}
	show_button->set_disabled(true);
	copy_button->set_disabled(true);
	if (!releases.is_empty()) {
		list->select(0);
		_selected(0);
	}
	if (!working) {
		version_edit->set_text(RetroRomReleases::next_version(ordered));
		title_edit->set_text(manifest["title"]);
		// A partir da segunda versão, os commits desde a anterior viram a sugestão do "o que mudou".
		changes_edit->set_text(String("\n").join(RetroRomReleases::pending_commits(dir)));
		notes_edit->set_text(String());
		set_status(problem, !problem.is_empty());
	}
}

void RetroReleaseDialog::open() {
	refresh();
	popup_centered_clamped(Size2(980, 620) * EDSCALE, 0.9);
	version_edit->grab_focus();
}

void RetroReleaseDialog::set_status(const String &p_text, bool p_error) {
	status->set_text(p_text);
	status->add_theme_color_override(SceneStringName(font_color), p_error ? Color(1, 0.45, 0.45) : Color(0.55, 0.8, 1.0));
}

void RetroReleaseDialog::_selected(int p_index) {
	if (p_index < 0 || p_index >= releases.size()) {
		return;
	}
	const Dictionary release = releases[p_index];
	details->set_text(RetroRomReleases::release_markdown(release, false));
	show_button->set_disabled(false);
	copy_button->set_disabled(false);
}

void RetroReleaseDialog::_show_in_folder() {
	const PackedInt32Array selected = list->get_selected_items();
	if (selected.is_empty()) {
		return;
	}
	const String file = Dictionary(Dictionary(releases[selected[0]]).get("rom", Dictionary())).get("file", "");
	const String folder = ProjectSettings::get_singleton()->get_resource_path().path_join(file).get_base_dir();
	OS::get_singleton()->shell_show_in_file_manager(folder, true);
}

void RetroReleaseDialog::_copy_notes() {
	const PackedInt32Array selected = list->get_selected_items();
	if (!selected.is_empty()) {
		DisplayServer::get_singleton()->clipboard_set(RetroRomReleases::release_markdown(releases[selected[0]], true));
		set_status(U("Notas copiadas."), false);
	}
}

void RetroReleaseDialog::ok_pressed() {
	RetroSgdkPlugin *plugin = RetroSgdkPlugin::get_singleton();
	if (!plugin || working) {
		return;
	}
	Dictionary request;
	request["version"] = version_edit->get_text();
	request["title"] = title_edit->get_text();
	request["changes"] = changes_edit->get_text();
	request["notes"] = notes_edit->get_text();
	String error;
	if (!plugin->start_release(request, error)) {
		set_status(error, true);
		return;
	}
	working = true;
	get_ok_button()->set_disabled(true);
	build_only->set_disabled(true);
	set_status(U("Compilando a versão de release (build limpo)… a saída está no painel SGDK."), false);
}

void RetroReleaseDialog::_custom_action(const StringName &p_action) {
	if (p_action == StringName("so_compilar") && RetroSgdkPlugin::get_singleton()) {
		hide();
		RetroSgdkPlugin::get_singleton()->start_build_for_ai(false);
	}
}

void RetroReleaseDialog::release_done(const Dictionary &p_release) {
	working = false;
	get_ok_button()->set_disabled(false);
	build_only->set_disabled(false);
	refresh();
	set_status(vformat(U("Versão %s gerada: %s"), p_release.get("version", ""), Dictionary(p_release.get("rom", Dictionary())).get("file", "")), false);
}

void RetroReleaseDialog::release_failed(const String &p_reason) {
	working = false;
	get_ok_button()->set_disabled(false);
	build_only->set_disabled(false);
	set_status(U("A versão não foi gerada. ") + p_reason, true);
}

void RetroReleaseDialog::_bind_methods() {
}

RetroReleaseDialog::RetroReleaseDialog() {
	set_title(U("Versões para teste"));
	set_ok_button_text(U("Gerar versão"));
	set_hide_on_ok(false);
	build_only = add_button(U("Só compilar"), false, "so_compilar");
	connect("custom_action", callable_mp(this, &RetroReleaseDialog::_custom_action));

	HSplitContainer *split = memnew(HSplitContainer);
	add_child(split);

	VBoxContainer *left = memnew(VBoxContainer);
	left->set_custom_minimum_size(Size2(340, 0) * EDSCALE);
	split->add_child(left);
	Label *list_label = memnew(Label(U("Versões geradas")));
	left->add_child(list_label);
	list = memnew(ItemList);
	list->set_custom_minimum_size(Size2(0, 140) * EDSCALE);
	list->connect(SceneStringName(item_selected), callable_mp(this, &RetroReleaseDialog::_selected));
	left->add_child(list);
	details = memnew(RichTextLabel);
	details->set_v_size_flags(Control::SIZE_EXPAND_FILL);
	details->set_selection_enabled(true);
	details->set_context_menu_enabled(true);
	left->add_child(details);
	HBoxContainer *actions = memnew(HBoxContainer);
	left->add_child(actions);
	show_button = memnew(Button(U("Mostrar na pasta")));
	show_button->connect(SceneStringName(pressed), callable_mp(this, &RetroReleaseDialog::_show_in_folder));
	actions->add_child(show_button);
	copy_button = memnew(Button(U("Copiar notas")));
	copy_button->set_tooltip_text(U("Copia o texto da versão para mandar a quem testa."));
	copy_button->connect(SceneStringName(pressed), callable_mp(this, &RetroReleaseDialog::_copy_notes));
	actions->add_child(copy_button);

	VBoxContainer *form = memnew(VBoxContainer);
	form->set_h_size_flags(Control::SIZE_EXPAND_FILL);
	split->add_child(form);
	form->add_child(memnew(Label(U("Versão (três números, como 0.3.0, ou 0.3.0-beta para uma prévia)"))));
	version_edit = memnew(LineEdit);
	form->add_child(version_edit);
	form->add_child(memnew(Label(U("Título no cabeçalho da ROM (opcional, até 48 caracteres, sem acento)"))));
	title_edit = memnew(LineEdit);
	title_edit->set_max_length(MAX_TITLE);
	title_edit->set_placeholder(U("Aparece em emuladores e flashcarts no lugar de \"SAMPLE PROGRAM\""));
	form->add_child(title_edit);
	form->add_child(memnew(Label(U("O que mudou (uma mudança por linha, do ponto de vista de quem joga)"))));
	changes_edit = memnew(TextEdit);
	changes_edit->set_v_size_flags(Control::SIZE_EXPAND_FILL);
	changes_edit->set_line_wrapping_mode(TextEdit::LINE_WRAPPING_BOUNDARY);
	form->add_child(changes_edit);
	form->add_child(memnew(Label(U("Observações para quem testa (opcional)"))));
	notes_edit = memnew(TextEdit);
	notes_edit->set_custom_minimum_size(Size2(0, 90) * EDSCALE);
	notes_edit->set_line_wrapping_mode(TextEdit::LINE_WRAPPING_BOUNDARY);
	form->add_child(notes_edit);
	status = memnew(Label);
	status->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
	form->add_child(status);
}
