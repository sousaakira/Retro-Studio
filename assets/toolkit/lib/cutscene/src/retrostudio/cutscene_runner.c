#include "cutscene_runner.h"

enum {
    STATE_RUN = 0,
    STATE_WAIT_FRAMES,
    STATE_WAIT_MOVE,
    STATE_WAIT_ALL_MOVES,
    STATE_WAIT_CAMERA,
    STATE_WAIT_DIALOGUE,
    STATE_WAIT_CHOICE
};

/* Opcode sizes including the opcode word; keeps the decoder and the compiler in sync. */
static const unsigned char opSize[CUTSCENE_OP_COUNT] = {
    1, 2, 6, 5, 4, 3, 3, 10, 12, 5, 3, 2, 2, 3, 4, 2, 2, 3, 1, 5, 6
};
#define ROUTE_STEP_SIZE 6

/* Vertical offset of a floating actor, one entry every 4 frames. */
static const signed char floatBob[16] = { 0, -1, -1, -2, -2, -2, -1, -1, 0, 1, 1, 2, 2, 2, 1, 1 };

/* One frame can execute many instant commands; this bound stops malformed loops. */
#define CUTSCENE_COMMANDS_PER_FRAME 64

static int signedWord(unsigned short value)
{
    return value >= 0x8000 ? (int)value - 0x10000 : (int)value;
}

static int bit(const unsigned char *bits, int index, int limit)
{
    if (index < 0 || index >= limit) return 0;
    return (bits[index >> 3] >> (index & 7)) & 1;
}

static void setBit(unsigned char *bits, int index, int limit, int value)
{
    if (index < 0 || index >= limit) return;
    if (value) bits[index >> 3] |= (unsigned char)(1 << (index & 7));
    else bits[index >> 3] &= (unsigned char)~(1 << (index & 7));
}

static const char *string(const CutsceneRunner *r, unsigned short id)
{
    if (id == CUTSCENE_NONE || !r->library || id >= r->library->stringCount) return 0;
    return r->library->strings[id];
}

static void actorPosition(const CutsceneHost *h, int actor, int *x, int *y)
{
    *x = *y = 0;
    if (h->actorGet) h->actorGet(h->context, actor, x, y);
}

static CutsceneMove *findMove(CutsceneRunner *r, int actor)
{
    int i;
    for (i = 0; i < CUTSCENE_MAX_ACTORS; i++)
        if (r->moves[i].active && r->moves[i].actor == actor) return &r->moves[i];
    return 0;
}

/* Endless routes never finish, so "wait for moves" ignores them. */
static int movesActive(const CutsceneRunner *r)
{
    int i;
    for (i = 0; i < CUTSCENE_MAX_ACTORS; i++) if (r->moves[i].active && !(r->moves[i].route && r->moves[i].repeat < 0)) return 1;
    return 0;
}

static long approach(long value, long target, long step)
{
    if (value < target) return value + step < target ? value + step : target;
    if (value > target) return value - step > target ? value - step : target;
    return value;
}

/* Reports a route position: the jump arc and the float bob are visual offsets over the logical point. */
static void routeReport(const CutsceneHost *h, const CutsceneMove *m, int moving)
{
    int y = (int)(m->y / CUTSCENE_FIXED_ONE);
    if (!h->actorSet) return;
    if (moving && m->jumpFrames) y -= (int)((4L * m->jumpHeight * m->jumpFrame * (m->jumpFrames - m->jumpFrame)) / ((long)m->jumpFrames * m->jumpFrames));
    if (moving && (m->routeFlags & CUTSCENE_ROUTE_FLOAT)) y += floatBob[(m->tick >> 2) & 15];
    h->actorSet(h->context, m->actor, (int)(m->x / CUTSCENE_FIXED_ONE), y, moving && !m->timer);
}

