#include "retro_chip_stream.h"

#include "servers/audio/audio_server.h"

// Mistura aproximada do Mega Drive: PSG um pouco abaixo de um canal FM.
static constexpr float FM_GAIN = 0.22f;
static constexpr float PSG_GAIN = 0.2f;

void RetroChipEngine::setup(int p_chips) {
	MutexLock lock(mutex);
	count = p_chips == 1 ? 1 : 2;
	for (Chips &pair : chips) {
		pair.fm.reset();
		pair.psg.reset();
		pair.queue.clear();
		pair.position = 0;
	}
	clicks.clear();
}

void RetroChipEngine::_apply(Chips &r_chips, const Vector<RetroChipWrite> &p_writes) {
	for (const RetroChipWrite &write : p_writes) {
		if (write.chip == 0) {
			r_chips.fm.write(write.port, write.address, write.data);
		} else {
			r_chips.psg.write(write.data);
		}
	}
}

void RetroChipEngine::push(int p_chip, const Vector<RetroChipWrite> &p_writes, double p_at) {
	if (p_writes.is_empty()) {
		return;
	}
	MutexLock lock(mutex);
	Chips &pair = chips[p_chip == 0 ? 0 : count - 1];
	Batch batch;
	batch.frame = p_at < 0 ? -1 : int64_t(Math::round(p_at * mix_rate));
	batch.writes = p_writes;
	// Em ordem de quadro (as escritas imediatas vão para a frente do que já venceu).
	if (batch.frame < 0 || pair.queue.is_empty() || pair.queue.back()->get().frame <= batch.frame) {
		pair.queue.push_back(batch);
		return;
	}
	for (List<Batch>::Element *element = pair.queue.front(); element; element = element->next()) {
		if (element->get().frame > batch.frame) {
			pair.queue.insert_before(element, batch);
			return;
		}
	}
	pair.queue.push_back(batch);
}

void RetroChipEngine::clear(int p_chip) {
	MutexLock lock(mutex);
	Chips &pair = chips[p_chip == 0 ? 0 : count - 1];
	pair.queue.clear();
	pair.fm.reset();
	pair.psg.reset();
}

void RetroChipEngine::click(double p_at, bool p_accent) {
	MutexLock lock(mutex);
	Click item;
	item.frame = int64_t(Math::round(p_at * mix_rate));
	item.frequency = p_accent ? 1760 : 1175;
	item.amplitude = p_accent ? 0.35 : 0.22;
	clicks.push_back(item);
}

double RetroChipEngine::get_time() const {
	return frames_mixed / mix_rate;
}

void RetroChipEngine::mix(AudioFrame *p_buffer, int p_frames, double p_mix_rate) {
	MutexLock lock(mutex);
	mix_rate = p_mix_rate;
	for (int index = 0; index < p_frames; index++) {
		float l = 0, r = 0;
		for (int c = 0; c < count; c++) {
			Chips &pair = chips[c];
			while (!pair.queue.is_empty() && pair.queue.front()->get().frame <= frames_mixed + index) {
				_apply(pair, pair.queue.front()->get().writes);
				pair.queue.pop_front();
			}
			pair.position += pair.fm.sample_rate / mix_rate;
			while (pair.position >= 1) {
				pair.position -= 1;
				pair.previous[0] = pair.current[0];
				pair.previous[1] = pair.current[1];
				pair.fm.step();
				pair.current[0] = pair.fm.left;
				pair.current[1] = pair.fm.right;
			}
			const float t = pair.position, psg = pair.psg.sample(mix_rate) * PSG_GAIN;
			l += (pair.previous[0] + (pair.current[0] - pair.previous[0]) * t) * FM_GAIN + psg;
			r += (pair.previous[1] + (pair.current[1] - pair.previous[1]) * t) * FM_GAIN + psg;
		}
		// Metrônomo: sobe em 2 ms e cai exponencialmente até 50 ms (como o do Web Audio).
		for (const Click &item : clicks) {
			const double t = (frames_mixed + index - item.frame) / mix_rate;
			if (t < 0 || t >= 0.06) {
				continue;
			}
			const double envelope = t < 0.002 ? item.amplitude * t / 0.002 : item.amplitude * Math::pow(0.0001 / item.amplitude, MIN(1.0, (t - 0.002) / 0.048));
			const float value = float(Math::sin(Math::TAU * item.frequency * t) * envelope);
			l += value;
			r += value;
		}
		p_buffer[index] = AudioFrame(l * volume, r * volume);
	}
	frames_mixed += p_frames;
	for (int i = clicks.size() - 1; i >= 0; i--) {
		if ((frames_mixed - clicks[i].frame) / mix_rate >= 0.06) {
			clicks.remove_at(i);
		}
	}
	active[0] = chips[0].fm.active_channels();
	active[1] = chips[count - 1].fm.active_channels();
}

int RetroChipPlayback::mix(AudioFrame *p_buffer, float p_rate_scale, int p_frames) {
	if (!active || engine.is_null()) {
		for (int i = 0; i < p_frames; i++) {
			p_buffer[i] = AudioFrame(0, 0);
		}
		return p_frames;
	}
	engine->mix(p_buffer, p_frames, AudioServer::get_singleton()->get_mix_rate());
	return p_frames;
}

Ref<AudioStreamPlayback> RetroChipStream::instantiate_playback() {
	Ref<RetroChipPlayback> playback;
	playback.instantiate();
	playback->engine = engine;
	return playback;
}
