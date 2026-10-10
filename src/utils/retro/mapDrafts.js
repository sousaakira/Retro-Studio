// #52: the map being edited (TMX text), mirrored to .retrostudio/drafts so an interrupted
// session can offer it back. One draft per map file; the map itself is only written by Save.
import {DurableDrafts} from './durableDrafts.js'
const stores=new Map()
/** Stable short name for a project-relative map path (file names in the drafts folder). */
export function mapDraftName(relativePath){let hash=2166136261;for(let i=0;i<relativePath.length;i++)hash=Math.imul(hash^relativePath.charCodeAt(i),16777619);return 'map-'+(hash>>>0).toString(16).padStart(8,'0')}
export function mapDraftsFor(relativePath){const name=mapDraftName(relativePath);if(!stores.has(name))stores.set(name,new DurableDrafts(name));return stores.get(name)}