/* Loads route steps until one takes time. Returns 0 when the route is over. */
static int routeNext(const CutsceneHost *h, CutsceneMove *m)
{
    int guard;
    for (guard = 0; guard < 64; guard++) {
        const unsigned short *a;
        int x = (int)(m->x / CUTSCENE_FIXED_ONE), y = (int)(m->y / CUTSCENE_FIXED_ONE), tx = x, ty = y;
        if (m->routeIndex >= m->routeCount) {
            if (!m->routeCount || (m->repeat > 0 && --m->repeat == 0)) return 0;
            m->routeIndex = 0;
        }
        a = m->route + m->routeIndex * ROUTE_STEP_SIZE + 1;
        m->routeIndex++;
        m->timer = m->jumpFrames = 0;
        switch (a[0]) {
        case CUTSCENE_ROUTE_MOVE:
            if (a[4] & CUTSCENE_MOVE_RELATIVE) {
                tx += signedWord(a[1]);
                if (!(a[4] & CUTSCENE_MOVE_KEEP_Y)) ty += signedWord(a[2]);
            } else {
                tx = signedWord(a[1]);
                if (!(a[4] & CUTSCENE_MOVE_KEEP_Y)) ty = signedWord(a[2]);
            }
            m->speed = a[3] ? a[3] : CUTSCENE_FIXED_ONE;
            break;
        case CUTSCENE_ROUTE_JUMP:
            tx += signedWord(a[1]);
            ty += signedWord(a[2]);
            m->jumpHeight = a[3];
            m->jumpFrames = a[4] ? a[4] : 1;
            m->jumpFrame = 0;
            m->startX = m->x;
            m->startY = m->y;
            break;
        case CUTSCENE_ROUTE_PAUSE:
            if (!a[1]) continue;
            m->timer = a[1];
            return 1;
        case CUTSCENE_ROUTE_FACE:
            if (h->actorFace) h->actorFace(h->context, m->actor, a[1] != 0);
            continue;
        default:
            continue;
        }
        m->targetX = (long)tx * CUTSCENE_FIXED_ONE;
        m->targetY = (long)ty * CUTSCENE_FIXED_ONE;
        if (h->actorFace && tx != x && !(m->routeFlags & CUTSCENE_ROUTE_KEEP_FACING)) h->actorFace(h->context, m->actor, tx < x);
        if (m->jumpFrames || tx != x || ty != y) return 1;
    }
    return 0;
}

static void endRoute(const CutsceneHost *h, CutsceneMove *m)
{
    m->active = 0;
    m->route = 0;
    m->timer = m->jumpFrames = 0;
    routeReport(h, m, 0);
}

/* Skips to the end of a route. An endless route just stops where it is. */
static void finishRoute(const CutsceneHost *h, CutsceneMove *m)
{
    if (m->repeat >= 0) {
        do {
            m->x = m->targetX;
            m->y = m->targetY;
        } while (routeNext(h, m));
    }
    endRoute(h, m);
}

static void updateRoute(const CutsceneHost *h, CutsceneMove *m)
{
    int done;
    m->tick++;
    if (m->timer) {
        done = --m->timer == 0;
    } else if (m->jumpFrames) {
        m->jumpFrame++;
        done = m->jumpFrame >= m->jumpFrames;
        if (done) {
            m->x = m->targetX;
            m->y = m->targetY;
        } else {
            m->x = m->startX + ((m->targetX - m->startX) / CUTSCENE_FIXED_ONE * m->jumpFrame / m->jumpFrames) * CUTSCENE_FIXED_ONE;
            m->y = m->startY + ((m->targetY - m->startY) / CUTSCENE_FIXED_ONE * m->jumpFrame / m->jumpFrames) * CUTSCENE_FIXED_ONE;
        }
    } else {
        m->x = approach(m->x, m->targetX, m->speed);
        m->y = approach(m->y, m->targetY, m->speed);
        done = m->x == m->targetX && m->y == m->targetY;
    }
    if (done && !routeNext(h, m)) endRoute(h, m);
    else routeReport(h, m, 1);
}

