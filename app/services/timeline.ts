import { DateTime } from 'luxon'
import AuditEvent from '#models/audit_event'
import SecretSnapshot from '#models/secret_snapshot'

type Author = { type: 'user' | 'token'; label: string }

export type TimelineEvent =
  | {
      type: 'version'
      id: string
      environment: string
      version: number
      keyVersion: number
      rollbackOf: number | null
      author: Author
      createdAt: string
    }
  | {
      type: 'rotation'
      environment: string | null
      keyVersion: number | null
      author: Author
      createdAt: string
    }
  | { type: 'environment'; environment: string; author: Author; createdAt: string }

const iso = (date: DateTime) => date.toUTC().toISO()!

export async function projectTimeline(
  projectId: string,
  environments: string[],
  { limit, before }: { limit: number; before?: DateTime }
) {
  if (environments.length === 0) return { environments, events: [], nextBefore: null }

  const snapshots = SecretSnapshot.query()
    .where('project_id', projectId)
    .whereIn('environment', environments)
    .preload('creator', (query) => query.select('id', 'email'))
    .orderBy('created_at', 'desc')
    .limit(limit)
  const markers = AuditEvent.query()
    .where('project_id', projectId)
    .where((query) =>
      query
        .where((rotation) =>
          rotation
            .where('action', 'keys.rotate')
            .where((scope) => scope.whereNull('environment').orWhereIn('environment', environments))
        )
        .orWhere((created) =>
          created.where('action', 'environments.create').whereIn('environment', environments)
        )
    )
    .orderBy('created_at', 'desc')
    .limit(limit)
  if (before) {
    snapshots.where('created_at', '<', before.toJSDate())
    markers.where('created_at', '<', before.toJSDate())
  }

  const [snapshotRows, markerRows] = await Promise.all([snapshots, markers])
  const versionEvents: TimelineEvent[] = snapshotRows.map((snapshot) => ({
    type: 'version',
    id: snapshot.id,
    environment: snapshot.environment,
    version: snapshot.version,
    keyVersion: snapshot.keyVersion,
    rollbackOf: snapshot.rollbackOf,
    author: snapshot.creator
      ? { type: 'user', label: snapshot.creator.email }
      : { type: 'token', label: 'CI token' },
    createdAt: iso(snapshot.createdAt),
  }))
  const markerEvents: TimelineEvent[] = markerRows.map((event) => {
    const author: Author = { type: event.actorType, label: event.actorLabel }
    return event.action === 'keys.rotate'
      ? {
          type: 'rotation',
          environment: event.environment,
          keyVersion:
            typeof event.details?.keyVersion === 'number' ? event.details.keyVersion : null,
          author,
          createdAt: iso(event.createdAt),
        }
      : {
          type: 'environment',
          environment: event.environment ?? '',
          author,
          createdAt: iso(event.createdAt),
        }
  })

  const merged = [...versionEvents, ...markerEvents].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  )
  const events = merged.slice(0, limit)
  const full =
    merged.length > limit || versionEvents.length === limit || markerEvents.length === limit
  return {
    environments,
    events,
    nextBefore: full && events.length ? events[events.length - 1].createdAt : null,
  }
}
