#include "retro_scene.h"
static void manualTimer(Sprite *sprite) { sprite->timer=0; }
static u8 valid(const RetroSceneObjectDefinition *d) {
    const Animation *a;
    u16 i;
    if (!d->resource || d->id == 65535 || d->palette > 3 ||
        d->priority > 1 || d->hFlip > 1 || d->vFlip > 1 || d->loop > 1 ||
        !d->resource->animations || d->animation > 32767 || d->animation >= d->resource->numAnimation ||
        !d->resource->w || !d->resource->h ||
        d->resource->w > 32767 || d->resource->h > 32767 ||
        d->supportX < 0 || d->supportY < 0 ||
        d->supportX > d->resource->w || d->supportY > d->resource->h) return 0;
    a = d->resource->animations[d->animation];
    if (!a || !a->numFrame || !a->frames ||
        (d->durations ? d->durationCount != a->numFrame : d->durationCount != 0)) return 0;
    for (i=0;i<a->numFrame;i++)
        if (!a->frames[i] || (d->durations && !d->durations[i])) return 0;
    return 1;
}
static u16 duration(const RetroSceneObject *o) {
    const RetroSceneObjectDefinition *d=o->definition;
    u16 ticks=d->durations ? d->durations[o->frame] :
        d->resource->animations[d->animation]->frames[o->frame]->timer;
    return ticks ? ticks : 1;
}
static u8 definitionsValid(const RetroSceneObjectDefinition *definitions,u16 count){
    u16 i,j;
    if(count>RETRO_SCENE_MAX_OBJECTS||(count&&!definitions))return 0;
    for(i=0;i<count;i++){
        if(!valid(&definitions[i]))return 0;
        for(j=0;j<i;j++)if(definitions[j].id==definitions[i].id)return 0;
    }
    return 1;
}
u8 retroSceneValidatePalettes(const RetroSceneObjectDefinition *definitions,
    u16 count,const Palette *const palettes[4]){
    u16 i,color;
    if(!definitionsValid(definitions,count))return RETRO_SCENE_INVALID;
    if(count&&!palettes)return RETRO_SCENE_PALETTE;
    for(i=0;i<count;i++){
        const Palette *source=definitions[i].resource->palette;
        const Palette *target=palettes[definitions[i].palette];
        if(!source||!target||!source->data||!target->data||source->length<16||target->length<16)return RETRO_SCENE_PALETTE;
        for(color=1;color<16;color++)if((source->data[color]&0xEEE)!=(target->data[color]&0xEEE))return RETRO_SCENE_PALETTE;
    }
    return RETRO_SCENE_OK;
}
u8 retroSceneMeasureResources(const RetroSceneObjectDefinition *definitions,
    u16 count,RetroSceneResourceBudget *result){
    u16 i;RetroSceneResourceBudget measured={0,0};
    if(!result||!definitionsValid(definitions,count))return RETRO_SCENE_INVALID;
    for(i=0;i<count;i++){
        measured.tiles+=definitions[i].resource->maxNumTile;
        measured.sprites+=definitions[i].resource->maxNumSprite;
    }
    *result=measured;return RETRO_SCENE_OK;
}
void retroSceneFree(RetroScene *scene) {
    u16 i;
    if (!scene || !scene->initialized) return;
    for(i=0;i<scene->count;i++) {
        if(scene->objects[i].sprite) SPR_releaseSprite(scene->objects[i].sprite);
        scene->objects[i].sprite=0;
        scene->objects[i].definition=0;
    }
    scene->objects=0; scene->count=0; scene->initialized=0;
}
u8 retroSceneInit(RetroScene *scene, RetroSceneObject *storage, u16 capacity,
    const RetroSceneObjectDefinition *definitions, u16 count) {
    u16 i;
    if (!scene || scene->initialized || count>RETRO_SCENE_MAX_OBJECTS ||
        count>capacity || (count && (!storage || !definitions))) return RETRO_SCENE_INVALID;
    /* Validate the complete scene before allocating any sprite. */
    if(!definitionsValid(definitions,count))return RETRO_SCENE_INVALID;
    scene->objects=storage; scene->count=0; scene->initialized=1;
    for(i=0;i<count;i++) {
        RetroSceneObject *o=&storage[i];
        const RetroSceneObjectDefinition *d=&definitions[i];
        o->definition=d; o->x=d->x; o->y=d->y; o->frame=0; o->playing=1;
        o->remaining=duration(o);
        o->sprite=SPR_addSprite(d->resource,0,0,
            TILE_ATTR(d->palette,d->priority,d->vFlip,d->hFlip));
        scene->count++;
        if(!o->sprite) { retroSceneFree(scene); return RETRO_SCENE_ALLOCATION; }
        SPR_setFrameChangeCallback(o->sprite,manualTimer);
        SPR_setAnimAndFrame(o->sprite,d->animation,0);
        /* Disable SGDK's automatic timer; this module owns frame durations. */
        o->sprite->timer=0;
    }
    retroScenePosition(scene,0,0);
    return RETRO_SCENE_OK;
}
RetroSceneObject *retroSceneFind(RetroScene *scene,u16 id) {
    u16 i;
    if(!scene || !scene->initialized) return 0;
    for(i=0;i<scene->count;i++) if(scene->objects[i].definition->id==id) return &scene->objects[i];
    return 0;
}
void retroSceneTick(RetroScene *scene) {
    u16 i;
    if(!scene || !scene->initialized) return;
    for(i=0;i<scene->count;i++) {
        RetroSceneObject *o=&scene->objects[i];
        const RetroSceneObjectDefinition *d=o->definition;
        u16 count=d->resource->animations[d->animation]->numFrame;
        if(!o->playing) continue;
        if(o->remaining>1) { o->remaining--; continue; }
        if(o->frame+1>=count) {
            if(!d->loop) { o->playing=0; o->remaining=0; continue; }
            o->frame=0;
        } else o->frame++;
        o->remaining=duration(o);
        SPR_setAnimAndFrame(o->sprite,d->animation,o->frame);
        o->sprite->timer=0;
    }
}
void retroScenePosition(RetroScene *scene,s16 cameraX,s16 cameraY) {
    u16 i;
    if(!scene || !scene->initialized) return;
    for(i=0;i<scene->count;i++) {
        RetroSceneObject *o=&scene->objects[i];
        const RetroSceneObjectDefinition *d=o->definition;
        s32 x=(s32)o->x-cameraX-(d->hFlip ? d->resource->w-d->supportX : d->supportX);
        s32 y=(s32)o->y-cameraY-(d->vFlip ? d->resource->h-d->supportY : d->supportY);
        /* Clip before conversion/VDP modulo coordinates to prevent wrap ghosts. */
        if(x>=screenWidth || y>=screenHeight || x+(s32)d->resource->w<=0 ||
            y+(s32)d->resource->h<=0) SPR_setVisibility(o->sprite,HIDDEN);
        else {
            SPR_setVisibility(o->sprite,AUTO_FAST);
            SPR_setPosition(o->sprite,(s16)x,(s16)y);
        }
    }
}