static void finishMove(const CutsceneHost *h, CutsceneMove *m)
{
    if (m->route) { finishRoute(h, m); return; }
    m->x = m->targetX;
    m->y = m->targetY;
    m->active = 0;
    if (h->actorSet) h->actorSet(h->context, m->actor, (int)(m->x / CUTSCENE_FIXED_ONE), (int)(m->y / CUTSCENE_FIXED_ONE), 0);
}

static void updateMoves(CutsceneRunner *r, const CutsceneHost *h)
{
    int i;
    for (i = 0; i < CUTSCENE_MAX_ACTORS; i++) {
        CutsceneMove *m = &r->moves[i];
        if (!m->active) continue;
        if (r->fastForward) { finishMove(h, m); continue; }
        if (m->route) { updateRoute(h, m); continue; }
        m->x = approach(m->x, m->targetX, m->speed);
        m->y = approach(m->y, m->targetY, m->speed);
        if (m->x == m->targetX && m->y == m->targetY) finishMove(h, m);
        else if (h->actorSet) h->actorSet(h->context, m->actor, (int)(m->x / CUTSCENE_FIXED_ONE), (int)(m->y / CUTSCENE_FIXED_ONE), 1);
    }
}

static void updateCamera(CutsceneRunner *r, const CutsceneHost *h)
{
    if (!r->cameraMoving) return;
    r->cameraX = r->fastForward ? r->cameraTarget : approach(r->cameraX, r->cameraTarget, r->cameraSpeed);
    if (r->cameraX == r->cameraTarget) r->cameraMoving = 0;
    if (h->cameraSet) h->cameraSet(h->context, 0, (int)(r->cameraX / CUTSCENE_FIXED_ONE));
}

static void hideDialogue(CutsceneRunner *r, const CutsceneHost *h)
{
    if (!r->dialogueVisible) return;
    r->dialogueVisible = 0;
    if (h->dialogueHide) h->dialogueHide(h->context);
}

static void stopScene(CutsceneRunner *r, const CutsceneHost *h)
{
    int i, script = r->script;
    for (i = 0; i < CUTSCENE_MAX_ACTORS; i++) if (r->moves[i].active) finishMove(h, &r->moves[i]);
    hideDialogue(r, h);
    if (r->cameraFixed && h->cameraSet) h->cameraSet(h->context, 1, 0);
    r->cameraFixed = r->cameraMoving = 0;
    r->active = 0;
    r->fastForward = 0;
    r->state = STATE_RUN;
    setBit(r->played, script, CUTSCENE_MAX_SCRIPTS, 1);
    if (h->finished) h->finished(h->context, script);
}

static unsigned short nextOpcode(const CutsceneRunner *r)
{
    const CutsceneScript *s = &r->library->scripts[r->script];
    return r->pc < s->length ? s->code[r->pc] : CUTSCENE_OP_END;
}

/* A new move or route replaces the one the actor was running, keeping its logical position. */
static CutsceneMove *claimMove(CutsceneRunner *r, const CutsceneHost *h, int actor)
{
    CutsceneMove *m = findMove(r, actor);
    int i, cx, cy;
    if (m && m->route) {
        m->route = 0;
        return m;
    }
    if (!m) {
        for (i = 0; i < CUTSCENE_MAX_ACTORS && r->moves[i].active; i++) {}
        if (i == CUTSCENE_MAX_ACTORS) return 0;
        m = &r->moves[i];
    }
    actorPosition(h, actor, &cx, &cy);
    m->active = 1;
    m->actor = actor;
    m->route = 0;
    m->x = (long)cx * CUTSCENE_FIXED_ONE;
    m->y = (long)cy * CUTSCENE_FIXED_ONE;
    return m;
}

