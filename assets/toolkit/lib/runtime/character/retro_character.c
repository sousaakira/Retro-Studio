#include "retro_character.h"
static uint16_t findState(const RetroCharacterDefinition *d, uint16_t id) {
    uint16_t i;
    for (i=0; i<d->stateCount; i++) if (d->states[i].id==id) return i;
    return RETRO_ID_NONE;
}
uint8_t retroCharacterValidate(const RetroCharacterDefinition *d) {
    uint16_t i,j; uint32_t events=0;
    if (!d || !d->states || !d->stateCount || d->stateCount>RETRO_CHARACTER_MAX_STATES ||
        d->transitionCount>RETRO_CHARACTER_MAX_TRANSITIONS ||
        (d->transitionCount && !d->transitions)) return 0;
    for (i=0; i<d->stateCount; i++) {
        const RetroCharacterState *s=&d->states[i];
        events+=s->eventCount;
        if (s->id==RETRO_ID_NONE || s->animationId==RETRO_ID_NONE || !s->frameCount ||
            s->frameCount>255 || !s->durations || !s->poses || s->loop>1 ||
            s->interruptible>1 || (s->eventCount && !s->events) ||
            events>RETRO_CHARACTER_MAX_EVENTS) return 0;
        for (j=0; j<i; j++) if (d->states[j].id==s->id) return 0;
        for (j=0; j<s->frameCount; j++) {
            const RetroCharacterPose *p=&s->poses[j];
            if (!s->durations[j] || s->durations[j]>255 || !p->width || !p->height ||
                p->width>32767 || p->height>32767 || p->flipH>1 || p->flipV>1) return 0;
        }
        for (j=0; j<s->eventCount; j++)
            if (s->events[j].frame>=s->frameCount || !s->events[j].type) return 0;
    }
    for (i=0; i<d->transitionCount; i++) {
        const RetroCharacterTransition *t=&d->transitions[i];
        if ((t->from!=RETRO_ID_NONE && findState(d,t->from)==RETRO_ID_NONE) ||
            findState(d,t->to)==RETRO_ID_NONE || (t->requireAll&t->requireNone) ||
            t->requireFinished>1) return 0;
    }
    return 1;
}
static void emitFrame(RetroCharacter *c) {
    const RetroCharacterState *s=&c->definition->states[c->stateIndex];
    uint16_t i, frame=c->animation.frame;
    if (c->host.pose) c->host.pose(c->host.context,s->id,s->animationId,frame,&s->poses[frame]);
    if (c->host.event) for (i=0; i<s->eventCount; i++)
        if (s->events[i].frame==frame) c->host.event(c->host.context,s->id,&s->events[i]);
}
static void enterState(RetroCharacter *c, uint16_t index) {
    uint16_t previous=c->ready?c->definition->states[c->stateIndex].id:RETRO_ID_NONE;
    const RetroCharacterState *s=&c->definition->states[index];
    c->stateIndex=index; c->elapsed=0; c->ready=1;
    retroAnimationStart(&c->animation,s->durations[0],s->loop);
    if (c->host.enter) c->host.enter(c->host.context,previous,s->id);
    emitFrame(c);
}
uint8_t retroCharacterInit(RetroCharacter *c, const RetroCharacterDefinition *d,
                           uint16_t initial, const RetroCharacterHost *host) {
    uint16_t index;
    if (!c || c->busy || !retroCharacterValidate(d)) return 0;
    index=findState(d,initial); if (index==RETRO_ID_NONE) return 0;
    c->definition=d;
    if (host) c->host=*host;
    else { c->host.context=0; c->host.condition=0; c->host.enter=0; c->host.pose=0; c->host.event=0; }
    c->ready=0; c->busy=1; enterState(c,index); c->busy=0;
    return 1;
}
uint8_t retroCharacterSetState(RetroCharacter *c, uint16_t id) {
    uint16_t index;
    if (!c || !c->ready || c->busy) return 0;
    index=findState(c->definition,id); if (index==RETRO_ID_NONE) return 0;
    c->busy=1; enterState(c,index); c->busy=0; return 1;
}
uint16_t retroCharacterStateId(const RetroCharacter *c) {
    return c && c->ready ? c->definition->states[c->stateIndex].id : RETRO_ID_NONE;
}
uint8_t retroCharacterTick(RetroCharacter *c, uint32_t conditions) {
    uint16_t i, selected=RETRO_ID_NONE;
    uint8_t frameChange;
    const RetroCharacterState *s;
    if (!c || !c->ready || c->busy) return 0;
    c->busy=1; s=&c->definition->states[c->stateIndex];
    if (c->elapsed!=65535) c->elapsed++;
    frameChange=retroAnimationTick(&c->animation,s->durations,s->frameCount);
    for (i=0; i<c->definition->transitionCount; i++) {
        const RetroCharacterTransition *t=&c->definition->transitions[i];
        if ((t->from!=RETRO_ID_NONE && t->from!=s->id) || t->to==s->id ||
            c->elapsed<t->minimumTicks || (conditions&t->requireAll)!=t->requireAll ||
            (conditions&t->requireNone) || (t->requireFinished && c->animation.playing) ||
            (!s->interruptible && c->animation.playing)) continue;
        if (t->predicate!=RETRO_ID_NONE && (!c->host.condition ||
            !c->host.condition(c->host.context,t->predicate))) continue;
        if (selected==RETRO_ID_NONE || t->priority>c->definition->transitions[selected].priority) selected=i;
    }
    if (selected!=RETRO_ID_NONE) {
        enterState(c,findState(c->definition,c->definition->transitions[selected].to));
        c->busy=0; return 1;
    }
    if (frameChange==RETRO_ANIM_FRAME) emitFrame(c);
    c->busy=0; return 0;
}
