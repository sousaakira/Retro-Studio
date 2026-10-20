// #89: editor de músicas do modo Música — documento (music/<id>.song.json), desfazer/refazer, tocar
// com loop e metrônomo, gravar pelo teclado MIDI e salvar/exportar para o jogo. A reprodução usa a
// mesma linha do tempo do VGM (songTimeline), agendada no chip 0 do worklet; o teclado ao vivo
// toca no chip 1 com o instrumento da faixa selecionada.
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { createSong, songLength, tickFrame, secondsTick, snapTick, snapLength, SONG_PPQ, SONG_FPS } from '../../shared/retro/song.js'
import { songTimeline } from '../../shared/retro/songTimeline.js'
import { useDocumentUndo } from './useDocumentUndo.js'
import { onMidiEvent } from './useMidiInput.js'
import { onPadHit } from './useDrumPads.js'
import { resolveInstrument } from '../../shared/retro/songTimeline.js'
import { DRUM_CHANNEL } from '../../shared/retro/drumPads.js'
import { useChipSynth } from './useChipSynth.js'
import { DurableDrafts, draftTimer } from '../utils/retro/durableDrafts.js'

// Rascunho da música aberta por projeto, espelhado em .retrostudio/drafts/music.json: sobrevive a
// travamento, fechamento e recarga da janela. Nunca grava a fonte da música.
export const musicDrafts = new DurableDrafts('music')

const LOOKAHEAD = .25, START_DELAY = .08