static void startRoute(CutsceneRunner *r, const CutsceneHost *h, int actor, int flags, int repeat, const unsigned short *steps, int count)
{
    CutsceneMove *m = claimMove(r, h, actor);
    if (!m) return;
    m->targetX = m->x;
    m->targetY = m->y;
    m->route = steps;
    m->routeCount = count;
    m->routeIndex = 0;
    m->routeFlags = flags;
    m->repeat = repeat ? repeat : -1;
    m->timer = m->tick = m->jumpFrames = 0;
    if (!routeNext(h, m)) endRoute(h, m);
    else if (r->fastForward) finishRoute(h, m);
}

static void startMove(CutsceneRunner *r, const CutsceneHost *h, int actor, int x, int y, int speed)
{
    CutsceneMove *m = claimMove(r, h, actor);
    int cx;
    if (!m) return;
    cx = (int)(m->x / CUTSCENE_FIXED_ONE);
    m->targetX = (long)x * CUTSCENE_FIXED_ONE;
    m->targetY = (long)y * CUTSCENE_FIXED_ONE;
    m->speed = speed > 0 ? speed : CUTSCENE_FIXED_ONE;
    if (h->actorFace && x != cx) h->actorFace(h->context, actor, x < cx);
    if (r->fastForward || (m->x == m->targetX && m->y == m->targetY)) finishMove(h, m);
}

