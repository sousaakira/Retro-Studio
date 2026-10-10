#include "retro_world.h"
static const RetroWorldRoom *roomFind(const RetroWorldDefinition *d,uint16_t id){
 uint16_t i;
 if(!d)return 0;
 for(i=0;i<d->roomCount;i++){if(d->rooms[i].id==id)return &d->rooms[i];}
 return 0;
}
static const RetroWorldSpawn *spawnFind(const RetroWorldSpawn *items,uint16_t count,uint16_t id){
 uint16_t i;for(i=0;i<count;i++){if(items[i].id==id)return &items[i];}
 return 0;
}
static uint8_t spawnsValid(const RetroWorldRoom *r,const RetroWorldSpawn *items,uint16_t count){
 uint16_t i,j;
 if(count>RETRO_WORLD_MAX_ITEMS||(count&&!items))return 0;
 for(i=0;i<count;i++){
  if(items[i].id==RETRO_ID_NONE||items[i].x<0||items[i].x>=r->width||items[i].y<0||items[i].y>r->height||items[i].facing>1)return 0;
  for(j=0;j<i;j++)if(items[i].id==items[j].id)return 0;
 }return 1;
}
uint8_t retroWorldValidate(const RetroWorldDefinition *d){
 uint16_t i,j,k;const RetroWorldRoom *r,*target;const RetroWorldExit *e;
 if(!d||!d->rooms||!d->roomCount||d->roomCount>RETRO_WORLD_MAX_ROOMS)return 0;
 for(i=0;i<d->roomCount;i++){
  r=&d->rooms[i];
 if(r->id==RETRO_ID_NONE||!r->width||r->width>32767||!r->height||r->height>32767||!r->entryCount||
   !spawnsValid(r,r->entries,r->entryCount)||!spawnsValid(r,r->checkpoints,r->checkpointCount)||
   r->exitCount>RETRO_WORLD_MAX_ITEMS||(r->exitCount&&!r->exits))return 0;
  for(j=0;j<i;j++)if(r->id==d->rooms[j].id)return 0;
 }
 r=roomFind(d,d->initialRoom);
 if(!r||!spawnFind(r->entries,r->entryCount,d->initialEntry))return 0;
 for(i=0;i<d->roomCount;i++)for(j=0;j<d->rooms[i].exitCount;j++){
  r=&d->rooms[i];e=&r->exits[j];target=roomFind(d,e->targetRoom);
  if(e->id==RETRO_ID_NONE||!target||!spawnFind(target->entries,target->entryCount,e->targetEntry)||
   e->requirementCount>RETRO_WORLD_MAX_REQUIREMENTS||(e->requirementCount&&!e->requirements))return 0;
  for(k=0;k<j;k++)if(e->id==r->exits[k].id)return 0;
  for(k=0;k<e->requirementCount;k++){
   uint16_t n;
 if(e->requirements[k]==RETRO_ID_NONE)return 0;
   for(n=0;n<k;n++)if(e->requirements[n]==e->requirements[k])return 0;
  }
 }return 1;
}
static uint8_t ready(const RetroWorld *w){return w&&w->initialized&&w->definition&&w->room&&w->handle&&w->hooks.prepare&&w->hooks.activate&&w->hooks.release;}
static uint8_t transition(RetroWorld *w,const RetroWorldRoom *target,const RetroWorldSpawn *spawn){
 void *next=0,*oldHandle=w->handle;const RetroWorldRoom *oldRoom=w->room;uint8_t loaded;
 if(target!=w->room){
  loaded=w->hooks.prepare(w->hooks.context,target,&next);
  /* A host must not lend another room's handle as a new owned allocation. */
  if(!loaded||!next||next==oldHandle){
   if(next&&next!=oldHandle)w->hooks.release(w->hooks.context,target,next);
   return RETRO_WORLD_LOAD_FAILED;
  }
  w->room=target;w->handle=next;
  w->x=spawn->x;w->y=spawn->y;w->facing=spawn->facing;
  w->hooks.activate(w->hooks.context,target,next);
  if(oldHandle)w->hooks.release(w->hooks.context,oldRoom,oldHandle);
 }else{w->x=spawn->x;w->y=spawn->y;w->facing=spawn->facing;w->hooks.activate(w->hooks.context,target,w->handle);}
 return RETRO_WORLD_OK;
}
uint8_t retroWorldInit(RetroWorld *w,const RetroWorldDefinition *d,const RetroWorldHooks *hooks){
 RetroWorld previous;const RetroWorldRoom *room;const RetroWorldSpawn *spawn;uint8_t result;
 if(!w)return RETRO_WORLD_INVALID;
 if(w->busy)return RETRO_WORLD_BUSY;
 if(w->initialized||!hooks||!hooks->prepare||!hooks->activate||!hooks->release||!retroWorldValidate(d))return RETRO_WORLD_INVALID;
 previous=*w;w->busy=1;w->definition=d;w->hooks=*hooks;w->room=0;w->handle=0;
 w->checkpointRoom=RETRO_ID_NONE;w->checkpoint=RETRO_ID_NONE;
 room=roomFind(d,d->initialRoom);spawn=spawnFind(room->entries,room->entryCount,d->initialEntry);
 result=transition(w,room,spawn);
 if(result!=RETRO_WORLD_OK){*w=previous;return result;}
 w->initialized=1;w->busy=0;return RETRO_WORLD_OK;
}
uint8_t retroWorldEnter(RetroWorld *w,uint16_t room,uint16_t entry){
 const RetroWorldRoom *target;const RetroWorldSpawn *spawn;uint8_t result;
 if(!w)return RETRO_WORLD_INVALID;
 if(w->busy)return RETRO_WORLD_BUSY;
 if(!ready(w))return RETRO_WORLD_INVALID;
 target=roomFind(w->definition,room);
 if(!target)return RETRO_WORLD_NOT_FOUND;
 spawn=spawnFind(target->entries,target->entryCount,entry);
 if(!spawn)return RETRO_WORLD_NOT_FOUND;
 w->busy=1;result=transition(w,target,spawn);w->busy=0;return result;
}
uint8_t retroWorldExitThrough(RetroWorld *w,uint16_t exit){
 const RetroWorldExit *e=0;uint16_t i;uint8_t result;
 if(!w)return RETRO_WORLD_INVALID;
 if(w->busy)return RETRO_WORLD_BUSY;
 if(!ready(w))return RETRO_WORLD_INVALID;
 for(i=0;i<w->room->exitCount;i++)if(w->room->exits[i].id==exit){e=&w->room->exits[i];break;}
 if(!e)return RETRO_WORLD_NOT_FOUND;
 w->busy=1;
 for(i=0;i<e->requirementCount;i++)if(!w->hooks.allow||!w->hooks.allow(w->hooks.context,e->requirements[i])){w->busy=0;return RETRO_WORLD_DENIED;}
 result=transition(w,roomFind(w->definition,e->targetRoom),spawnFind(roomFind(w->definition,e->targetRoom)->entries,roomFind(w->definition,e->targetRoom)->entryCount,e->targetEntry));
 w->busy=0;return result;
}
uint8_t retroWorldCheckpoint(RetroWorld *w,uint16_t checkpoint){
 if(!w)return RETRO_WORLD_INVALID;
 if(w->busy)return RETRO_WORLD_BUSY;
 if(!ready(w))return RETRO_WORLD_INVALID;
 if(!spawnFind(w->room->checkpoints,w->room->checkpointCount,checkpoint))return RETRO_WORLD_NOT_FOUND;
 w->checkpointRoom=w->room->id;w->checkpoint=checkpoint;return RETRO_WORLD_OK;
}
uint8_t retroWorldRestore(RetroWorld *w,const RetroWorldSave *save){
 const RetroWorldRoom *room;const RetroWorldSpawn *spawn;uint8_t result;
 if(!w)return RETRO_WORLD_INVALID;
 if(w->busy)return RETRO_WORLD_BUSY;
 if(!ready(w)||!save||save->version!=1)return RETRO_WORLD_INVALID;
 room=roomFind(w->definition,save->room);
 if(!room)return RETRO_WORLD_NOT_FOUND;
 spawn=spawnFind(room->checkpoints,room->checkpointCount,save->checkpoint);
 if(!spawn)return RETRO_WORLD_NOT_FOUND;
 w->busy=1;result=transition(w,room,spawn);
 if(result==RETRO_WORLD_OK){w->checkpointRoom=save->room;w->checkpoint=save->checkpoint;}
 w->busy=0;return result;
}
uint8_t retroWorldRespawn(RetroWorld *w){
 RetroWorldSave save;
 if(!w)return RETRO_WORLD_INVALID;
 if(w->busy)return RETRO_WORLD_BUSY;
 if(!ready(w))return RETRO_WORLD_INVALID;
 if(w->checkpoint==RETRO_ID_NONE)return retroWorldEnter(w,w->definition->initialRoom,w->definition->initialEntry);
 save=(RetroWorldSave){1,w->checkpointRoom,w->checkpoint};return retroWorldRestore(w,&save);
}
uint8_t retroWorldSnapshot(const RetroWorld *w,RetroWorldSave *save){
 if(!w||!save)return RETRO_WORLD_INVALID;
 if(w->busy)return RETRO_WORLD_BUSY;
 if(!ready(w))return RETRO_WORLD_INVALID;
 if(w->checkpoint==RETRO_ID_NONE)return RETRO_WORLD_NOT_FOUND;
 *save=(RetroWorldSave){1,w->checkpointRoom,w->checkpoint};return RETRO_WORLD_OK;
}
uint8_t retroWorldFree(RetroWorld *w){
 if(!w)return RETRO_WORLD_INVALID;
 if(w->busy)return RETRO_WORLD_BUSY;
 if(!ready(w))return RETRO_WORLD_INVALID;
 w->busy=1;w->hooks.release(w->hooks.context,w->room,w->handle);*w=(RetroWorld){0};return RETRO_WORLD_OK;
}