export function useSongEditor(projectPath) {
  const { synth, startSynth, setInstrument, audioClock, scheduleSong, clearSong, metronomeClick, setSongInstruments } = useChipSynth()
  const song = ref(null), baseline = ref(''), revision = ref(null), savedId = ref(null)
  const songs = ref([]), selected = ref(0), grid = ref(12), quantize = ref(true), metronome = ref(false)
  const playing = ref(false), recording = ref(false), playhead = ref(0), cursor = ref(0)
  const busy = ref(false), error = ref(''), message = ref(''), gesturing = ref(false)
  const history = useDocumentUndo(song, { blocked: () => busy.value || gesturing.value, paused: () => gesturing.value })
  const dirty = computed(() => !!song.value && JSON.stringify(song.value) !== baseline.value)
  const track = computed(() => song.value?.tracks[selected.value] || null)
  const length = computed(() => song.value ? songLength(song.value) : 0)
  let player = null, timer = 0, frame = 0
  const owner = {}, recoveredAt = ref('')
  const draftSaver = draftTimer(() => {
    const project = projectPath()
    if (!project || !song.value) return
    if (dirty.value) musicDrafts.set(project, { song: JSON.parse(JSON.stringify(song.value)), baseline: baseline.value, revision: revision.value, savedId: savedId.value }, owner)
    else musicDrafts.deleteIfOwner(project, owner)
  })
  watch(song, () => draftSaver.touch(), { deep: true })
  /** Recupera o rascunho do projeto (de antes de uma recarga ou de outra sessão). Devolve se havia. */
  async function restoreDraft() {
    const project = projectPath()
    if (!project) return false
    if (musicDrafts.needsHydration(project)) await musicDrafts.hydrate(project)
    const draft = musicDrafts.get(project)
    if (!draft?.song) return false
    musicDrafts.claim(project, owner)
    setDocument(draft.song, { rev: draft.revision ?? null, saved: draft.savedId ?? null })
    baseline.value = draft.baseline || ''
    recoveredAt.value = musicDrafts.recoveredAt(project) || 'antes da recarga'
    return true
  }
  function discardDraft() { const project = projectPath(); if (project) musicDrafts.delete(project); recoveredAt.value = '' }
  const pending = new Map()

  // ---- Documento ----
  function setDocument(next, { rev = null, saved = null } = {}) {
    stop()
    song.value = null   // começa um histórico novo
    song.value = next
    baseline.value = JSON.stringify(next); revision.value = rev; savedId.value = saved
    selected.value = 0; cursor.value = 0; playhead.value = 0
  }
  function uniqueId() {
    const used = new Set(songs.value.map(item => item.id))
    let index = songs.value.length + 1
    while (used.has('musica_' + index)) index++
    return 'musica_' + index
  }
  function newSong() {
    discardDraft()
    setDocument(createSong({ id: uniqueId(), name: 'Nova música', instrument: synth.instrument }))
    message.value = ''; error.value = ''
  }
  async function refreshList() {
    if (!projectPath()) { songs.value = []; return }
    try { songs.value = await window.retroStudio?.retro?.listSongs?.({ projectPath: projectPath() }) || [] }
    catch (problem) { error.value = problem.message }
  }
  async function open(id) {
    error.value = ''; message.value = ''
    try {
      const result = await window.retroStudio.retro.loadSong({ projectPath: projectPath(), id })
      discardDraft()
      setDocument(result.song, { rev: result.revision, saved: result.song.id })
    } catch (problem) { error.value = problem.message }
  }
  async function save(exportToGame = false) {
    if (!song.value || busy.value) return false
    busy.value = true; error.value = ''; message.value = ''
    try {
      const result = await window.retroStudio.retro.saveSong({ projectPath: projectPath(), song: JSON.parse(JSON.stringify(song.value)), revision: revision.value, exportToGame })
      revision.value = result.revision; savedId.value = result.song.id
      baseline.value = JSON.stringify(song.value)
      discardDraft()
      if (result.vgm) {
        const seconds = Math.round(result.vgm.seconds)
        const catalog = result.catalog?.registered ? (result.catalog.added ? ' e cadastrada no catálogo de áudio' : '; catálogo de áudio atualizado') : ''
        message.value = 'Exportada para ' + result.vgm.path + ' (' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') + (result.vgm.loop ? ', com loop' : '') + ')' + catalog + '.'
        if (result.catalog && !result.catalog.registered) error.value = 'O VGM foi gravado, mas o catálogo de áudio não foi atualizado: ' + result.catalog.error
      } else message.value = 'Música salva em music/' + result.song.id + '.song.json.'
      await refreshList()
      return true
    } catch (problem) { error.value = problem.message; return false }
    finally { busy.value = false }
  }

  // ---- Faixas ----
  function addTrack() {
    const tracks = song.value.tracks
    if (tracks.length >= 32) return
    let index = tracks.length + 1
    while (tracks.some(item => item.id === 'faixa-' + index)) index++
    tracks.push({ id: 'faixa-' + index, name: 'Faixa ' + index, instrument: synth.instrument, mute: false, solo: false, notes: [] })
    selected.value = tracks.length - 1
  }
  function removeTrack(index) {
    if (song.value.tracks.length <= 1) return
    song.value.tracks.splice(index, 1)
    selected.value = Math.min(selected.value, song.value.tracks.length - 1)
  }
  // Instrumentos próprios da música: o teclado ao vivo usa os valores editados na hora.
  watch(() => song.value?.instruments, list => setSongInstruments(list || []), { deep: true, immediate: true })
  // O teclado toca com o instrumento da faixa selecionada.
  watch(() => track.value?.instrument, id => { if (id) setInstrument(id) }, { immediate: true })

  // ---- Reprodução ----
  function segment(from, start) {
    const loop = song.value.loop
    const to = loop && from < loop.end ? loop.end : length.value
    const timeline = songTimeline(song.value, { from, to, audition: true, loop: null })
    return { from, to, start, timeline, next: 0, beat: Math.ceil(from / SONG_PPQ), duration: timeline.end / SONG_FPS }
  }
  async function play(from = cursor.value) {
    if (!song.value) return
    stop()
    if (!(await startSynth())) return
    const clock = audioClock()
    player = segment(Math.min(from, length.value - 1), clock.now + START_DELAY)
    playing.value = true
    pump()
    timer = setInterval(pump, 25)
    const draw = () => { if (!player) return; updatePlayhead(); frame = requestAnimationFrame(draw) }
    frame = requestAnimationFrame(draw)
  }
  function pump() {
    const clock = audioClock()
    if (!player || !clock) return stop()
    const horizon = clock.now + LOOKAHEAD
    const { timeline } = player
    while (player.next < timeline.frames.length) {
      const item = timeline.frames[player.next], at = player.start + item.frame / SONG_FPS
      if (at > horizon) break
      scheduleSong(item.writes, at); player.next++
    }
    if (metronome.value) {
      while (true) {
        const tick = player.beat * SONG_PPQ
        if (tick >= player.to) break
        const at = player.start + (tickFrame(song.value, tick) - tickFrame(song.value, player.from)) / SONG_FPS
        if (at > horizon) break
        metronomeClick(at, player.beat % song.value.beatsPerBar === 0); player.beat++
      }
    }
    const end = player.start + player.duration
    if (clock.now + LOOKAHEAD < end) return
    const loop = song.value.loop
    if (loop && player.to === loop.end) {
      if (clock.now < end - .02) return
      closePending(loop.end)
      player = segment(loop.start, end)
    } else if (clock.now >= end) { closePending(player.to); stop(); playhead.value = cursor.value }
  }
  function currentTick(compensate = true) {
    const clock = audioClock()
    if (!player || !clock) return cursor.value
    const elapsed = clock.now - (compensate ? clock.latency : 0) - player.start
    return Math.max(player.from, Math.min(player.to, player.from + secondsTick(song.value, Math.max(0, elapsed))))
  }
  function updatePlayhead() { playhead.value = currentTick() }
  function stop() {
    if (player) { closePending(currentTick()); clearSong() }
    clearInterval(timer); timer = 0
    cancelAnimationFrame(frame)
    player = null; playing.value = false; recording.value = false
  }
  function toggle() { playing.value ? stop() : play() }
  watch(() => synth.status, status => { if (status !== 'on' && playing.value) stop() })

  // ---- Gravação pelo teclado MIDI ----
  async function record() {
    if (recording.value) { stop(); return }
    await play()
    if (playing.value) recording.value = true
  }
  function commit(note, start, end, target = track.value) {
    if (!target) return
    let t = Math.round(start), d = Math.round(end - start)
    if (quantize.value) { t = snapTick(start, grid.value); d = snapLength(end - start, grid.value) }
    t = Math.min(t, length.value - 1); d = Math.max(1, Math.min(d, length.value - t))
    target.notes.push({ t, d, n: note.n, v: note.v })
  }
  function closePending(end) {
    for (const [n, note] of pending) commit({ n, v: note.v }, note.t, Math.max(end, note.t + 1))
    pending.clear()
    for (const hit of padPending.values()) commit({ n: hit.n, v: hit.v }, hit.t, Math.max(end, hit.t + 1), hit.target)
    padPending.clear()
  }
  // Faixa da peça de bateria: a primeira com aquele instrumento, ou uma nova com o nome dele.
  function drumTrack(instrument) {
    const tracks = song.value.tracks
    const found = tracks.find(item => item.instrument === instrument)
    if (found || tracks.length >= 32) return found || null
    let id = 'bateria-' + instrument.slice(0, 22), index = 2
    while (tracks.some(item => item.id === id)) id = 'bateria-' + instrument.slice(0, 20) + '-' + index++
    tracks.push({ id, name: (resolveInstrument(song.value, instrument)?.name || instrument).slice(0, 64), instrument, mute: false, solo: false, notes: [] })
    return tracks[tracks.length - 1]
  }
  const padPending = new Map()
  const stopPads = onPadHit(hit => {
    if (!recording.value || !player) return
    if (hit.on) { padPending.set(hit.index, { t: currentTick(), v: hit.velocity, n: hit.note, target: drumTrack(hit.instrument) }); return }
    const held = padPending.get(hit.index)
    if (!held) return
    padPending.delete(hit.index)
    const now = currentTick()
    commit({ n: held.n, v: held.v }, held.t, now >= held.t ? now : player.to, held.target)
  })
  const stopMidi = onMidiEvent(event => {
    // Canal 10 são os pads: gravados por onPadHit (modo Bateria) ou atalhos (modo Controles).
    if (!recording.value || !player || event.channel === DRUM_CHANNEL) return
    if (event.type === 'note-on') {
      const sounding = Math.max(0, Math.min(127, event.note + synth.octave * 12))
      pending.set(sounding, { t: currentTick(), v: event.velocity })
    } else if (event.type === 'note-off') {
      const sounding = Math.max(0, Math.min(127, event.note + synth.octave * 12)), note = pending.get(sounding)
      if (!note) return
      pending.delete(sounding)
      const now = currentTick()
      commit({ n: sounding, v: note.v }, note.t, now >= note.t ? now : player.to)
    }
  })
  onBeforeUnmount(() => {
    stop(); stopMidi(); stopPads()
    // Grava já o que estava esperando o atraso do rascunho.
    draftSaver.cancel()
    const project = projectPath()
    if (project && song.value && dirty.value) { musicDrafts.set(project, { song: JSON.parse(JSON.stringify(song.value)), baseline: baseline.value, revision: revision.value, savedId: savedId.value }, owner); void musicDrafts.flush(project) }
  })

  return {
    song, songs, selected, track, length, grid, quantize, metronome, playing, recording, playhead, cursor, gesturing,
    busy, error, message, dirty, revision, savedId, history, recoveredAt,
    newSong, refreshList, open, save, restoreDraft, discardDraft, addTrack, removeTrack, play, stop, toggle, record
  }
}