/* Executes one command. Returns 0 when the runner must wait for a later frame. */
static int execute(CutsceneRunner *r, const CutsceneHost *h)
{
    const CutsceneScript *s = &r->library->scripts[r->script];
    const unsigned short *a;
    unsigned short op;
    int i, x, y;
    if (r->pc >= s->length) { stopScene(r, h); return 0; }
    op = s->code[r->pc];
    if (op >= CUTSCENE_OP_COUNT || r->pc + opSize[op] > s->length) { stopScene(r, h); return 0; }
    a = &s->code[r->pc + 1];
    r->pc += opSize[op];
    switch (op) {
    case CUTSCENE_OP_END:
        stopScene(r, h);
        return 0;
    case CUTSCENE_OP_WAIT:
        r->timer = a[0];
        r->state = STATE_WAIT_FRAMES;
        return 1;
    case CUTSCENE_OP_MOVE:
        actorPosition(h, a[0], &x, &y);
        if (a[4] & CUTSCENE_MOVE_RELATIVE) {
            x += signedWord(a[1]);
            if (!(a[4] & CUTSCENE_MOVE_KEEP_Y)) y += signedWord(a[2]);
        } else {
            x = signedWord(a[1]);
            if (!(a[4] & CUTSCENE_MOVE_KEEP_Y)) y = signedWord(a[2]);
        }
        startMove(r, h, a[0], x, y, a[3]);
        if ((a[4] & CUTSCENE_MOVE_WAIT) && findMove(r, a[0])) {
            r->waitActor = a[0];
            r->state = STATE_WAIT_MOVE;
        }
        return 1;
    case CUTSCENE_OP_PLACE:
        actorPosition(h, a[0], &x, &y);
        x = signedWord(a[1]);
        if (!(a[3] & CUTSCENE_MOVE_KEEP_Y)) y = signedWord(a[2]);
        {
            CutsceneMove *m = findMove(r, a[0]);
            if (m) m->active = 0;
        }
        if (h->actorSet) h->actorSet(h->context, a[0], x, y, 0);
        return 1;
    case CUTSCENE_OP_FACE:
        if (!h->actorFace) return 1;
        if (a[1] == CUTSCENE_FACE_TOWARD) {
            int tx, ty;
            actorPosition(h, a[0], &x, &y);
            actorPosition(h, a[2], &tx, &ty);
            if (tx != x) h->actorFace(h->context, a[0], tx < x);
        } else h->actorFace(h->context, a[0], a[1] == CUTSCENE_FACE_LEFT);
        return 1;
    case CUTSCENE_OP_ANIMATE:
        if (h->actorAnimate) h->actorAnimate(h->context, a[0], a[1] == CUTSCENE_NONE ? -1 : a[1]);
        return 1;
    case CUTSCENE_OP_VISIBLE:
        if (h->actorVisible) h->actorVisible(h->context, a[0], a[1] != 0);
        return 1;
    case CUTSCENE_OP_SAY:
        if (r->fastForward) return 1;
        {
            CutsceneDialogue d;
            d.actor = a[0] == CUTSCENE_NONE ? CUTSCENE_NONE : a[0];
            d.speaker = string(r, a[1]);
            d.portrait = a[2] == CUTSCENE_NONE ? CUTSCENE_NONE : a[2];
            d.side = a[3];
            d.lineCount = a[4] > CUTSCENE_MAX_LINES ? CUTSCENE_MAX_LINES : a[4];
            for (i = 0; i < CUTSCENE_MAX_LINES; i++) d.lines[i] = i < d.lineCount ? string(r, a[5 + i]) : 0;
            r->dialogueVisible = 1;
            if (h->dialogueShow) h->dialogueShow(h->context, &d);
        }
        r->state = STATE_WAIT_DIALOGUE;
        return 1;
    case CUTSCENE_OP_CHOICE:
        r->choice.prompt = string(r, a[0]);
        r->choice.count = a[1] > CUTSCENE_MAX_CHOICES ? CUTSCENE_MAX_CHOICES : a[1];
        r->choice.cursor = a[2] < r->choice.count ? a[2] : 0;
        for (i = 0; i < CUTSCENE_MAX_CHOICES; i++) {
            r->choice.options[i] = i < r->choice.count ? string(r, a[3 + i]) : 0;
            r->choiceTargets[i] = a[7 + i];
        }
        if (r->fastForward || r->choice.count <= 0) {
            r->pc = r->choice.count > 0 ? r->choiceTargets[r->choice.cursor] : r->pc;
            return 1;
        }
        r->dialogueVisible = 1;
        if (h->choiceShow) h->choiceShow(h->context, &r->choice);
        r->state = STATE_WAIT_CHOICE;
        return 1;
    case CUTSCENE_OP_CAMERA:
        if (a[0] == CUTSCENE_CAMERA_FOLLOW) {
            r->cameraFixed = r->cameraMoving = 0;
            if (h->cameraSet) h->cameraSet(h->context, 1, 0);
            return 1;
        }
        if (!r->cameraFixed) r->cameraX = (long)(h->cameraGet ? h->cameraGet(h->context) : 0) * CUTSCENE_FIXED_ONE;
        if (a[0] == CUTSCENE_CAMERA_ACTOR) {
            actorPosition(h, a[1], &x, &y);
            x -= h->viewWidth / 2;
        } else x = signedWord(a[1]);
        if (h->cameraClamp) x = h->cameraClamp(h->context, x);
        r->cameraFixed = 1;
        r->cameraTarget = (long)x * CUTSCENE_FIXED_ONE;
        r->cameraSpeed = a[2] ? a[2] : 2 * CUTSCENE_FIXED_ONE;
        r->cameraMoving = 1;
        if (!a[2] || r->fastForward) {
            r->cameraX = r->cameraTarget;
            r->cameraMoving = 0;
            if (h->cameraSet) h->cameraSet(h->context, 0, x);
        } else if (a[3] & CUTSCENE_CAMERA_WAIT) r->state = STATE_WAIT_CAMERA;
        return 1;
    case CUTSCENE_OP_FADE:
        if (h->fade) h->fade(h->context, a[0] != 0, r->fastForward ? 0 : a[1]);
        r->timer = a[1];
        r->state = STATE_WAIT_FRAMES;
        return 1;
    case CUTSCENE_OP_SOUND:
        if (!r->fastForward && h->sound) h->sound(h->context, a[0]);
        return 1;
    case CUTSCENE_OP_MUSIC:
        if (h->music) h->music(h->context, a[0] == CUTSCENE_NONE ? -1 : a[0]);
        return 1;
    case CUTSCENE_OP_SET_FLAG:
        setBit(r->flags, a[0], CUTSCENE_MAX_FLAGS, a[1] != 0);
        return 1;
    case CUTSCENE_OP_IF_FLAG:
        if (bit(r->flags, a[0], CUTSCENE_MAX_FLAGS) != (a[1] != 0)) r->pc = a[2];
        return 1;
    case CUTSCENE_OP_JUMP:
        r->pc = a[0];
        return 1;
    case CUTSCENE_OP_ABILITY:
        if (h->ability) h->ability(h->context, a[0]);
        return 1;
    case CUTSCENE_OP_EVENT:
        if (h->event) h->event(h->context, a[0], signedWord(a[1]));
        return 1;
    case CUTSCENE_OP_WAIT_MOVES:
        r->state = STATE_WAIT_ALL_MOVES;
        return 1;
    case CUTSCENE_OP_ROUTE:
        if (r->pc + a[3] * ROUTE_STEP_SIZE > s->length) { stopScene(r, h); return 0; }
        startRoute(r, h, a[0], a[1], a[2], &s->code[r->pc], a[3]);
        r->pc += a[3] * ROUTE_STEP_SIZE;
        if ((a[1] & CUTSCENE_ROUTE_WAIT) && findMove(r, a[0])) {
            r->waitActor = a[0];
            r->state = STATE_WAIT_MOVE;
        }
        return 1;
    case CUTSCENE_OP_ROUTE_STEP: /* only read through its route */
        return 1;
    }
    return 1;
}

