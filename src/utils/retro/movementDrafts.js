// Session drafts remain separate for each project and never write authoring files.
// #52: they are also mirrored to .retrostudio/drafts so an interrupted session can be recovered.
import {DurableDrafts} from './durableDrafts.js'
export const movementDrafts=new DurableDrafts('movement')
