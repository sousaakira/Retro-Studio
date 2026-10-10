#include "retro_character_sprite.h"
/* A bounded registry avoids taking over Sprite.data, which belongs to the game. */
static RetroCharacterSprite *bindings[RETRO_CHARACTER_SPRITE_CAPACITY];
static void frameChanged(Sprite *sprite) {
    u16 i;
    for(i=0;i<RETRO_CHARACTER_SPRITE_CAPACITY;i++) {
        RetroCharacterSprite *a=bindings[i];
        if(a && a->sprite==sprite) {
            if(!a->busy && a->originalCallback) {
                a->busy=1; a->originalCallback(sprite); a->busy=0;
            }
            /* SPR_update resets the timer after an actual DMA frame change. */
            sprite->timer=0; return;
        }
    }
}
static void position(RetroCharacterSprite *a) {
    const RetroCharacterPose *p=a->pose;
    u8 h,v; s32 x,y;
    if(!p) return;
    h=a->hFlip^p->flipH; v=a->vFlip^p->flipV;
    x=(s32)a->x-a->cameraX-(h ? (s32)p->width-p->anchorX : p->anchorX);
    y=(s32)a->y-a->cameraY-(v ? (s32)p->height-p->anchorY : p->anchorY);
    SPR_setHFlip(a->sprite,h); SPR_setVFlip(a->sprite,v);
    SPR_setPriority(a->sprite,a->priority);
    if(x>=screenWidth || y>=screenHeight || x+(s32)p->width<=0 || y+(s32)p->height<=0)
        SPR_setVisibility(a->sprite,HIDDEN);
    else { SPR_setVisibility(a->sprite,AUTO_FAST); SPR_setPosition(a->sprite,(s16)x,(s16)y); }
}
static void render(RetroCharacterSprite *a,u16 animation,u16 frame,const RetroCharacterPose *p) {
    a->pose=p;
    SPR_setAnimAndFrame(a->sprite,(s16)animation,(s16)frame);
    a->sprite->timer=0;
    position(a);
}
static uint8_t condition(void *context,uint16_t id) {
    RetroCharacterSprite *a=context;
    return a->originalHost.condition ? a->originalHost.condition(a->originalHost.context,id) : 0;
}
static void enter(void *context,uint16_t before,uint16_t after) {
    RetroCharacterSprite *a=context;
    if(a->originalHost.enter) a->originalHost.enter(a->originalHost.context,before,after);
}
static void pose(void *context,uint16_t state,uint16_t animation,uint16_t frame,const RetroCharacterPose *p) {
    RetroCharacterSprite *a=context;
    render(a,animation,frame,p);
    if(a->originalHost.pose) a->originalHost.pose(a->originalHost.context,state,animation,frame,p);
}
static void event(void *context,uint16_t state,const RetroCharacterEvent *e) {
    RetroCharacterSprite *a=context;
    if(a->originalHost.event) a->originalHost.event(a->originalHost.context,state,e);
}
static u8 compatible(const RetroCharacter *c,const Sprite *sprite) {
    u16 i,j;
    const SpriteDefinition *resource=sprite->definition;
    if(!resource || !resource->animations || !resource->w || !resource->h ||
       resource->w>32767 || resource->h>32767 || !retroCharacterValidate(c->definition)) return 0;
    for(i=0;i<c->definition->stateCount;i++) {
        const RetroCharacterState *s=&c->definition->states[i];
        const Animation *animation;
        if(s->animationId>32767 || s->animationId>=resource->numAnimation) return 0;
        animation=resource->animations[s->animationId];
        if(!animation || !animation->frames || animation->numFrame!=s->frameCount) return 0;
        for(j=0;j<s->frameCount;j++)
            if(!animation->frames[j] || s->poses[j].width!=resource->w || s->poses[j].height!=resource->h) return 0;
    }
    return 1;
}
u8 retroCharacterSpriteAttach(RetroCharacterSprite *a,RetroCharacter *c,Sprite *sprite) {
    u16 i,slot=65535;
    const RetroCharacterState *state;
    if(!a || a->active || !c || !c->ready || c->busy || !sprite || !compatible(c,sprite)) return 0;
    for(i=0;i<RETRO_CHARACTER_SPRITE_CAPACITY;i++) {
        if(bindings[i] && (bindings[i]->sprite==sprite || bindings[i]->controller==c)) return 0;
        if(!bindings[i] && slot==65535) slot=i;
    }
    if(slot==65535) return 0;
    a->sprite=sprite; a->controller=c; a->originalHost=c->host;
    a->originalCallback=sprite->onFrameChange; a->active=1; a->busy=0;
    a->x=0; a->y=0; a->cameraX=0; a->cameraY=0;
    state=&c->definition->states[c->stateIndex];
    a->hFlip=(u8)(((sprite->attribut>>11)&1)^state->poses[c->animation.frame].flipH);
    a->vFlip=(u8)(((sprite->attribut>>12)&1)^state->poses[c->animation.frame].flipV);
    a->priority=(u8)((sprite->attribut>>15)&1);
    bindings[slot]=a;
    c->host.context=a; c->host.condition=condition; c->host.enter=enter; c->host.pose=pose; c->host.event=event;
    SPR_setFrameChangeCallback(sprite,frameChanged);
    state=&c->definition->states[c->stateIndex];
    render(a,state->animationId,c->animation.frame,&state->poses[c->animation.frame]);
    return 1;
}
u8 retroCharacterSpriteDetach(RetroCharacterSprite *a) {
    u16 i;
    u8 ownedHost;
    const RetroCharacterHost *host;
    if(!a || !a->active || a->busy || a->controller->busy) return 0;
    host=&a->controller->host;
    ownedHost=host->context==a && host->condition==condition && host->enter==enter &&
              host->pose==pose && host->event==event;
    /* A partially replaced host may still call wrappers through this adapter.
     * Refuse without mutation; never erase external callbacks or leave dangling
     * wrappers. A completely independent replacement remains game-owned. */
    if(!ownedHost && (host->context==a || host->condition==condition ||
       host->enter==enter || host->pose==pose || host->event==event)) return 0;
    if(ownedHost) a->controller->host=a->originalHost;
    if(a->sprite->onFrameChange==frameChanged) {
        SPR_setFrameChangeCallback(a->sprite,a->originalCallback);
        a->sprite->timer=a->sprite->frame ? a->sprite->frame->timer : 0;
    }
    for(i=0;i<RETRO_CHARACTER_SPRITE_CAPACITY;i++) if(bindings[i]==a) bindings[i]=0;
    a->active=0; a->sprite=0; a->controller=0; a->pose=0;
    return 1;
}
void retroCharacterSpritePosition(RetroCharacterSprite *a,s16 x,s16 y,s16 cameraX,s16 cameraY) {
    if(!a || !a->active || a->busy) return;
    a->x=x; a->y=y; a->cameraX=cameraX; a->cameraY=cameraY; position(a);
}
void retroCharacterSpriteFacing(RetroCharacterSprite *a,u8 h,u8 v) {
    if(!a || !a->active || a->busy) return;
    a->hFlip=(u8)(h!=0); a->vFlip=(u8)(v!=0); position(a);
}
void retroCharacterSpritePriority(RetroCharacterSprite *a,u8 priority) {
    if(!a || !a->active || a->busy) return;
    a->priority=(u8)(priority!=0); position(a);
}