void cutsceneInit(CutsceneRunner *runner, const CutsceneLibrary *library)
{
    int i;
    runner->library = library;
    runner->active = runner->script = runner->pc = runner->state = runner->timer = 0;
    runner->waitActor = runner->fastForward = runner->dialogueVisible = 0;
    runner->cameraFixed = runner->cameraMoving = runner->cameraSpeed = 0;
    runner->cameraX = runner->cameraTarget = 0;
    runner->choice.count = runner->choice.cursor = 0;
    for (i = 0; i < CUTSCENE_MAX_ACTORS; i++) runner->moves[i].active = 0;
    cutsceneResetProgress(runner);
}

void cutsceneResetProgress(CutsceneRunner *runner)
{
    unsigned int i;
    for (i = 0; i < sizeof(runner->flags); i++) runner->flags[i] = 0;
    for (i = 0; i < sizeof(runner->played); i++) runner->played[i] = 0;
}

int cutsceneStart(CutsceneRunner *runner, const CutsceneHost *host, int script)
{
    int i;
    (void)host;
    if (runner->active || !runner->library || script < 0 || script >= runner->library->scriptCount) return 0;
    runner->active = 1;
    runner->script = script;
    runner->pc = 0;
    runner->state = STATE_RUN;
    runner->timer = 0;
    runner->fastForward = 0;
    runner->dialogueVisible = 0;
    runner->cameraFixed = runner->cameraMoving = 0;
    for (i = 0; i < CUTSCENE_MAX_ACTORS; i++) runner->moves[i].active = 0;
    return 1;
}

