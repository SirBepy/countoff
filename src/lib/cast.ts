import { isComment, type Block, type Person, type Project } from './types'

/**
 * Who a placement is for. One tag shape for blocks and clips, so the rule below is
 * learned once and resolved by one function.
 *
 * The rule, in three lines:
 *   1. An absent `for` means everyone, which is what every placement already meant.
 *   2. A tagged placement wins on exactly the counts it covers, for the people it names.
 *   3. Everything else falls through to the untagged default.
 *
 * So the exclusion list is computed rather than typed: there is deliberately no blacklist,
 * because a tagged override already implies it, and two ways to say one thing can disagree.
 */
export interface Tagged {
  for?: string[]
}

/** A tag id is a person id or a group id; a group resolves here, at read time, so adding
 *  someone to it later updates every placement the group is on. */
export const inTag = (project: Project, tagId: string, personId: string): boolean =>
  tagId === personId || !!project.groups.find((g) => g.id === tagId)?.members.includes(personId)

/** Whether one dancer sees this placement. `null` is the general view, which sees the
 *  untagged plan: the whole-cast sheet Countoff has always drawn. */
export const isFor = (project: Project, item: Tagged, personId: string | null): boolean =>
  !item.for?.length || (personId !== null && item.for.some((t) => inTag(project, t, personId)))

/** Everyone a tag names, deduped and in cast order, for the avatars on a block. */
export function taggedPeople(project: Project, item: Tagged): Person[] {
  if (!item.for?.length) return []
  const ids = new Set<string>()
  for (const t of item.for) {
    const group = project.groups.find((g) => g.id === t)
    if (group) group.members.forEach((m) => ids.add(m))
    else ids.add(t)
  }
  return project.people.filter((p) => ids.has(p.id))
}

/** Names the tag the way it was written, so "The guys" reads as the group it is rather
 *  than as the four dancers it happens to hold today. */
export function tagLabel(project: Project, item: Tagged): string {
  if (!item.for?.length) return 'Everyone'
  const named = item.for.map(
    (t) => project.groups.find((g) => g.id === t)?.name ?? project.people.find((p) => p.id === t)?.name ?? 'Gone',
  )
  return named.join(' + ')
}

/** Same audience means the same tag ids, in any order. Placing a move replaces only what
 *  shares its audience, so dropping a default move never deletes someone's variant. */
export function sameAudience(a: Tagged, b: Tagged): boolean {
  const x = a.for ?? []
  const y = b.for ?? []
  return x.length === y.length && x.every((id) => y.includes(id))
}

/** A block as one row of the sheet should draw it. A default block split by an override
 *  arrives as more than one piece, each carrying the id of the block it came from: the
 *  piece is a view of that block, never a second block. */
export interface SheetBlock extends Block {
  /** Unique per piece, unlike `id`, which a split block shares across its pieces. */
  key: string
  /** This piece is what an override left of a default block, so its edge is drawn open. */
  clipped: boolean
  /** Another placement tagged to the same viewer covers some of these counts, and nothing
   *  in the rules picks a winner between two explicit tags. */
  clash: boolean
}

const plain = (b: Block): SheetBlock => ({ ...b, key: b.id, clipped: false, clash: false })

const overlaps = (a: Block, b: Block) =>
  a.segmentId === b.segmentId && a.startBeat < b.startBeat + b.beats && a.startBeat + a.beats > b.startBeat

/**
 * The blocks one viewer sees. In the general view that is every block unchanged. For a
 * dancer, their tagged blocks survive whole, everyone else's disappear, and a default
 * block keeps only the counts no override of theirs took: resolution is per count, so a
 * 4-count override of an 8-count default leaves the default's other four standing.
 *
 * A comment is never clipped. It annotates counts rather than occupying them, the same
 * reason a fill leaves comments alone.
 */
export function sheetBlocks(project: Project, viewAs: string | null): SheetBlock[] {
  if (!viewAs) return project.blocks.map(plain)

  const mine = project.blocks.filter((b) => b.for?.length && isFor(project, b, viewAs))
  const out: SheetBlock[] = []

  for (const block of project.blocks) {
    if (!isFor(project, block, viewAs)) continue

    if (block.for?.length) {
      out.push({ ...plain(block), clash: mine.some((m) => m.id !== block.id && overlaps(m, block)) })
      continue
    }
    if (isComment(block)) {
      out.push(plain(block))
      continue
    }

    const end = block.startBeat + block.beats
    const taken = (beat: number) =>
      mine.some((m) => m.segmentId === block.segmentId && beat >= m.startBeat && beat < m.startBeat + m.beats)
    let start = block.startBeat
    let piece = 0
    for (let beat = block.startBeat; beat <= end; beat++) {
      if (beat < end && !taken(beat)) continue
      if (beat > start) {
        out.push({
          ...block,
          key: `${block.id}:${piece++}`,
          startBeat: start,
          beats: beat - start,
          clipped: beat - start !== block.beats,
          clash: false,
        })
      }
      start = beat + 1
    }
  }
  return out
}

/** What one viewer is doing on a count, used by the rehearse screen and the runway.
 *  A tagged block wins; otherwise the default stands. */
export function blockAt(project: Project, segmentId: string, beat: number, viewAs: string | null): Block | null {
  const here = project.blocks.filter(
    (b) => b.segmentId === segmentId && beat >= b.startBeat && beat < b.startBeat + b.beats && isFor(project, b, viewAs),
  )
  return here.find((b) => b.for?.length) ?? here[0] ?? null
}
