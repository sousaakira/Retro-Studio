#pragma once

#include "core/templates/hash_map.h"
#include "core/templates/hash_set.h"
#include "core/templates/list.h"
#include "scene/gui/box_container.h"

class Button;
class HTTPRequest;
class Label;
class LineEdit;
class OptionButton;
class Tree;
class TreeItem;

// #89: instrumentos da internet (porte de InstrumentBrowser.vue + electron/retro/instrumentLibrary.js).
// Navega a biblioteca do Furnace no GitHub (pastas do Mega Drive): a listagem vem numa chamada à API de
// árvores (60 por hora sem login) e fica em cache por um dia; cada arquivo vem do raw.githubusercontent.com
// só se estiver na listagem, guardado pelo hash do Git. Ou baixa de um link https colado (sem endereços
// locais, até 2 MiB, poucos redirecionamentos). ▶ ouve antes de importar, sem pôr na música.
class RetroInstrumentBrowser : public VBoxContainer {
	GDCLASS(RetroInstrumentBrowser, VBoxContainer)

	enum JobKind {
		JOB_TREE,
		JOB_FILE,
		JOB_LINK,
	};
	enum Purpose {
		PURPOSE_NONE,
		PURPOSE_PREVIEW,
		PURPOSE_BATCH,
	};
	struct Job {
		JobKind kind = JOB_TREE;
		String path; // Caminho na biblioteca (arquivo).
		String url;
		int redirects = 3;
		int limit = 1024 * 1024;
		Purpose purpose = PURPOSE_NONE;
	};

	HTTPRequest *http = nullptr;
	List<Job> jobs;
	bool running = false;
	Job current;

	Label *credit = nullptr;
	Label *status = nullptr;
	OptionButton *folder_select = nullptr;
	OptionButton *category_select = nullptr;
	LineEdit *query = nullptr;
	Label *count_label = nullptr;
	Tree *results = nullptr;
	Button *more_button = nullptr;
	Button *import_button = nullptr;
	Button *refresh_button = nullptr;
	LineEdit *link = nullptr;
	Button *link_button = nullptr;

	bool loaded = false;
	bool stale = false;
	Array entries; // {path, sha, size, folder, category, name, format}
	HashMap<String, Dictionary> parsed; // caminho → {instruments, warnings} | {error}
	HashSet<String> selected;
	int limit = 150;
	Vector<String> batch;
	int batch_index = 0;
	Array batch_found;
	PackedStringArray batch_failed;

	String _cache_dir() const;
	void _load(bool p_refresh);
	void _use_tree(const Array &p_tree);
	void _fill_categories();
	void _fill_results();
	Array _filtered() const;
	void _enqueue(const Job &p_job);
	void _next();
	void _request(const String &p_url);
	void _completed(int p_result, int p_code, const PackedStringArray &p_headers, const PackedByteArray &p_body);
	void _fail(const String &p_message);
	void _file_ready(const String &p_path, const Vector<uint8_t> &p_bytes, Purpose p_purpose);
	Dictionary _entry(const String &p_path) const;
	void _fetch(const String &p_path, int p_purpose);
	void _parsed_done(const String &p_path, Purpose p_purpose);
	void _batch_step();
	void _folder_selected(int p_index);
	void _category_selected(int p_index);
	void _query_changed(const String &p_text);
	void _more();
	void _item_edited();
	void _button_clicked(TreeItem *p_item, int p_column, int p_id, MouseButton p_button);
	void _import_selected();
	void _import_link();
	void _refresh();
	void _emit_close();

protected:
	void _notification(int p_what);
	static void _bind_methods();

public:
	// Só https e só endereços públicos (nada de localhost, rede local ou IP privado). "" = aceito.
	static String check_public_https(const String &p_url, String *r_host = nullptr);
	static bool is_private_address(const String &p_address);

	void open();
	RetroInstrumentBrowser();
};