void cutsceneStep(CutsceneRunner *r, const CutsceneHost *h, unsigned int input)
{
    int guard;
    if (!r->active) return;
    if (input & CUTSCENE_INPUT_SKIP) {
        r->fastForward = 1;
        hideDialogue(r, h);
        if (r->state == STATE_WAIT_CHOICE) {
            r->pc = r->choiceTargets[r->choice.cursor];
            r->state = STATE_RUN;
        } else if (r->state == STATE_WAIT_DIALOGUE) r->state = STATE_RUN;
    }
    updateMoves(r, h);
    updateCamera(r, h);
    for (guard = 0; guard < CUTSCENE_COMMANDS_PER_FRAME && r->active; guard++) {
        switch (r->state) {
        case STATE_WAIT_FRAMES:
            if (!r->fastForward && r->timer > 0) { r->timer--; return; }
            r->state = STATE_RUN;
            break;
        case STATE_WAIT_MOVE:
            if (findMove(r, r->waitActor)) return;
            r->state = STATE_RUN;
            break;
        case STATE_WAIT_ALL_MOVES:
            if (movesActive(r)) return;
            r->state = STATE_RUN;
            break;
        case STATE_WAIT_CAMERA:
            if (r->cameraMoving) return;
            r->state = STATE_RUN;
            break;
        case STATE_WAIT_DIALOGUE:
            if (!(input & CUTSCENE_INPUT_CONFIRM)) return;
            input &= ~CUTSCENE_INPUT_CONFIRM;
            {
                unsigned short next = nextOpcode(r);
                if (next != CUTSCENE_OP_SAY && next != CUTSCENE_OP_CHOICE) hideDialogue(r, h);
            }
            r->state = STATE_RUN;
            break;
        case STATE_WAIT_CHOICE:
            if (input & (CUTSCENE_INPUT_UP | CUTSCENE_INPUT_DOWN)) {
                int step = (input & CUTSCENE_INPUT_UP) ? r->choice.count - 1 : 1;
                r->choice.cursor = (r->choice.cursor + step) % r->choice.count;
                input &= ~(CUTSCENE_INPUT_UP | CUTSCENE_INPUT_DOWN);
                if (h->choiceShow) h->choiceShow(h->context, &r->choice);
            }
            if (!(input & CUTSCENE_INPUT_CONFIRM)) return;
            input &= ~CUTSCENE_INPUT_CONFIRM;
            r->pc = r->choiceTargets[r->choice.cursor];
            {
                unsigned short next = nextOpcode(r);
                if (next != CUTSCENE_OP_SAY && next != CUTSCENE_OP_CHOICE) hideDialogue(r, h);
            }
            r->state = STATE_RUN;
            break;
        default:
            if (!execute(r, h)) return;
            break;
        }
    }
}

int cutsceneIsActive(const CutsceneRunner *runner)
{
    return runner->active;
}

int cutsceneFlag(const CutsceneRunner *runner, int flag)
{
    return bit(runner->flags, flag, CUTSCENE_MAX_FLAGS);
}

void cutsceneSetFlag(CutsceneRunner *runner, int flag, int value)
{
    setBit(runner->flags, flag, CUTSCENE_MAX_FLAGS, value);
}

int cutscenePlayed(const CutsceneRunner *runner, int script)
{
    return bit(runner->played, script, CUTSCENE_MAX_SCRIPTS);
}

int cutsceneTriggerAllowed(const CutsceneRunner *runner, const CutsceneTrigger *t)
{
    if (!runner->library || t->cutscene >= runner->library->scriptCount) return 0;
    if (t->once && cutscenePlayed(runner, t->cutscene)) return 0;
    if (t->requiresFlag >= 0 && !cutsceneFlag(runner, t->requiresFlag)) return 0;
    if (t->unlessFlag >= 0 && cutsceneFlag(runner, t->unlessFlag)) return 0;
    return 1;
}

int cutsceneTriggerFind(const CutsceneRunner *runner, const CutsceneTrigger *triggers, int count,
    int x, int y, int events, unsigned int *insideMask)
{
    int i, found = -1;
    unsigned int previous = insideMask ? *insideMask : 0, inside = 0;
    for (i = 0; i < count && i < 32; i++) {
        const CutsceneTrigger *t = &triggers[i];
        int within = x >= t->x && x < t->x + t->width && y >= t->y && y <= t->y + t->height;
        if (within) inside |= 1u << i;
        if (found >= 0 || runner->active || !cutsceneTriggerAllowed(runner, t)) continue;
        if (t->start == CUTSCENE_START_ENTER && (events & CUTSCENE_EVENT_ENTER)) found = i;
        else if (t->start == CUTSCENE_START_TOUCH && within && !(previous & (1u << i)) && (events & CUTSCENE_EVENT_TOUCH)) found = i;
        else if (t->start == CUTSCENE_START_INTERACT && within && (events & CUTSCENE_EVENT_INTERACT)) found = i;
    }
    if (insideMask) *insideMask = inside;
    return found;
}
